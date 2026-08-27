import asyncio
from app.simulation.orchestrator import SimulationOrchestrator
from app.api.routes.simulation import RunReq, run as run_simulation

def test_orchestrator_partition():
    o = SimulationOrchestrator()
    proj = {"components":[{"id":"a","definitionId":"esp32-s3"}],"connections":[],"firmwareTargets":[]}
    parts = o.partition(proj)
    assert "renode" in parts
    assert "ngspice" in parts

def test_orchestrator_advance():
    async def run():
        o = SimulationOrchestrator()
        await o.initialize({"components":[],"connections":[],"firmwareTargets":[]})
        await o.advance_to(1000)
        assert o.time_ns == 1000
        snap = await o.snapshot()
        assert "time_ns" in snap
        await o.restore(snap)
        await o.shutdown()
    asyncio.run(run())

def test_run_routes_sensor_inputs_through_behavior_engine():
    async def exercise():
        response = await run_simulation(RunReq(
            project={"components": [], "connections": [], "firmwareTargets": []},
            duration_ns=2_000_000,
            inputs={"bmp:temperatureC": 23.8, "pir:motion": True},
        ))
        assert response["time_ns"] == 2_000_000
        assert response["outputs"] == {"bmp:temperatureC": 23.8, "pir:motion": True}
    asyncio.run(exercise())
