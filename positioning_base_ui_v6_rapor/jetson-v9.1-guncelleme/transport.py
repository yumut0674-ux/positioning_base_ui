"""HTTP position forwarding and durable raw-session helpers."""

from __future__ import annotations

import json
import math
import queue
import re
import socket
import threading
import time
import uuid
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, TextIO
from urllib.request import Request, urlopen


RAW_TCP_PROTOCOL = "uwb-tracking-raw-tcp-v1"
REMOTE_SESSION_CONTROL = "remote-session-restart-v1"
RAW_BATCH_SIZE = 64
RAW_STALE_AFTER_S = 2.5


def local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("192.0.2.1", 9))
            return str(sock.getsockname()[0])
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"


def _motion_label(position: dict[str, Any]) -> str:
    label = position.get("motion_label")
    if label in ("moving", "stationary", "unknown"):
        return str(label)
    try:
        motion = int(position.get("motion", -1))
    except (TypeError, ValueError):
        return "unknown"
    return "moving" if motion == 0 else "stationary" if motion == 1 else "unknown"


class PositionForwarder:
    """Non-blocking publisher for the HTTP position contract."""

    def __init__(self, config: dict[str, Any]) -> None:
        self.lock = threading.RLock()
        self.items: queue.Queue[tuple[str, float, bytes, str]] = queue.Queue(
            maxsize=512
        )
        self.stop_event = threading.Event()
        self.enabled = False
        self.url = ""
        self.timeout = 2.0
        self.sent = 0
        self.failed = 0
        self.dropped = 0
        self.last_http_status: int | None = None
        self.last_success_at: float | None = None
        self.last_error: str | None = None
        self.last_tag_id: str | None = None
        self.configure(config)
        self.thread = threading.Thread(
            target=self._worker, name="PositionForwarder", daemon=True
        )
        self.thread.start()

    def configure(self, config: dict[str, Any]) -> None:
        network = config.get("network") or {}
        with self.lock:
            self.enabled = bool(network.get("forwardingEnabled", False))
            self.url = str(network.get("forwardingUrl") or "").strip()
            self.timeout = float(network.get("forwardingTimeout", 2.0))

    def enqueue(self, position: dict[str, Any]) -> None:
        if position.get("calibration_tag"):
            return
        with self.lock:
            if not self.enabled or not self.url:
                return
            url, timeout = self.url, self.timeout
        tag_id = str(position["uid"])
        pdop = position.get("geometry_pdop")
        pdop = float(pdop) if pdop is not None else None
        payload = {
            "type": "position",
            "tag_id": tag_id,
            "x": float(position["x"]),
            "y": float(position["y"]),
            "pdop": pdop if pdop is not None and math.isfinite(pdop) else None,
            "zone_id": position.get("zone_id"),
            "zone_name": position.get("zone_name"),
            # Tag IMU state (AM_TAG_META motion: 0 moving, 1 stationary) for the room UI.
            # Only the label is sent: every UI version accepts motion_label.
            "motion_label": _motion_label(position),
            "timestamp": datetime.now()
            .astimezone()
            .isoformat(timespec="milliseconds"),
        }
        encoded = json.dumps(
            payload, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        item = (url, timeout, encoded, tag_id)
        try:
            self.items.put_nowait(item)
        except queue.Full:
            try:
                self.items.get_nowait()
                self.items.task_done()
            except queue.Empty:
                pass
            with self.lock:
                self.dropped += 1
            try:
                self.items.put_nowait(item)
            except queue.Full:
                with self.lock:
                    self.dropped += 1

    def test(self, url: str | None = None) -> dict[str, Any]:
        target = str(url or self.url).strip()
        payload = json.dumps(
            {
                "type": "position",
                "tag_id": "CONNECTION_TEST",
                "x": 0.0,
                "y": 0.0,
                "pdop": None,
                "timestamp": datetime.now()
                .astimezone()
                .isoformat(timespec="milliseconds"),
            },
            separators=(",", ":"),
        ).encode("utf-8")
        request = Request(
            target,
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        with urlopen(request, timeout=self.timeout) as response:
            status = int(response.status)
        if not 200 <= status < 300:
            raise OSError(f"HTTP {status}")
        return {"ok": True, "status": status}

    def _worker(self) -> None:
        while not self.stop_event.is_set():
            try:
                url, timeout, payload, tag_id = self.items.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                with self.lock:
                    active = self.enabled and self.url == url
                if not active:
                    continue
                request = Request(
                    url,
                    data=payload,
                    method="POST",
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                )
                with urlopen(request, timeout=timeout) as response:
                    status = int(response.status)
                if not 200 <= status < 300:
                    raise OSError(f"HTTP {status}")
                with self.lock:
                    self.sent += 1
                    self.last_http_status = status
                    self.last_success_at = time.time()
                    self.last_error = None
                    self.last_tag_id = tag_id
            except Exception as exc:
                with self.lock:
                    self.failed += 1
                    self.last_http_status = getattr(exc, "code", None)
                    self.last_error = str(exc)[:300]
                    self.last_tag_id = tag_id
            finally:
                self.items.task_done()

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "enabled": self.enabled,
                "url": self.url,
                "queued": self.items.qsize(),
                "sent": self.sent,
                "failed": self.failed,
                "dropped": self.dropped,
                "last_http_status": self.last_http_status,
                "last_success_at": self.last_success_at,
                "last_error": self.last_error,
                "last_tag_id": self.last_tag_id,
            }

    def close(self) -> None:
        self.stop_event.set()
        if self.thread.is_alive() and self.thread is not threading.current_thread():
            self.thread.join(timeout=1.0)


class RemoteSessionLogger:
    """Durable per-anchor raw logger used before records enter the network queue."""

    def __init__(
        self,
        log_root: Path,
        anchors: list[tuple[str, str]],
        destination: tuple[str, int],
        test_id: str = "",
    ) -> None:
        started = datetime.now().astimezone()
        safe_test = re.sub(r"[^0-9A-Za-z_.-]+", "_", test_id.strip()).strip("_.-")
        safe_computer = re.sub(
            r"[^0-9A-Za-z_.-]+", "_", socket.gethostname()
        ).strip("_.-") or "host"
        stamp = started.strftime("%Y%m%d_%H%M%S")
        unique_suffix = uuid.uuid4().hex[:8]
        folder_name = (
            f"remote_{safe_test}_{safe_computer}_{stamp}_{unique_suffix}"
            if safe_test
            else f"remote_{safe_computer}_{stamp}_{unique_suffix}"
        )
        self.directory = log_root.resolve() / folder_name
        suffix = 1
        while self.directory.exists():
            self.directory = log_root.resolve() / f"{folder_name}_{suffix:02d}"
            suffix += 1
        self.directory.mkdir(parents=True, exist_ok=False)
        self.session_id = self.directory.name
        self.test_id = test_id.strip()
        self.anchors = {str(anchor_id): str(serial) for anchor_id, serial in anchors}
        self.destination = destination
        self.lock = threading.Lock()
        self.streams: dict[str, TextIO] = {}
        self.counts = {anchor_id: 0 for anchor_id in self.anchors}
        self.network_errors = 0
        self.next_line_index = 1
        self.last_flush_monotonic = time.monotonic()
        self.started_at = started.isoformat(timespec="milliseconds")
        manifest = {
            "schema": "tdoa-remote-raw-session-v3",
            "session_id": self.session_id,
            "test_id": self.test_id or None,
            "started_at": self.started_at,
            "started_epoch": time.time(),
            "computer": socket.gethostname(),
            "transport": RAW_TCP_PROTOCOL,
            "tcp_destination": f"{destination[0]}:{destination[1]}",
            "anchors": [
                {"anchor_id": anchor_id, "probe_serial": serial}
                for anchor_id, serial in self.anchors.items()
            ],
        }
        (self.directory / "session.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def log_line(
        self,
        anchor_id: str,
        line: str,
        captured_at: float,
        captured_monotonic: float | None = None,
    ) -> dict[str, Any]:
        anchor_id = str(anchor_id)
        safe_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", anchor_id)
        with self.lock:
            line_index = self.next_line_index
            self.next_line_index += 1
            record = {
                "time": captured_at,
                "captured_at": captured_at,
                "local_time": datetime.fromtimestamp(captured_at)
                .astimezone()
                .isoformat(timespec="milliseconds"),
                "monotonic_ns": time.monotonic_ns(),
                "line_index": line_index,
                "session_id": self.session_id,
                "anchor_id": anchor_id,
                "probe_serial": self.anchors.get(anchor_id, ""),
                "line": line,
            }
            stream = self.streams.get(anchor_id)
            if stream is None:
                stream = (self.directory / f"anchor_{safe_id}.jsonl").open(
                    "a", encoding="utf-8", buffering=64 * 1024
                )
                self.streams[anchor_id] = stream
            stream.write(
                json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
            )
            self.counts[anchor_id] = self.counts.get(anchor_id, 0) + 1
            now = time.monotonic()
            if now - self.last_flush_monotonic >= 0.25:
                self._flush_locked()
                self.last_flush_monotonic = now
        record["_captured_monotonic"] = (
            float(captured_monotonic)
            if captured_monotonic is not None
            else time.monotonic()
        )
        return record

    def _flush_locked(self) -> None:
        for stream in self.streams.values():
            stream.flush()

    def flush(self) -> None:
        with self.lock:
            self._flush_locked()
            self.last_flush_monotonic = time.monotonic()

    def log_network_error(self, anchor_id: str, error: BaseException) -> None:
        record = {
            "time": time.time(),
            "local_time": datetime.now()
            .astimezone()
            .isoformat(timespec="milliseconds"),
            "anchor_id": str(anchor_id),
            "error": str(error),
        }
        with self.lock:
            self.network_errors += 1
            with (self.directory / "network_errors.jsonl").open(
                "a", encoding="utf-8"
            ) as stream:
                stream.write(
                    json.dumps(record, ensure_ascii=False, separators=(",", ":"))
                    + "\n"
                )

    def close(self, transport_summary: dict[str, Any] | None = None) -> None:
        with self.lock:
            self._flush_locked()
            for stream in self.streams.values():
                stream.close()
            self.streams.clear()
            summary = {
                "schema": "tdoa-remote-raw-session-end-v3",
                "session_id": self.session_id,
                "started_at": self.started_at,
                "ended_at": datetime.now()
                .astimezone()
                .isoformat(timespec="milliseconds"),
                "line_counts": dict(self.counts),
                "network_errors": self.network_errors,
                "transport": transport_summary or {},
            }
            (self.directory / "session_end.json").write_text(
                json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )


def _encode_message(message: dict[str, Any]) -> bytes:
    return (
        json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n"
    ).encode("utf-8")


def _read_message(stream: Any, limit: int = 8_000_000) -> dict[str, Any]:
    payload = stream.readline(limit + 1)
    if not payload:
        raise ConnectionError("TCP bağlantısı kapandı")
    if len(payload) > limit or not payload.endswith(b"\n"):
        raise ValueError("TCP mesajı çok büyük veya tamamlanmamış")
    message = json.loads(payload.decode("utf-8"))
    if not isinstance(message, dict):
        raise ValueError("TCP mesajı JSON nesnesi olmalı")
    return message


class ReliableRawClient:
    """Persistent ordered TCP client with cumulative acknowledgements and replay."""

    def __init__(
        self,
        destination: tuple[str, int],
        anchors: list[tuple[str, str]],
        session_id: str,
        logger: RemoteSessionLogger,
        resolver: Callable[[], tuple[str, int]] | None = None,
        control_callback: Callable[[dict[str, Any]], None] | None = None,
        stale_after_s: float = RAW_STALE_AFTER_S,
    ) -> None:
        self.destination = destination
        self.anchors = [
            {"id": str(anchor_id), "probe_serial": str(serial)}
            for anchor_id, serial in anchors
        ]
        self.session_id = str(session_id)
        self.logger = logger
        self.resolver = resolver
        self.control_callback = control_callback
        self.stale_after_s = max(0.25, float(stale_after_s))
        self.computer = socket.gethostname()
        self.condition = threading.Condition()
        self.pending: deque[dict[str, Any]] = deque()
        self.stop_event = threading.Event()
        self.thread = threading.Thread(
            target=self._worker, name="ReliableRawTCP", daemon=True
        )
        self.connected = False
        self.persisted = 0
        self.sent_attempts = 0
        self.acked = 0
        self.ack_index = 0
        self.replayed_acked = 0
        self.connections = 0
        self.reconnects = 0
        self.failures = 0
        self.last_error: str | None = None
        self.last_error_logged: str | None = None
        self.last_ack_at: float | None = None
        self.last_lag_ms: float | None = None
        self.last_control_id: str | None = None
        self.last_control_at: float | None = None
        self.started = False

    def start(self) -> None:
        with self.condition:
            if self.started:
                return
            self.started = True
        self.thread.start()

    def enqueue_persisted(self, record: dict[str, Any]) -> None:
        with self.condition:
            self.pending.append(record)
            self.persisted += 1
            self.condition.notify_all()

    def _status_locked(self) -> dict[str, Any]:
        return {
            "persisted": self.persisted,
            "queued": len(self.pending),
            "ack_index": self.ack_index,
            "acked": self.acked,
            "sent_attempts": self.sent_attempts,
            "replayed_acked": self.replayed_acked,
            "connections": self.connections,
            "reconnects": self.reconnects,
            "failures": self.failures,
            "last_error": self.last_error,
            "last_lag_ms": self.last_lag_ms,
            "last_control_id": self.last_control_id,
        }

    def snapshot(self) -> dict[str, Any]:
        with self.condition:
            return {
                "protocol": RAW_TCP_PROTOCOL,
                "connected": self.connected,
                "destination": f"{self.destination[0]}:{self.destination[1]}",
                "last_ack_at": self.last_ack_at,
                **self._status_locked(),
            }

    def _remove_acked_locked(self, ack_index: int) -> None:
        if ack_index <= self.ack_index:
            return
        removed = 0
        replayed = 0
        now = time.monotonic()
        while self.pending and int(self.pending[0]["line_index"]) <= ack_index:
            record = self.pending.popleft()
            removed += 1
            age = now - float(record.get("_captured_monotonic", now))
            if age > self.stale_after_s:
                replayed += 1
        self.ack_index = ack_index
        self.acked += removed
        self.replayed_acked += replayed
        self.last_ack_at = time.time()

    def _batch_locked(self) -> list[dict[str, Any]]:
        now = time.monotonic()
        records: list[dict[str, Any]] = []
        for original in list(self.pending)[:RAW_BATCH_SIZE]:
            record = {
                key: value
                for key, value in original.items()
                if not key.startswith("_")
            }
            age_s = max(
                0.0, now - float(original.get("_captured_monotonic", now))
            )
            record["transport_age_ms"] = round(age_s * 1000.0, 3)
            record["replayed"] = age_s > self.stale_after_s
            records.append(record)
        return records

    def _exchange(
        self, sock: socket.socket, stream: Any, message: dict[str, Any]
    ) -> dict[str, Any]:
        sock.sendall(_encode_message(message))
        return _read_message(stream)

    def _accept_control_command(
        self,
        sock: socket.socket,
        stream: Any,
        response: dict[str, Any],
    ) -> None:
        command = response.get("control_command")
        if not isinstance(command, dict):
            return
        command_id = str(command.get("command_id") or "").strip()
        command_type = str(command.get("type") or "").strip()
        if (
            not command_id
            or command_type != REMOTE_SESSION_CONTROL
            or command_id == self.last_control_id
        ):
            return
        with self.condition:
            client_status = self._status_locked()
        acknowledgement = self._exchange(
            sock,
            stream,
            {
                "type": "control_ack",
                "protocol": RAW_TCP_PROTOCOL,
                "session_id": self.session_id,
                "command_id": command_id,
                "status": "accepted",
                "client_time": time.time(),
                "client_status": client_status,
            },
        )
        if (
            acknowledgement.get("type") != "control_acknowledged"
            or str(acknowledgement.get("command_id") or "") != command_id
        ):
            raise ConnectionError(
                str(
                    acknowledgement.get("error")
                    or "Uzak oturum komutu onaylanamadı"
                )
            )
        with self.condition:
            self.last_control_id = command_id
            self.last_control_at = time.time()
        if self.control_callback is not None:
            self.control_callback(dict(command))

    def _connect(self) -> tuple[socket.socket, Any]:
        if self.resolver is not None:
            self.destination = self.resolver()
        sock = socket.create_connection(self.destination, timeout=2.0)
        sock.settimeout(3.0)
        stream = sock.makefile("rb")
        try:
            with self.condition:
                status = self._status_locked()
            response = self._exchange(
                sock,
                stream,
                {
                    "type": "hello",
                    "protocol": RAW_TCP_PROTOCOL,
                    "session_id": self.session_id,
                    "test_id": self.logger.test_id,
                    "computer": self.computer,
                    "anchors": self.anchors,
                    "capabilities": [REMOTE_SESSION_CONTROL],
                    "client_time": time.time(),
                    "status": status,
                },
            )
            if response.get("type") != "welcome":
                raise ConnectionError(
                    str(response.get("error") or "TCP kabul edilmedi")
                )
            with self.condition:
                self._remove_acked_locked(int(response.get("ack_index") or 0))
                self.connections += 1
                self.reconnects = max(0, self.connections - 1)
                self.connected = True
                self.last_error = None
            self._accept_control_command(sock, stream, response)
            return sock, stream
        except BaseException:
            try:
                stream.close()
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass
            raise

    def _note_failure(self, exc: BaseException) -> None:
        error = str(exc)[:300]
        with self.condition:
            self.connected = False
            self.failures += 1
            self.last_error = error
        if error != self.last_error_logged:
            self.logger.log_network_error("", exc)
            self.last_error_logged = error

    def _worker(self) -> None:
        retry_delay = 0.25
        sock: socket.socket | None = None
        stream: Any = None
        next_heartbeat = 0.0
        while not self.stop_event.is_set():
            try:
                if sock is None:
                    sock, stream = self._connect()
                    retry_delay = 0.25
                    next_heartbeat = time.monotonic() + 2.0
                with self.condition:
                    if not self.pending and time.monotonic() < next_heartbeat:
                        self.condition.wait(timeout=0.2)
                        continue
                    batch = self._batch_locked()
                    status = self._status_locked()
                if batch:
                    response = self._exchange(
                        sock,
                        stream,
                        {
                            "type": "raw_batch",
                            "protocol": RAW_TCP_PROTOCOL,
                            "session_id": self.session_id,
                            "records": batch,
                            "status": status,
                        },
                    )
                    if response.get("type") != "ack":
                        raise ConnectionError(
                            str(response.get("error") or "Geçersiz ACK")
                        )
                    with self.condition:
                        self.sent_attempts += len(batch)
                        self.last_lag_ms = max(
                            float(item.get("transport_age_ms") or 0.0)
                            for item in batch
                        )
                        self._remove_acked_locked(
                            int(response.get("ack_index") or 0)
                        )
                    self._accept_control_command(sock, stream, response)
                    next_heartbeat = time.monotonic() + 2.0
                    continue
                response = self._exchange(
                    sock,
                    stream,
                    {
                        "type": "heartbeat",
                        "protocol": RAW_TCP_PROTOCOL,
                        "session_id": self.session_id,
                        "sent_at": time.time(),
                        "status": status,
                    },
                )
                if response.get("type") != "ack":
                    raise ConnectionError("Heartbeat ACK alınamadı")
                with self.condition:
                    self._remove_acked_locked(int(response.get("ack_index") or 0))
                self._accept_control_command(sock, stream, response)
                next_heartbeat = time.monotonic() + 2.0
            except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
                self._note_failure(exc)
                if stream is not None:
                    try:
                        stream.close()
                    except OSError:
                        pass
                if sock is not None:
                    try:
                        sock.close()
                    except OSError:
                        pass
                stream = None
                sock = None
                self.stop_event.wait(retry_delay)
                retry_delay = min(5.0, retry_delay * 1.7)
        if stream is not None:
            try:
                stream.close()
            except OSError:
                pass
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass
        with self.condition:
            self.connected = False

    def close(self, drain_timeout: float = 3.0) -> dict[str, Any]:
        deadline = time.monotonic() + max(0.0, drain_timeout)
        while time.monotonic() < deadline:
            with self.condition:
                if not self.pending:
                    break
            time.sleep(0.05)
        self.stop_event.set()
        with self.condition:
            self.condition.notify_all()
        if self.thread.is_alive() and self.thread is not threading.current_thread():
            self.thread.join(timeout=3.5)
        return self.snapshot()


class RemoteRawPipeline:
    """Fast RTT callback -> local disk writer -> reliable TCP sender."""

    def __init__(
        self,
        logger: RemoteSessionLogger,
        destination: tuple[str, int],
        anchors: list[tuple[str, str]],
        resolver: Callable[[], tuple[str, int]] | None = None,
        control_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.logger = logger
        self.items: queue.Queue[tuple[str, str, float, float]] = queue.Queue(
            maxsize=100_000
        )
        self.stop_event = threading.Event()
        self.client = ReliableRawClient(
            destination,
            anchors,
            logger.session_id,
            logger,
            resolver=resolver,
            control_callback=control_callback,
        )
        self.writer = threading.Thread(
            target=self._writer, name="RemoteRawDiskWriter", daemon=True
        )
        self.captured = 0
        self.queue_pressure_events = 0
        self.lock = threading.Lock()

    def start(self) -> None:
        self.client.start()
        self.writer.start()

    def capture(self, anchor_id: str, line: str) -> None:
        item = (str(anchor_id), str(line), time.time(), time.monotonic())
        with self.lock:
            self.captured += 1
        try:
            self.items.put_nowait(item)
        except queue.Full:
            with self.lock:
                self.queue_pressure_events += 1
            self.items.put(item)

    def _writer(self) -> None:
        while not self.stop_event.is_set() or not self.items.empty():
            try:
                first = self.items.get(timeout=0.1)
            except queue.Empty:
                continue
            batch = [first]
            while len(batch) < RAW_BATCH_SIZE:
                try:
                    batch.append(self.items.get_nowait())
                except queue.Empty:
                    break
            persisted: list[dict[str, Any]] = []
            try:
                for anchor_id, line, captured_at, captured_monotonic in batch:
                    persisted.append(
                        self.logger.log_line(
                            anchor_id, line, captured_at, captured_monotonic
                        )
                    )
                # A network record becomes eligible only after the whole disk
                # batch has left Python's userspace buffer.
                self.logger.flush()
                for record in persisted:
                    self.client.enqueue_persisted(record)
            finally:
                for _item in batch:
                    self.items.task_done()

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            captured = self.captured
            pressure = self.queue_pressure_events
        return {
            "captured": captured,
            "disk_queue": self.items.qsize(),
            "queue_pressure_events": pressure,
            **self.client.snapshot(),
        }

    def close(self, drain_timeout: float = 3.0) -> dict[str, Any]:
        self.stop_event.set()
        if self.writer.is_alive() and self.writer is not threading.current_thread():
            self.writer.join(timeout=10.0)
        self.logger.flush()
        summary = self.snapshot()
        summary.update(self.client.close(drain_timeout))
        summary["disk_queue"] = self.items.qsize()
        self.logger.close(summary)
        return summary
