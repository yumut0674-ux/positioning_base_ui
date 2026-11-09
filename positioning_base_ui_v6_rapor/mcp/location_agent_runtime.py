"""Shared Gemini + MCP runtime for UWB location assistant clients."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import sys
import time
from contextlib import AsyncExitStack
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping
from uuid import uuid4

from dotenv import load_dotenv
from assistant_policy import OUTPUT_SAFETY_MESSAGE, decide_request, safe_answer


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MCP_SERVER_PATH = PROJECT_ROOT / "mcp" / "server.ts"

# Keep local development configuration in the existing project env files.
# Existing shell variables win over file values.
load_dotenv(PROJECT_ROOT / ".env.local", override=False)
load_dotenv(PROJECT_ROOT / ".env", override=False)

from google import genai  # noqa: E402
from google.genai import types  # noqa: E402
from mcp import ClientSession, StdioServerParameters  # noqa: E402
from mcp.client.stdio import stdio_client  # noqa: E402


MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
ISTANBUL_TIMEZONE = timezone(timedelta(hours=3), name="Europe/Istanbul")
EXIT_COMMANDS = {"/exit", "/quit", "exit", "quit", "çık", "çıkış"}
EXPECTED_TOOL_NAMES = {
    "search_entities",
    "get_current_location",
    "get_location_at_time",
    "get_location_history",
}


@dataclass(frozen=True)
class AgentAnswer:
    session_id: str
    answer: str


@dataclass
class AgentSession:
    chat: Any
    lock: asyncio.Lock
    last_access: float
    role: str


class AgentUserFacingError(RuntimeError):
    """Error with a message that is safe to show to local clients."""

    def __init__(self, public_message: str) -> None:
        super().__init__(public_message)
        self.public_message = public_message


class AgentProviderError(AgentUserFacingError):
    """Gemini or MCP provider failed while handling a user request."""


class AgentNotReadyError(AgentUserFacingError):
    """Runtime was called before startup completed."""


def configure_terminal_encoding() -> None:
    """Use UTF-8 for Turkish output when the terminal supports reconfiguration."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8")


def validate_environment() -> tuple[str, str]:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY bulunamadı. Anahtarı .env.local dosyasına ekleyin "
            'veya CMD için set "GEMINI_API_KEY=..." komutunu çalıştırın.'
        )

    if not MCP_SERVER_PATH.is_file():
        raise RuntimeError(f"MCP sunucusu bulunamadı: {MCP_SERVER_PATH}")

    node_command = os.getenv("UWB_NODE_COMMAND") or shutil.which("node")
    if not node_command:
        raise RuntimeError(
            "Node.js bulunamadı. Node.js'i PATH'e ekleyin veya "
            "UWB_NODE_COMMAND değişkenine node.exe yolunu yazın."
        )

    return node_command, api_key


