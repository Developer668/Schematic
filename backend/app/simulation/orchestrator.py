"""Session-oriented simulation orchestration.

The old implementation broadcast every graph to a collection of stubs and
kept mutable state in a process-wide singleton. This manager owns only
isolated sessions and currently assigns supported graphs to the deterministic
behavioral runner. Unimplemented engines are not initialized or reported as
successful simulation backends.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.simulation.behavioral import BEHAVIORAL_BOARD_FQBNS, BehavioralSession
from app.simulation.engine import CompiledSubgraph, PortValue


@dataclass
class SessionRecord:
    session_id: str
    runner: BehavioralSession
    owner_id: str
    project_fingerprint: str
    running: bool = False
    last_used: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class SimulationOrchestrator:
    """Owns isolated simulation sessions for API and test callers."""

    MAX_SESSIONS = 128
    SESSION_TTL_SECONDS = 3600

    def __init__(self) -> None:
        self.sessions: dict[str, SessionRecord] = {}
        self.default_session_id: str | None = None

    @property
    def time_ns(self) -> int:
        record = self._default_record()
        return record.runner.time_ns if record else 0

    @property
    def running(self) -> bool:
        record = self._default_record()
        return record.running if record else False

    def _default_record(self) -> SessionRecord | None:
        return self.sessions.get(self.default_session_id or "")

    @staticmethod
    def _owner(owner_id: str | None) -> str:
        value = str(owner_id or "anonymous").strip()
        return value[:200] or "anonymous"

    @staticmethod
    def _project_fingerprint(project: dict[str, Any]) -> str:
        payload = json.dumps(project, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _cleanup_sessions(self) -> None:
        now = time.monotonic()
        expired = [
            session_id
            for session_id, record in self.sessions.items()
            if not record.running and now - record.last_used > self.SESSION_TTL_SECONDS
        ]
        for session_id in expired:
            self.sessions.pop(session_id, None)
        if self.default_session_id not in self.sessions:
            self.default_session_id = next(iter(self.sessions), None)

    def _touch(self, record: SessionRecord) -> None:
        record.last_used = time.monotonic()

    def partition(self, project: dict[str, Any]) -> dict[str, CompiledSubgraph]:
        """Build the execution plan without handing work to placeholder engines."""
        components = project.get("components", []) if isinstance(project, dict) else []
        targets = project.get("firmwareTargets", project.get("firmware_targets", [])) if isinstance(project, dict) else []
        supported_component_ids = set(BEHAVIORAL_BOARD_FQBNS) | {"ds3231", "ds3231-2", "ds3231-3", "led", "led-10mm-red", "ws2812b-1-led"}
        assigned = [component for component in components if isinstance(component, dict) and str(component.get("definitionId", component.get("definition_id", ""))) in supported_component_ids]
        if not assigned and not targets:
            return {}
        return {
            "behavioral": CompiledSubgraph(
                engine="behavioral",
                components=assigned,
                connections=project.get("connections", []),
                firmware=targets if isinstance(targets, list) else [],
            ),
        }

    def create_session(self, project: dict[str, Any], session_id: str | None = None, owner_id: str | None = None) -> str:
        self._cleanup_sessions()
        requested = session_id or f"sim-{uuid.uuid4()}"
        owner = self._owner(owner_id)
        fingerprint = self._project_fingerprint(project)
        existing = self.sessions.get(requested)
        project_id = project.get("id") if isinstance(project, dict) else None
        if existing and existing.owner_id != owner:
            raise PermissionError("session_id is owned by another room")
        if existing and project_id and existing.runner.project.get("id") not in {None, project_id}:
            raise ValueError("session_id is already bound to a different project")
        if existing and existing.project_fingerprint != fingerprint:
            if existing.running:
                raise ValueError("simulation session is executing the previous project; retry after it stops")
            # A browser keeps the session id across runs, so a firmware edit or
            # wire change must replace the old runner instead of silently
            # executing stale graph state under the same project id.
            existing.runner = BehavioralSession(project)
            existing.project_fingerprint = fingerprint
        if not existing:
            if len(self.sessions) >= self.MAX_SESSIONS:
                self._cleanup_sessions()
            if len(self.sessions) >= self.MAX_SESSIONS:
                raise ValueError("simulation session capacity has been reached; stop an idle session and retry")
            self.sessions[requested] = SessionRecord(requested, BehavioralSession(project), owner, fingerprint)
        self._touch(self.sessions[requested])
        self.default_session_id = requested
        return requested

    def get_session(self, session_id: str | None = None, owner_id: str | None = None, allow_default: bool = False) -> SessionRecord | None:
        self._cleanup_sessions()
        requested = session_id or (self.default_session_id if allow_default else None)
        record = self.sessions.get(requested or "")
        if not record:
            return None
        if record.owner_id != self._owner(owner_id):
            raise PermissionError("session_id is owned by another room")
        self._touch(record)
        return record

    async def initialize(self, project: dict[str, Any], session_id: str | None = None, owner_id: str | None = None) -> str:
        return self.create_session(project, session_id, owner_id)

    async def run(self, project: dict[str, Any], inputs: dict[str, bool | float], duration_ns: int, session_id: str | None = None, owner_id: str | None = None) -> dict[str, Any]:
        sid = self.create_session(project, session_id, owner_id)
        record = self.sessions[sid]
        async with record.lock:
            record.running = True
            try:
                result = record.runner.run(inputs, duration_ns)
            finally:
                record.running = False
            self._touch(record)
            result["session_id"] = sid
            result["running"] = False
            return result

    async def advance_to(self, time_ns: int, session_id: str | None = None, owner_id: str | None = None) -> dict[str, Any]:
        record = self.get_session(session_id, owner_id)
        if not record:
            raise ValueError("simulation session is not initialized")
        async with record.lock:
            # Re-evaluate the deterministic program at the requested time. A
            # clock-only jump leaves firmware outputs stale and falsely implies
            # that loop code continued to run.
            result = record.runner.run(dict(record.runner.inputs), max(record.runner.time_ns, int(time_ns)))
            self._touch(record)
            result["session_id"] = record.session_id
            result["running"] = record.running
            return result

    async def write_port(self, port_id: str, value: PortValue, session_id: str | None = None, owner_id: str | None = None) -> None:
        record = self.get_session(session_id, owner_id)
        if not record:
            raise ValueError("simulation session is not initialized")
        if value.digital is not None:
            record.runner.inputs[port_id] = value.digital
        elif value.analog is not None:
            record.runner.inputs[port_id] = value.analog

    async def read_port(self, port_id: str, session_id: str | None = None, owner_id: str | None = None) -> PortValue:
        record = self.get_session(session_id, owner_id)
        if not record:
            raise ValueError("simulation session is not initialized")
        value = record.runner.outputs.get(port_id)
        if isinstance(value, bool):
            return PortValue(digital=value)
        if isinstance(value, (int, float)):
            return PortValue(analog=float(value))
        return PortValue()

    async def snapshot(self, session_id: str | None = None, owner_id: str | None = None) -> dict[str, Any]:
        record = self.get_session(session_id, owner_id)
        if not record:
            return {"session_id": session_id, "time_ns": 0, "running": False, "runtime": None, "engines": {}}
        runtime = record.runner.snapshot()
        return {
            "session_id": record.session_id,
            "time_ns": record.runner.time_ns,
            "running": record.running,
            "runtime": runtime,
            "engines": {"behavioral": runtime},
        }

    async def restore(self, snapshot: dict[str, Any], session_id: str | None = None, owner_id: str | None = None) -> None:
        record = self.get_session(session_id or snapshot.get("session_id"), owner_id)
        if not record:
            raise ValueError("simulation session is not initialized")
        runtime = snapshot.get("runtime") or snapshot.get("engines", {}).get("behavioral")
        if not isinstance(runtime, dict):
            raise ValueError("snapshot does not contain a behavioral runtime")
        record.runner.restore(runtime)
        self.default_session_id = record.session_id

    async def shutdown(self, session_id: str | None = None, owner_id: str | None = None) -> None:
        record = self.get_session(session_id, owner_id)
        if record:
            record.running = False
            self.sessions.pop(record.session_id, None)
            if self.default_session_id == record.session_id:
                self.default_session_id = next(iter(self.sessions), None)

    async def state(self, session_id: str | None = None, owner_id: str | None = None) -> dict[str, Any]:
        record = self.get_session(session_id, owner_id)
        if not record:
            return {"session_id": session_id, "time_ns": 0, "running": False, "snapshot": None}
        return {"session_id": record.session_id, "time_ns": record.runner.time_ns, "running": record.running, "snapshot": await self.snapshot(record.session_id, owner_id), "result": record.runner.result()}
