from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Any
import json, asyncio
from app.simulation.orchestrator import orchestrator

router = APIRouter()

class RunReq(BaseModel):
    project: dict
    duration_ns: int | None = None

@router.post("/run")
async def run(req: RunReq):
    await orchestrator.initialize(req.project)
    # advance a little to prove wiring
    await orchestrator.advance_to(1_000_000)
    snap = await orchestrator.snapshot()
    return {"status": "running", "time_ns": orchestrator.time_ns, "snapshot": snap}

@router.post("/stop")
async def stop():
    await orchestrator.shutdown()
    return {"status": "stopped"}

@router.post("/step")
async def step(req: RunReq):
    await orchestrator.advance_to(req.duration_ns or 1_000_000)
    return {"time_ns": orchestrator.time_ns}

@router.get("/state")
async def state():
    return {"time_ns": orchestrator.time_ns, "running": orchestrator.running, "snapshot": await orchestrator.snapshot()}

@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            msg = await ws.receive_text()
            data = json.loads(msg)
            op = data.get("op")
            if op == "set_sensor_input":
                # generic sensor bridge: e.g. {"componentId":"pir-1","key":"motion","value":true}
                await ws.send_json({"type":"sensor_ack", "componentId": data.get("componentId"), "value": data.get("value")})
                # echo as serial/pin event
                await ws.send_json({"type":"pin", "pin": data.get("componentId"), "state": data.get("value"), "time_ns": orchestrator.time_ns})
            elif op == "run":
                await orchestrator.initialize(data.get("project",{}))
                await ws.send_json({"type":"simulation_state", "time_ns": orchestrator.time_ns, "status":"running"})
            elif op == "stop":
                await orchestrator.shutdown()
                await ws.send_json({"type":"simulation_state", "status":"stopped"})
            elif op == "read_pin":
                v = await orchestrator.read_port("renode", data.get("portId",""))
                await ws.send_json({"type":"pin_value", "portId": data.get("portId"), "value": v.__dict__})
            else:
                await ws.send_json({"type":"error", "message": f"unknown op {op}"})
    except WebSocketDisconnect:
        pass