def build_agent_instructions() -> str:
    current_time = datetime.now(ISTANBUL_TIMEZONE).isoformat(timespec="seconds")
    return f"""
Sen, UWB konum verilerini yorumlayan salt-okunur bir konum analistisin.
Şu anki yerel zaman: {current_time}.

Genel UWB kavramlarını, arayüz kullanımını ve sorun giderme adımlarını kısa ve
yararlı biçimde açıkla. Bu tür genel sorular için kişi veya konum verisi gerekmez.
Gerçek bir kişi, etiket, oda veya zaman aralığı hakkında olgusal konum iddiasında
yalnızca bağlı araçların döndürdüğü doğrulanmış veriye dayan. Araç erişimin
yoksa böyle bir konumu tahmin etme; doğrulanamadığını açıkça söyle. Arayüz
bağlamı filtre ve niyet ipucu sağlar; harita ekranındaki demo rota verisini
doğru kaynak olarak kabul etme. Bilmediğin arayüz adımlarını kesinmiş gibi
anlatma; gerekiyorsa kullanıcıdan ek bilgi iste.

Bu uygulamanın doğrulanmış arayüz adımları:
- Takip Etiketi Yönetimi ekranında "Yeni Takip Etiketi Ekle" düğmesi vardır.
  Formda takip etiketi kodu, görünen isim ve kayıt durumu bulunur; "Takip
  Etiketini Kaydet" ile kayıt tamamlanır. Başka menü adları uydurma.
- Rota Geçmişi ekranında cihaz/takip etiketi aranır, izlenen varlık ve başlangıç/
  bitiş zamanı seçilir, ardından "Geçmişi Getir" kullanılır. Bu ekranı açıklamak
  için gerçek geçmiş içeriğine erişmen gerekmez.
- Kayıtsız takip etiketleri canlı akışta görünebilir; geçmişe yazılmaz.

Araç kullanım kuralları:
- Kullanıcı doğrudan entityId vermediyse veya konuşmada daha önce kesin olarak
  seçilmiş bir entityId yoksa önce search_entities aracını kullan.
- Arayüz bağlamında tagCode varsa bu tag kodunu önce search_entities ile
  doğrula; belirsizlik varsa kullanıcıdan seçim iste.
- Arama birden fazla sonuç döndürürse kendin seçim yapma. Kısa bir seçenek
  listesi ver ve kullanıcıdan seçim iste.
- Güncel konum sorularında get_current_location kullan.
- Belirli bir tarih/saatteki konum için get_location_at_time kullan.
- Bir zaman aralığındaki oda/bölge geçişleri ve kalış süreleri için
  get_location_history aracını format="zone_timeline" ile kullan.
- Kullanıcı açıkça koordinat, rota veya harita istemedikçe route_points kullanma.
- Tool çağrılarında tarihleri ISO 8601 biçiminde ve Europe/Istanbul için +03:00
  ofsetiyle gönder.
- "Tanımlı alan dışında" sonucunu hayali bir oda adıyla değiştirme.
- Tool sonucunda bulunmayan Oda 34, Oda 65 gibi isimleri tahmin etme.
- `partial` ve veri kaynağına ilişkin rutin uyarılar iç teknik metadadır; bunları,
  ham durum adlarını veya uyarı metnini kullanıcıya aktarma. Bu bilgiler sonucu
  kullanmayı gerçekten etkiliyorsa yalnızca pratik etkisini sade dille belirt.
- `stale` veya `offline` durumunda konumun güncel olmayabileceğini açıkça söyle.
- `ambiguous` durumunda seçim iste; `no_data` durumunda konum verisi olmadığını
  açıkça söyle.
- Veri yoksa bunu açıkça söyle; genel bilgiden konum üretme.
- Yanıtı kısa, anlaşılır ve Türkçe ver.
- Yanıtta Markdown kullanma; **, __, başlık işareti, backtick veya madde
  işaretleri yazma.
- Süreleri mümkünse dakika/saniye olarak okunabilir biçimde özetle.
""".strip()


def build_mcp_environment() -> dict[str, str]:
    """Pass app configuration to MCP without exposing model-provider API keys."""
    child_environment = dict(os.environ)
    for key in tuple(child_environment):
        if (
            key.startswith("OPENAI_")
            or key.startswith("GEMINI_")
            or key == "GOOGLE_API_KEY"
        ):
            child_environment.pop(key, None)
    return child_environment


def format_provider_error(error: Exception, model: str = MODEL) -> str:
    message = str(error)
    normalized = message.casefold()

    if "429" in normalized or "resource_exhausted" in normalized:
        return (
            "Gemini API kotası aşıldı. Google AI Studio kullanım limitlerini "
            "ve bağlı Google Cloud projesinin faturalandırmasını kontrol edin."
        )
    if "no longer available" in normalized or (
        "404" in normalized and "model" in normalized
    ):
        return (
            f"{model} modeli bu API anahtarı için kullanılamıyor. "
            'CMD üzerinde set "GEMINI_MODEL=gemini-3.6-flash" komutunu '
            "çalıştırın veya GEMINI_MODEL değişkenini kaldırın."
        )
    if (
        "api_key_invalid" in normalized
        or "api key not valid" in normalized
        or "invalid api key" in normalized
    ):
        return "Gemini API anahtarı geçersiz veya iptal edilmiş."
    if "permission_denied" in normalized or "403" in normalized:
        return "Gemini API erişimi reddedildi. Anahtar ve proje izinlerini kontrol edin."
    if "timeout" in normalized or "deadline" in normalized:
        return "Gemini yanıtı zaman aşımına uğradı. Lütfen biraz sonra tekrar deneyin."

    return "Gemini yanıtı tamamlanamadı. Lütfen biraz sonra tekrar deneyin."


