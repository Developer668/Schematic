from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app.auth.session import SessionIdentity, consume_ws_ticket, require_session, route_identity, resolve_session, verify_session_token
from app.simulation.engine import PortValue
from app.simulation.orchestrator import SimulationOrchestrator

router = APIRouter()
orchestrator = SimulationOrchestrator()


class RunReq(BaseModel):
    project: dict[str, Any] = Field(default_factory=dict)
    duration_ns: int | None = None
    inputs: dict[str, bool | float] = Field(default_factory=dict)
    session_id: str | None = None


class StopReq(BaseModel):
    session_id: str | None = None


def _duration(req: RunReq) -> int:
    return max(0, min(int(req.duration_ns or 1_000_000), 86_400_000_000_000))


@router.post("/run")
async def run(req: RunReq, identity: SessionIdentity = Depends(require_session)):
    owner_id = route_identity(identity).subject
    if not isinstance(req.project, dict) or not req.project.get("components") and not req.project.get("firmwareTargets") and not req.project.get("firmware_targets"):
        # Empty projects are valid and return an honest no-firmware result.
        project = req.project if isinstance(req.project, dict) else {}
    else:
        project = req.project
    try:
        return await orchestrator.run(project, dict(req.inputs), _duration(req), req.session_id, owner_id)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/stop")
async def stop(req: StopReq | None = None, identity: SessionIdentity = Depends(require_session)):
    owner_id = route_identity(identity).subject
    try:
        await orchestrator.shutdown(req.session_id if req else None, owner_id)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    return {"status": "stopped", "session_id": req.session_id if req else None}


@router.post("/step")
async def step(req: RunReq, identity: SessionIdentity = Depends(require_session)):
    owner_id = route_identity(identity).subject
    try:
        session = orchestrator.get_session(req.session_id, owner_id)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    if not session and req.project:
        try:
            sid = await orchestrator.initialize(req.project, req.session_id, owner_id)
            session = orchestrator.get_session(sid, owner_id)
        except PermissionError as error:
            raise HTTPException(status_code=403, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
    if not session:
        raise HTTPException(status_code=409, detail="simulation session is not initialized")
    delta = _duration(req)
    try:
        return await orchestrator.advance_to(session.runner.time_ns + delta, session.session_id, owner_id)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/state")
async def state(session_id: str | None = Query(default=None), identity: SessionIdentity = Depends(require_session)):
    try:
        return await orchestrator.state(session_id, route_identity(identity).subject)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    headers = {key.lower(): value for key, value in ws.headers.items()}
    protocols = [value.strip() for value in (ws.headers.get("sec-websocket-protocol") or "").split(",") if value.strip()]
    ticket_protocol = next((value for value in protocols if value.startswith("schematic-ticket.")), None)
    session_protocol = next((value for value in protocols if value.startswith("schematic-token.")), None)
    try:
        if ticket_protocol:
            identity = consume_ws_ticket(ticket_protocol.removeprefix("schematic-ticket."))
        elif session_protocol:
            identity = verify_session_token(session_protocol.removeprefix("schematic-token."))
        else:
            identity = await resolve_session(headers, allow_development=True)
    except HTTPException:
        await ws.close(code=4401)
        return
    if identity is None:
        await ws.close(code=4401)
        return
    selected_protocol = "schematic-bearer" if "schematic-bearer" in protocols else "schematic-local" if "schematic-local" in protocols else None
    await ws.accept(subprotocol=selected_protocol)
    session_id: str | None = None
    owner_id = identity.subject
    pending_inputs: dict[str, bool | float] = {}
    try:
        while True:
            try:
                data = json.loads(await ws.receive_text())
            except (json.JSONDecodeError, TypeError):
                await ws.send_json({"type": "error", "code": "INVALID_JSON", "message": "WebSocket messages must be JSON objects."})
                continue
            if not isinstance(data, dict):
                await ws.send_json({"type": "error", "code": "INVALID_MESSAGE", "message": "WebSocket messages must be JSON objects."})
                continue
            op = data.get("op")
            try:
                if op == "set_sensor_input":
                    component_id = str(data.get("componentId", ""))
                    key = str(data.get("key", "value"))
                    value = data.get("value")
                    if not isinstance(value, (bool, int, float)):
                        await ws.send_json({"type": "error", "code": "INVALID_INPUT", "message": "Sensor input must be boolean or numeric."})
                        continue
                    pending_inputs[f"{component_id}:{key}"] = value
                    if session_id:
                        await orchestrator.write_port(f"{component_id}:{key}", PortValue(digital=value) if isinstance(value, bool) else PortValue(analog=float(value)), session_id, owner_id)
                    await ws.send_json({"type": "sensor_ack", "session_id": session_id, "componentId": component_id, "key": key, "value": value})
                elif op == "run":
                    project = data.get("project", {})
                    inputs = dict(pending_inputs)
                    provided = data.get("inputs", {})
                    if isinstance(provided, dict): inputs.update({str(key): value for key, value in provided.items() if isinstance(value, (bool, int, float))})
                    result = await orchestrator.run(project if isinstance(project, dict) else {}, inputs, int(data.get("duration_ns", 1_000_000)), data.get("session_id") or session_id, owner_id)
                    session_id = result["session_id"]
                    await ws.send_json({"type": "simulation_result", **result})
                elif op == "stop":
                    await orchestrator.shutdown(session_id, owner_id)
                    await ws.send_json({"type": "simulation_state", "session_id": session_id, "status": "stopped"})
                    session_id = None
                elif op == "read_pin":
                    if not session_id:
                        raise ValueError("simulation session is not initialized")
                    value = await orchestrator.read_port(str(data.get("portId", "")), session_id, owner_id)
                    await ws.send_json({"type": "pin_value", "session_id": session_id, "portId": data.get("portId"), "value": value.__dict__})
                else:
                    await ws.send_json({"type": "error", "code": "UNKNOWN_OPERATION", "message": f"unknown op {op}"})
            except PermissionError as error:
                await ws.send_json({"type": "error", "code": "SESSION_FORBIDDEN", "message": str(error)})
            except (ValueError, TypeError, KeyError) as error:
                await ws.send_json({"type": "error", "code": "SIMULATION_ERROR", "message": str(error)})
    except WebSocketDisconnect:
        pass
