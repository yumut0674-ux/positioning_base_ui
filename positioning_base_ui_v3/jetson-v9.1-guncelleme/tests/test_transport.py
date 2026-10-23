from __future__ import annotations

import json
import math
import socket
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from transport import (  # noqa: E402
    RAW_TCP_PROTOCOL,
    REMOTE_SESSION_CONTROL,
    PositionForwarder,
    ReliableRawClient,
    RemoteSessionLogger,
    _encode_message,
    _read_message,
)
from remote_agent import PROTOCOL, discover_server  # noqa: E402


class TransportTests(unittest.TestCase):
    def test_reliable_client_acknowledges_remote_session_command(self) -> None:
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        listener.settimeout(5)
        destination = ("127.0.0.1", listener.getsockname()[1])
        command_id = "command-123"
        server_finished = threading.Event()
        server_error: list[BaseException] = []

        def receiver() -> None:
            try:
                connection, _address = listener.accept()
                connection.settimeout(3)
                stream = connection.makefile("rb")
                hello = _read_message(stream)
                self.assertEqual(hello["test_id"], "T01_tagA_2Hz")
                self.assertIn(REMOTE_SESSION_CONTROL, hello["capabilities"])
                connection.sendall(
                    _encode_message(
                        {
                            "type": "welcome",
                            "protocol": RAW_TCP_PROTOCOL,
                            "ack_index": 0,
                            "control_command": {
                                "command_id": command_id,
                                "type": REMOTE_SESSION_CONTROL,
                                "test_id": "T01_tagA_2Hz",
                            },
                        }
                    )
                )
                acknowledgement = _read_message(stream)
                self.assertEqual(acknowledgement["type"], "control_ack")
                self.assertEqual(acknowledgement["command_id"], command_id)
                connection.sendall(
                    _encode_message(
                        {
                            "type": "control_acknowledged",
                            "protocol": RAW_TCP_PROTOCOL,
                            "command_id": command_id,
                        }
                    )
                )
                server_finished.set()
                stream.close()
                connection.close()
            except BaseException as exc:
                server_error.append(exc)
                server_finished.set()
            finally:
                listener.close()

        server_thread = threading.Thread(target=receiver, daemon=True)
        server_thread.start()
        received: list[dict] = []
        callback_finished = threading.Event()

        def receive_control(command: dict) -> None:
            received.append(command)
            callback_finished.set()

        with tempfile.TemporaryDirectory() as directory:
            logger = RemoteSessionLogger(
                Path(directory),
                [("A3", "760221659")],
                destination,
                "T01_tagA_2Hz",
            )
            client = ReliableRawClient(
                destination,
                [("A3", "760221659")],
                logger.session_id,
                logger,
                control_callback=receive_control,
            )
            client.start()
            self.assertTrue(callback_finished.wait(4))
            self.assertTrue(server_finished.wait(2))
            summary = client.close(0.1)
            logger.close(summary)
            self.assertFalse(server_error, server_error)
            self.assertEqual(received[0]["command_id"], command_id)
            self.assertEqual(summary["last_control_id"], command_id)
        server_thread.join(timeout=2)

    def test_remote_agent_discovers_main_pc_without_manual_ip(self) -> None:
        responder = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        responder.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        responder.bind(("0.0.0.0", 0))
        port = responder.getsockname()[1]

        def offer() -> None:
            payload, address = responder.recvfrom(65535)
            request = json.loads(payload)
            responder.sendto(
                json.dumps(
                    {
                        "type": "offer",
                        "protocol": PROTOCOL,
                        "nonce": request["nonce"],
                        "data_port": port,
                        "test_id": "koridor",
                    }
                ).encode("utf-8"),
                address,
            )

        thread = threading.Thread(target=offer)
        thread.start()
        try:
            host, discovered_port, response = discover_server(
                port, [("A3", "760221659")], 3
            )
            self.assertTrue(host)
            self.assertEqual(discovered_port, port)
            self.assertEqual(response["test_id"], "koridor")
        finally:
            thread.join(timeout=2)
            responder.close()

    def test_position_contract_includes_zone_and_pdop_from_selected_position(self) -> None:
        received: list[dict] = []
        arrived = threading.Event()

        class Receiver(BaseHTTPRequestHandler):
            def log_message(self, _format: str, *_args: object) -> None:
                return

            def do_POST(self) -> None:
                body = self.rfile.read(int(self.headers["Content-Length"]))
                received.append(json.loads(body))
                self.send_response(204)
                self.end_headers()
                arrived.set()

        server = ThreadingHTTPServer(("127.0.0.1", 0), Receiver)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        forwarder = PositionForwarder(
            {
                "network": {
                    "forwardingEnabled": True,
                    "forwardingUrl": f"http://127.0.0.1:{server.server_port}/api/tracking/ingest",
                    "forwardingTimeout": 2,
                }
            }
        )
        try:
            cases = [
                ({"geometry_pdop": 1.83}, 1.83),
                ({"geometry_pdop": 4.27}, 4.27),
            ]
            for index, (diagnostics, expected_pdop) in enumerate(cases):
                with self.subTest(diagnostics=diagnostics):
                    arrived.clear()
                    forwarder.enqueue(
                        {
                            "uid": "AAAABBBBCCCCDDDD",
                            "x": 1.25 + index,
                            "y": -0.8,
                            "zone_id": "zone-a",
                            "zone_name": "Bölge A",
                            **diagnostics,
                        }
                    )
                    self.assertTrue(arrived.wait(3))
                    record = received[index]
                    self.assertEqual(
                        set(record),
                        {
                            "type",
                            "tag_id",
                            "x",
                            "y",
                            "pdop",
                            "zone_id",
                            "zone_name",
                            "motion_label",
                            "timestamp",
                        },
                    )
                    self.assertEqual(record["motion_label"], "unknown")
                    self.assertEqual(record["type"], "position")
                    self.assertEqual(record["tag_id"], "AAAABBBBCCCCDDDD")
                    self.assertEqual(record["x"], 1.25 + index)
                    self.assertEqual(record["y"], -0.8)
                    self.assertEqual(record["pdop"], expected_pdop)
                    self.assertEqual(record["zone_id"], "zone-a")
                    self.assertEqual(record["zone_name"], "Bölge A")

            self.assertEqual(forwarder.test(), {"ok": True, "status": 204})
            self.assertEqual(received[-1]["tag_id"], "CONNECTION_TEST")
            self.assertIsNone(received[-1]["pdop"])
        finally:
            forwarder.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=1)

    def test_position_pdop_is_json_compatible_in_outgoing_http_requests(self) -> None:
        received = []
        arrived = threading.Event()
        response = mock.MagicMock()
        response.__enter__.return_value.status = 204
        url = "http://example.invalid/api/tracking/ingest"

        def receive(request, *, timeout):
            self.assertEqual(request.full_url, url)
            self.assertEqual(request.get_method(), "POST")
            self.assertEqual(request.get_header("Content-type"), "application/json")
            self.assertEqual(timeout, 2.0)
            received.append(json.loads(request.data))
            arrived.set()
            return response

        with mock.patch("transport.urlopen", side_effect=receive):
            forwarder = PositionForwarder(
                {
                    "network": {
                        "forwardingEnabled": True,
                        "forwardingUrl": url,
                        "forwardingTimeout": 2,
                    }
                }
            )
            try:
                cases = [
                    ({"geometry_pdop": 1.83}, 1.83),
                    ({"geometry_pdop": 4.27}, 4.27),
                    ({"geometry_pdop": 0.0}, 0.0),
                    ({}, None),
                    ({"geometry_pdop": None}, None),
                    ({"geometry_pdop": math.inf}, None),
                    ({"geometry_pdop": -math.inf}, None),
                    ({"geometry_pdop": math.nan}, None),
                ]
                for index, (diagnostics, expected_pdop) in enumerate(cases):
                    with self.subTest(diagnostics=diagnostics):
                        arrived.clear()
                        forwarder.enqueue(
                            {
                                "uid": "AAAABBBBCCCCDDDD",
                                "x": 1.25 + index,
                                "y": -0.8,
                                **diagnostics,
                            }
                        )
                        self.assertTrue(arrived.wait(3))
                        self.assertEqual(received[index]["x"], 1.25 + index)
                        self.assertEqual(received[index]["pdop"], expected_pdop)

                self.assertEqual(forwarder.test(), {"ok": True, "status": 204})
                self.assertEqual(received[-1]["tag_id"], "CONNECTION_TEST")
                self.assertIsNone(received[-1]["pdop"])
            finally:
                forwarder.close()

    def test_remote_raw_is_written_before_network_summary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            logger = RemoteSessionLogger(
                Path(directory),
                [("A3", "760221659")],
                ("192.168.1.50", 5005),
                "koridor",
            )
            session = logger.directory
            logger.log_line("A3", "AS_TAG_CORRECTED seq=100", 1780000000.5)
            logger.close()
            lines = (session / "anchor_A3.jsonl").read_text(encoding="utf-8")
            summary = json.loads(
                (session / "session_end.json").read_text(encoding="utf-8")
            )
            self.assertIn("seq=100", lines)
            self.assertEqual(summary["line_counts"]["A3"], 1)

    def test_remote_session_ids_are_unique_across_computers_and_processes(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as first_directory, (
            tempfile.TemporaryDirectory()
        ) as second_directory:
            with mock.patch("transport.socket.gethostname", return_value="SAHA PC"):
                first = RemoteSessionLogger(
                    Path(first_directory),
                    [("A5", "760221000")],
                    ("192.168.0.100", 5005),
                    "koridor",
                )
                second = RemoteSessionLogger(
                    Path(second_directory),
                    [("A7", "760221615")],
                    ("192.168.0.100", 5005),
                    "koridor",
                )
            try:
                self.assertNotEqual(first.session_id, second.session_id)
                self.assertIn("SAHA_PC", first.session_id)
                self.assertIn("SAHA_PC", second.session_id)
            finally:
                first.close()
                second.close()

    def test_tcp_reconnect_replays_unacked_records_without_loss(self) -> None:
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 0))
        listener.listen(2)
        listener.settimeout(5)
        destination = ("127.0.0.1", listener.getsockname()[1])
        first_attempt: list[int] = []
        second_attempt: list[int] = []
        received_twice = threading.Event()

        def receiver() -> None:
            try:
                for connection_number in range(2):
                    connection, _address = listener.accept()
                    connection.settimeout(3)
                    stream = connection.makefile("rb")
                    hello = _read_message(stream)
                    self.assertEqual(hello["protocol"], RAW_TCP_PROTOCOL)
                    connection.sendall(
                        _encode_message(
                            {
                                "type": "welcome",
                                "protocol": RAW_TCP_PROTOCOL,
                                "ack_index": 0,
                            }
                        )
                    )
                    if connection_number == 0:
                        batch = _read_message(stream)
                        first_attempt.extend(
                            int(record["line_index"])
                            for record in batch["records"]
                        )
                        connection.close()  # ACK deliberately lost.
                        continue
                    while len(second_attempt) < 150:
                        batch = _read_message(stream)
                        indices = [
                            int(record["line_index"])
                            for record in batch["records"]
                        ]
                        second_attempt.extend(indices)
                        connection.sendall(
                            _encode_message(
                                {
                                    "type": "ack",
                                    "protocol": RAW_TCP_PROTOCOL,
                                    "ack_index": max(indices),
                                }
                            )
                        )
                    received_twice.set()
                    stream.close()
                    connection.close()
            finally:
                listener.close()

        server_thread = threading.Thread(target=receiver, daemon=True)
        server_thread.start()
        with tempfile.TemporaryDirectory() as directory:
            logger = RemoteSessionLogger(
                Path(directory),
                [("A3", "760221659")],
                destination,
                "reconnect",
            )
            records = [
                logger.log_line(
                    "A3",
                    f"AS_TAG_CORRECTED seq={sequence}",
                    time.time(),
                    time.monotonic(),
                )
                for sequence in range(100, 250)
            ]
            logger.flush()
            client = ReliableRawClient(
                destination,
                [("A3", "760221659")],
                logger.session_id,
                logger,
            )
            for record in records:
                client.enqueue_persisted(record)
            client.start()
            self.assertTrue(received_twice.wait(6))
            deadline = time.monotonic() + 2
            while client.snapshot()["queued"] and time.monotonic() < deadline:
                time.sleep(0.02)
            summary = client.close(0.2)
            logger.close(summary)
            self.assertEqual(summary["queued"], 0)
            self.assertEqual(summary["acked"], 150)
            self.assertGreaterEqual(summary["connections"], 2)
            self.assertEqual(first_attempt, list(range(1, 65)))
            self.assertEqual(second_attempt, list(range(1, 151)))
            persisted = [
                json.loads(line)
                for line in (
                    logger.directory / "anchor_A3.jsonl"
                ).read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(
                [record["line_index"] for record in persisted], list(range(1, 151))
            )
        server_thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()


class MotionLabelTests(unittest.TestCase):
    def test_motion_label_from_tag_telemetry(self) -> None:
        from transport import _motion_label
        self.assertEqual(_motion_label({"motion": 0}), "moving")
        self.assertEqual(_motion_label({"motion": 1}), "stationary")
        self.assertEqual(_motion_label({"motion_label": "stationary", "motion": 0}), "stationary")
        self.assertEqual(_motion_label({"motion": 2}), "unknown")
        self.assertEqual(_motion_label({}), "unknown")