def _safe_json(value: Any) -> str:
    try:
        if hasattr(value, "model_dump"):
            payload = value.model_dump(mode="json")
        else:
            payload = value
        return json.dumps(payload, ensure_ascii=False, default=str)
    except Exception:
        return str(value)


def _clean_context_value(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _to_plain_answer(value: str) -> str:
    text = value.strip()
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"__([^_]+)__", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"(?m)^\s*#{1,6}\s+", "", text)
    text = re.sub(r"(?m)^\s*[-*]\s+", "", text)
    return text.strip()


def _build_context_prompt(context: Mapping[str, Any] | None, tag_lookup_result: str | None) -> str:
    mode = _clean_context_value((context or {}).get("mode"))
    lines = [
        "Arayüz bağlamı:",
        f"- Bağlam türü: {mode or 'belirtilmedi'}",
        "- Geçmiş noktaları arayüzün gerçek location history API sonucudur; demo veri değildir.",
        "- Canlı bağlam anlık bir UI görüntüsüdür; güncel doğrulama gerektiğinde bağlı konum araçlarını kullan.",
    ]

    context_labels = {
        "selectedTagId": "Seçili tag kimliği",
        "tagCode": "Seçili tag kodu",
        "entityName": "Seçili varlık adı",
        "from": "Başlangıç zamanı",
        "to": "Bitiş zamanı",
        "floorPlanId": "Kat planı",
        "floorPlanName": "Kat/harita adı",
        "buildingName": "Bina",
        "floorLabel": "Kat",
        "sourceZoneId": "Kaynak UWB zone kimliği",
        "sourceZoneName": "Kaynak UWB zone açıklaması",
        "tagStatus": "Tag durumu",
        "zoneName": "Bölge/oda",
    }
    for key, label in context_labels.items():
        value = _clean_context_value((context or {}).get(key))
        if value is not None:
            lines.append(f"- {label}: {value}")

    for key, label in (
        ("livePosition", "Canlı konum"),
        ("history", "Gerçek geçmiş özeti"),
        ("historyPoints", "Gerçek rota noktaları"),
    ):
        value = (context or {}).get(key)
        if value is not None:
            lines.append(f"- {label}: {_safe_json(value)}")

    if tag_lookup_result:
        lines.extend([
            "",
            "Bu istek için search_entities aracı tagCode doğrulaması amacıyla önce çalıştırıldı.",
            "Doğrulama sonucu:",
            tag_lookup_result,
        ])

    return "\n".join(lines)


def _conversation_contents(history: list[Mapping[str, str]], role: str) -> list[types.Content]:
    """Validate replayed text; history never grants tool access or a user role."""
    if len(history) > 20:
        raise AgentUserFacingError("Konuşma geçmişi çok uzun.")
    contents: list[types.Content] = []
    characters = 0
    for turn in history:
        question, answer = turn.get("question"), turn.get("answer")
        if (
            not isinstance(question, str) or not question.strip() or len(question) > 1000
            or not isinstance(answer, str) or not answer.strip() or len(answer) > 8000
        ):
            raise AgentUserFacingError("Konuşma geçmişi geçersiz.")
        characters += len(question) + len(answer)
        if characters > 32000:
            raise AgentUserFacingError("Konuşma geçmişi çok uzun.")
        _, output_reason = safe_answer(answer)
        if not decide_request(question, role).allow_model or output_reason:
            continue
        contents.extend([
            types.Content(role="user", parts=[types.Part(text=question)]),
            types.Content(role="model", parts=[types.Part(text=answer)]),
        ])
    return contents


