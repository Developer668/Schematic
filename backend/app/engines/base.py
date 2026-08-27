from app.simulation.engine import SimulationEngine, CompiledSubgraph, PortValue

class StubEngine(SimulationEngine):
    """Stub for unimplemented engines — returns architecture_ready without executing."""
    def __init__(self, name: str, purpose: str):
        self.name = name
        self.purpose = purpose
        self._snap = b""

    async def initialize(self, model: CompiledSubgraph): self._model = model
    async def advance_to(self, time_ns: int): pass
    async def write_port(self, port_id: str, value: PortValue): pass
    async def read_port(self, port_id: str) -> PortValue: return PortValue()
    async def snapshot(self) -> bytes: return self._snap
    async def restore(self, snapshot: bytes): self._snap = snapshot
    async def shutdown(self): pass

    def status(self): return {"engine": self.name, "status": "architecture_ready", "purpose": self.purpose}
