"""Local FastAPI bridge for the UWB Gemini + MCP location assistant."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from location_agent_runtime import (
    AgentNotReadyError,
    AgentProviderError,
    AgentUserFacingError,
    LocationAgentRuntime,
    MODEL,
)


def _trim_or_none(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        return value
    cleaned = value.strip()
    return cleaned or None


def _validate_iso_with_timezone(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise ValueError("ISO 8601 tarih biçimi geçersiz") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("Tarih açık bir timezone bilgisi içermelidir")
    return value


class ContextPosition(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    x: float
    y: float
    observed_at: str = Field(alias="observedAt")
    zone_name: str | None = Field(default=None, alias="zoneName", max_length=160)

    @field_validator("observed_at")
    @classmethod
    def date_must_include_timezone(cls, value: str) -> str:
        validated = _validate_iso_with_timezone(value)
        assert validated is not None
        return validated


class HistorySummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    returned_count: int = Field(alias="returnedCount", ge=0)
    source_point_count: int = Field(alias="sourcePointCount", ge=0)
    sampled: bool
    distance_meters: float = Field(alias="distanceMeters", ge=0)


class ChatContext(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    mode: str | None = Field(default=None, pattern="^(live|history)$")
    selected_tag_id: str | None = Field(default=None, alias="selectedTagId", max_length=100)
    tag_code: str | None = Field(default=None, alias="tagCode", max_length=100)
    entity_name: str | None = Field(default=None, alias="entityName", max_length=160)
    from_time: str | None = Field(default=None, alias="from")
    to_time: str | None = Field(default=None, alias="to")
    floor_plan_id: str | None = Field(default=None, alias="floorPlanId", max_length=100)
    floor_plan_name: str | None = Field(default=None, alias="floorPlanName", max_length=160)
    tag_status: str | None = Field(default=None, alias="tagStatus", max_length=50)
    zone_name: str | None = Field(default=None, alias="zoneName", max_length=160)
    live_position: ContextPosition | None = Field(default=None, alias="livePosition")
    history: HistorySummary | None = None
    history_points: list[ContextPosition] | None = Field(default=None, alias="historyPoints", max_length=200)

    @field_validator(
        "mode", "tag_code", "entity_name", "floor_plan_id",
        "floor_plan_name", "tag_status", "zone_name", mode="before",
    )
    @classmethod
    def trim_optional_strings(cls, value: Any) -> str | None:
        return _trim_or_none(value)

    @field_validator("from_time", "to_time", mode="before")
    @classmethod
    def trim_optional_dates(cls, value: Any) -> str | None:
        return _trim_or_none(value)

    @field_validator("from_time", "to_time")
    @classmethod
    def dates_must_include_timezone(cls, value: str | None) -> str | None:
        return _validate_iso_with_timezone(value)


class ChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    message: str = Field(min_length=1, max_length=1000)
    session_id: str | None = Field(default=None, alias="sessionId", min_length=1, max_length=100)
    context: ChatContext | None = None

    @field_validator("message", mode="before")
    @classmethod
    def trim_message(cls, value: Any) -> str:
        if not isinstance(value, str):
            return value
        return value.strip()

    @field_validator("session_id", mode="before")
    @classmethod
    def trim_session_id(cls, value: Any) -> str | None:
        return _trim_or_none(value)


@asynccontextmanager
async def lifespan(app: FastAPI):
    runtime = LocationAgentRuntime()
    await runtime.start()
    app.state.location_agent_runtime = runtime
    try:
        yield
    finally:
        await runtime.shutdown()


app = FastAPI(
    title="UWB Location Assistant",
    version="1.0.0",
    lifespan=lifespan,
)


def _runtime() -> LocationAgentRuntime:
    runtime = getattr(app.state, "location_agent_runtime", None)
    if not isinstance(runtime, LocationAgentRuntime):
        raise HTTPException(status_code=503, detail="Gekon AI henüz hazır değil.")
    return runtime


@app.get("/health")
async def health() -> dict[str, Any]:
    try:
        data = await _runtime().health()
    except AgentNotReadyError as error:
        raise HTTPException(status_code=503, detail=error.public_message) from error
    return {"data": data, "meta": {"provider": "gemini", "model": MODEL}}


@app.post("/chat")
async def chat(request: ChatRequest) -> dict[str, Any]:
    context = request.context.model_dump(by_alias=True, exclude_none=True) if request.context else None
    try:
        result = await _runtime().answer(
            request.message,
            session_id=request.session_id,
            context=context,
        )
    except AgentProviderError as error:
        raise HTTPException(status_code=502, detail=error.public_message) from error
    except AgentUserFacingError as error:
        raise HTTPException(status_code=400, detail=error.public_message) from error

    return {
        "data": {
            "sessionId": result.session_id,
            "answer": result.answer,
        },
        "meta": {
            "provider": "gemini",
            "model": MODEL,
        },
    }


@app.delete("/chat/{session_id}")
async def clear_chat(session_id: str) -> dict[str, Any]:
    if not session_id.strip():
        raise HTTPException(status_code=400, detail="Oturum kimliği boş olamaz.")
    cleared = await _runtime().clear_session(session_id.strip())
    return {"data": {"sessionId": session_id.strip(), "cleared": cleared}}