class LocationAgentRuntime:
    """Owns one Gemini client and one stdio MCP connection for the app lifespan."""

    def __init__(
        self,
        *,
        model: str = MODEL,
        session_ttl_seconds: int = 30 * 60,
        max_sessions: int = 100,
    ) -> None:
        self.model = model
        self.session_ttl_seconds = session_ttl_seconds
        self.max_sessions = max_sessions
        self._client: genai.Client | None = None
        self._mcp_session: ClientSession | None = None
        self._exit_stack: AsyncExitStack | None = None
        self._tool_names: list[str] = []
        self._sessions: dict[str, AgentSession] = {}
        self._sessions_lock = asyncio.Lock()
        self._runtime_lock = asyncio.Lock()
        self._started = False

    async def start(self) -> None:
        async with self._runtime_lock:
            if self._started:
                return

            node_command, api_key = validate_environment()
            client = genai.Client(api_key=api_key)
            exit_stack = AsyncExitStack()
            try:
                server_params = StdioServerParameters(
                    command=node_command,
                    args=["--import", "tsx", str(MCP_SERVER_PATH)],
                    cwd=str(PROJECT_ROOT),
                    env=build_mcp_environment(),
                )
                read_stream, write_stream = await exit_stack.enter_async_context(
                    stdio_client(server_params)
                )
                mcp_session = await exit_stack.enter_async_context(
                    ClientSession(read_stream, write_stream)
                )
                await mcp_session.initialize()
                available_tools = (await mcp_session.list_tools()).tools
                self._tool_names = [tool.name for tool in available_tools]
                self._client = client
                self._mcp_session = mcp_session
                self._exit_stack = exit_stack
                self._started = True
            except Exception:
                await exit_stack.aclose()
                await client.aio.aclose()
                raise

    async def shutdown(self) -> None:
        async with self._runtime_lock:
            self._sessions.clear()
            self._started = False
            mcp_stack = self._exit_stack
            client = self._client
            self._exit_stack = None
            self._mcp_session = None
            self._client = None
            self._tool_names = []

            if mcp_stack is not None:
                await mcp_stack.aclose()
            if client is not None:
                await client.aio.aclose()

    async def health(self) -> dict[str, Any]:
        self._ensure_started()
        await self._cleanup_expired_sessions()
        missing_tools = sorted(EXPECTED_TOOL_NAMES.difference(self._tool_names))
        return {
            "status": "ok" if not missing_tools else "degraded",
            "provider": "gemini",
            "model": self.model,
            "tools": self._tool_names,
            "missingTools": missing_tools,
            "activeSessions": len(self._sessions),
            "sessionTtlSeconds": self.session_ttl_seconds,
            "maxSessions": self.max_sessions,
        }

    async def create_session(self) -> str:
        self._ensure_started()
        async with self._sessions_lock:
            self._cleanup_expired_sessions_locked()
            self._evict_capacity_locked(reserve_slots=1)
            session_id = str(uuid4())
            self._sessions[session_id] = AgentSession(
                chat=self._create_chat(),
                lock=asyncio.Lock(),
                last_access=time.monotonic(),
                role="unauthenticated",
            )
            return session_id

    async def clear_session(self, session_id: str) -> bool:
        async with self._sessions_lock:
            return self._sessions.pop(session_id, None) is not None

    async def answer(
        self,
        message: str,
        *,
        session_id: str | None = None,
        context: Mapping[str, Any] | None = None,
        role: str = "unauthenticated",
        history: list[Mapping[str, str]] | None = None,
    ) -> AgentAnswer:
        self._ensure_started()
        cleaned_message = message.strip()
        if not cleaned_message:
            raise AgentUserFacingError("Mesaj boş olamaz.")
        if len(cleaned_message) > 1000:
            raise AgentUserFacingError("Mesaj en fazla 1000 karakter olabilir.")

        decision = decide_request(cleaned_message, role)
        if not decision.allow_model:
            # Do not create a chat or expose an MCP tool for rejected input.
            return AgentAnswer(session_id=session_id or str(uuid4()), answer=decision.response or OUTPUT_SAFETY_MESSAGE)

        if history is None:
            # Compatibility for the terminal client and older evaluation clients.
            resolved_session_id, session = await self._get_or_create_session(session_id, role=role)
        else:
            resolved_session_id = session_id or str(uuid4())
            session = AgentSession(
                chat=self._create_chat(
                    allow_tools=decision.allow_tools,
                    history=_conversation_contents(history, role),
                ),
                lock=asyncio.Lock(), last_access=time.monotonic(), role=role,
            )
        async with session.lock:
            tag_lookup_result = await self._verify_context_tag(context) if decision.allow_tools else None
            prompt = "\n\n".join([
                _build_context_prompt(context, tag_lookup_result),
                "Kullanıcı sorusu:",
                cleaned_message,
            ])
            try:
                response = await session.chat.send_message(prompt)
            except Exception as error:
                raise AgentProviderError(format_provider_error(error, self.model)) from error

            answer = _to_plain_answer(getattr(response, "text", None) or "")
            if not answer:
                answer = "Gemini yanıt üretemedi. Lütfen sorunuzu biraz daha netleştirerek tekrar deneyin."
            answer, output_reason = safe_answer(answer)
            if output_reason:
                # Keep the reason in server-side structured logs only; never echo
                # the matched content to the user.
                print(json.dumps({"event": "assistant.output_blocked", "reason": output_reason}), file=sys.stderr)
            session.last_access = time.monotonic()
            return AgentAnswer(session_id=resolved_session_id, answer=answer)

    def _ensure_started(self) -> None:
        if not self._started or self._client is None or self._mcp_session is None:
            raise AgentNotReadyError("Gekon AI henüz hazır değil.")

    def _create_chat(self, *, allow_tools: bool = False, history: list[types.Content] | None = None) -> Any:
        self._ensure_started()
        assert self._client is not None
        assert self._mcp_session is not None
        return self._client.aio.chats.create(
            model=self.model,
            history=history or [],
            config=types.GenerateContentConfig(
                system_instruction=build_agent_instructions(),
                temperature=0,
                tools=[self._mcp_session] if allow_tools else [],
            ),
        )

    async def _get_or_create_session(self, session_id: str | None, *, role: str) -> tuple[str, AgentSession]:
        async with self._sessions_lock:
            self._cleanup_expired_sessions_locked()
            if session_id and session_id in self._sessions:
                existing = self._sessions[session_id]
                if existing.role == role:
                    return session_id, existing

            self._evict_capacity_locked(reserve_slots=1)
            resolved_session_id = session_id or str(uuid4())
            session = AgentSession(
                chat=self._create_chat(allow_tools=role in {"clinical_staff", "technical_staff", "unit_manager", "system_admin"}),
                lock=asyncio.Lock(),
                last_access=time.monotonic(),
                role=role,
            )
            self._sessions[resolved_session_id] = session
            return resolved_session_id, session

    async def _verify_context_tag(self, context: Mapping[str, Any] | None) -> str | None:
        tag_code = _clean_context_value((context or {}).get("tagCode"))
        if tag_code is None:
            return None
        self._ensure_started()
        assert self._mcp_session is not None
        try:
            result = await self._mcp_session.call_tool(
                "search_entities",
                {"query": tag_code, "limit": 10},
            )
        except Exception as error:
            raise AgentProviderError(
                "Konum verisi doğrulanamadı. Lütfen biraz sonra tekrar deneyin."
            ) from error
        return _safe_json(result)

    async def _cleanup_expired_sessions(self) -> None:
        async with self._sessions_lock:
            self._cleanup_expired_sessions_locked()

    def _cleanup_expired_sessions_locked(self) -> None:
        expires_before = time.monotonic() - self.session_ttl_seconds
        expired = [
            session_id
            for session_id, session in self._sessions.items()
            if session.last_access < expires_before
        ]
        for session_id in expired:
            self._sessions.pop(session_id, None)

    def _evict_capacity_locked(self, *, reserve_slots: int = 0) -> None:
        overflow = len(self._sessions) + reserve_slots - self.max_sessions
        if overflow <= 0:
            return
        oldest_session_ids = sorted(
            self._sessions,
            key=lambda item: self._sessions[item].last_access,
        )[:overflow]
        for session_id in oldest_session_ids:
            self._sessions.pop(session_id, None)
