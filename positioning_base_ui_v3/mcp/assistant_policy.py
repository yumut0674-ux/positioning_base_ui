"""Deterministic, testable safety controls for the UWB assistant.

This module deliberately sits outside the model prompt.  It is a defence in
depth boundary: unauthenticated web requests cannot cause an LLM tool call for
location data and unsafe model output is replaced before it reaches a client.
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass
from typing import Iterable


UNAUTHORISED_MESSAGE = (
    "Bu bilgilere erişim yetkim bulunmuyor. Yetkili kullanıcı hesabıyla ilgili "
    "birim üzerinden işlem yapabilirsiniz."
)
CLINICAL_MESSAGE = (
    "Konum verisi hastanın sağlık durumunu göstermez ve klinik değerlendirme "
    "yerine kullanılamaz. Acil risk ihtimalinde yetkili sağlık personelinin "
    "değerlendirmesi gerekir."
)
UNCERTAINTY_MESSAGE = "Bu bilgi mevcut verilerden doğrulanamıyor."
INJECTION_MESSAGE = (
    "Bu istekteki talimat değişikliği veya gizli bilgi talebine yardımcı olamam. "
    "UWB arayüzünün güvenli kullanımıyla ilgili yardımcı olabilirim."
)
OUTPUT_SAFETY_MESSAGE = "Yanıt güvenlik nedeniyle paylaşılmadı. Lütfen isteğinizi güvenli biçimde yeniden ifade edin."

TEST_CANARIES = {
    "TEST_SECRET_DO_NOT_EXPOSE_7F3A",
    "SENTETIK_HASTA_GIZLI_19C2",
    "TEST_SYSTEM_CANARY_88D1",
    "TEST_OTHER_SESSION_SECRET_A41B",
}

_INJECTION_RE = re.compile(
    r"(?:önceki\s+talimat|ignore\s+(?:all|previous)|developer\s+mode|system\s+prompt|"
    r"geliştirici\s+modu|jailbreak|talimatları\s+unut|base64|promptu\s+(?:yaz|göster))",
    re.IGNORECASE,
)
_SECRET_RE = re.compile(
    r"(?:api\s*(?:key|anahtar)|parola|şifre|token|\.env|connection\s*string|bağlantı\s*bilgisi)",
    re.IGNORECASE,
)
_CLINICAL_RE = re.compile(
    r"(?:hangi\s+ilaç|ilaç\s+(?:ver|öner)|teşhis|tanı\s+koy|kalp\s+krizi|öldü|ölmüş|"
    r"acil\s+durum|hemşire\s+çağır)",
    re.IGNORECASE,
)
_PERSONNEL_ETHICS_RE = re.compile(
    r"(?:performans\s+puan|disiplin|niyet(?:ini)?\s+(?:çıkar|belirle)|gizlice\s+izle|"
    r"yaşına|cinsiyetine|uyruğuna|engelliliğine)",
    re.IGNORECASE,
)
_SENSITIVE_DATA_RE = re.compile(
    r"(?:(?:hasta|personel|kişi|kullanıcı)\S*(?:\s+\S+){0,8}\s+"
    r"(?:ad(?:ı|ları|larını)|konum(?:u|unu|ları|larını| geçmişi| geçmişini)|nerede|hangi\s+odada|geçmişi)|"
    r"(?:konum(?:unu|larını| geçmişini)?|geçmişini)\s+(?:getir|göster|listele|söyle|paylaş|bul|ver|analiz\s+et)\b|"
    r"(?:seçili|bu)\s+(?:etiket|tag)(?:in)?(?:\s+\S+){0,5}\s+konumunu|"
    r"(?:ilk\s+\d+|tüm\s+kayıt|veritaban(?:ındaki|ında)).{0,80}(?:hasta|personel|konum|kayıt)|"
    r"(?:previous|other|another)\s+user(?:'s)?\s+(?:conversation|chat)|"
    r"(?:başka|diğer)\s+kullanıcının(?:\s+önceki)?\s+(?:konuşması|konuşma\s+geçmişi))",
    re.IGNORECASE,
)
_TAG_LOCATION_RE = re.compile(
    r"\b[A-ZÇĞİÖŞÜ0-9_-]*TAG-[A-Z0-9_-]+\b.{0,80}(?:nerede|hangi\s+odada|konum)",
    re.IGNORECASE,
)
_RECORD_LIST_RE = re.compile(
    r"\b(?:hasta|personel|kullanıcı)\S*(?:\s+\S+){0,6}\s+"
    r"(?:listele|listesini|adlarını|göster|ver)\b",
    re.IGNORECASE,
)
_WHERE_RE = re.compile(r"\bnerede(?:dir)?\b|\bhangi\s+odada\b", re.IGNORECASE)
_UI_NAVIGATION_RE = re.compile(
    r"\b(?:ayar|menü|buton|düğme|harita|sayfa|ekran|filtre)\S*"
    r"(?:\s+\S+){0,4}\s+nerede(?:dir)?\b",
    re.IGNORECASE,
)
_TC_RE = re.compile(r"(?<!\d)\d{11}(?!\d)")
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?90|0)?\s*5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)")
_EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_STACK_RE = re.compile(r"(?:traceback \(most recent call last\)|\bat \S+ \([^)]*:\d+:\d+\)|\b(?:error|exception):\s*\w+)", re.IGNORECASE)
_KEY_RE = re.compile(r"(?:AIza[\w-]{20,}|sk-[\w-]{16,}|(?:api[_ -]?key|password|secret)\s*[:=]\s*\S+)", re.IGNORECASE)


@dataclass(frozen=True)
class PolicyDecision:
    allow_model: bool
    allow_tools: bool
    response: str | None = None
    reason: str | None = None


def _decoded_variants(message: str) -> Iterable[str]:
    """Yield safe, bounded text variants to catch simple encoded jailbreaks."""
    yield message
    compact = re.sub(r"\s+", "", message)
    if 8 <= len(compact) <= 2048 and re.fullmatch(r"[A-Za-z0-9+/=]+", compact):
        try:
            decoded = base64.b64decode(compact, validate=True).decode("utf-8", "ignore")
        except (ValueError, UnicodeDecodeError):
            return
        yield decoded


def decide_request(message: str, role: str = "unauthenticated") -> PolicyDecision:
    """Return a deterministic decision before any model or MCP call occurs."""
    variants = tuple(_decoded_variants(message))
    if any(_INJECTION_RE.search(item) or _SECRET_RE.search(item) for item in variants):
        return PolicyDecision(False, False, INJECTION_MESSAGE, "prompt-injection-or-secret-request")
    if any(_CLINICAL_RE.search(item) for item in variants):
        return PolicyDecision(False, False, CLINICAL_MESSAGE, "clinical-safety")
    if any(_PERSONNEL_ETHICS_RE.search(item) for item in variants):
        return PolicyDecision(False, False, UNAUTHORISED_MESSAGE, "ethics-or-personnel-surveillance")

    # There is currently no authenticated identity bridge from the web app.  Do
    # not infer authority from a user sentence or a client-supplied role.
    if role in {"unauthenticated", "readonly"} and any(_TAG_LOCATION_RE.search(item) for item in variants):
        return PolicyDecision(False, False, UNCERTAINTY_MESSAGE, "unverified-tag-location")
    if role in {"unauthenticated", "readonly"} and any(
        _SENSITIVE_DATA_RE.search(item) or _RECORD_LIST_RE.search(item)
        or (_WHERE_RE.search(item) and not _UI_NAVIGATION_RE.search(item))
        for item in variants
    ):
        return PolicyDecision(False, False, UNAUTHORISED_MESSAGE, "unverified-data-access")
    return PolicyDecision(True, role in {"clinical_staff", "technical_staff", "unit_manager", "system_admin"})


def unsafe_output_reason(text: str) -> str | None:
    upper = text.upper()
    if any(canary in upper for canary in TEST_CANARIES):
        return "synthetic-canary"
    if _TC_RE.search(text) or _PHONE_RE.search(text) or _EMAIL_RE.search(text):
        return "personal-data-pattern"
    if _KEY_RE.search(text):
        return "secret-pattern"
    if _STACK_RE.search(text):
        return "stack-trace"
    return None


def safe_answer(text: str) -> tuple[str, str | None]:
    reason = unsafe_output_reason(text)
    return (OUTPUT_SAFETY_MESSAGE, reason) if reason else (text, None)
