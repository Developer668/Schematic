import asyncio
from app.simulation.orchestrator import SimulationOrchestrator

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
