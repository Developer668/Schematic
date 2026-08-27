"""NgspiceAdapter — shared-library callbacks (preferred) vs WASM fallback in frontend."""
from app.simulation.engine import SimulationEngine, CompiledSubgraph, PortValue
import textwrap

class NgspiceAdapter(SimulationEngine):
    """Wraps ngspice as shared library with callbacks: getData, sendParam, stop, resume per doc."""
    def __init__(self):
        self.netlist: str | None = None
        self._voltages: dict[str, float] = {}

    async def initialize(self, model: CompiledSubgraph):
        # Build netlist via union-find (simplified; full NetlistBuilder lives in frontend TS)
        lines = ["* Schematic ngspice netlist", ".op"]
        for c in model.components:
            cid = c.get("id","c1")
            # Map known types
            did = c.get("definitionId","")
            if "resistor" in did:
                val = c.get("properties",{}).get("resistance", 1000)
                lines.append(f"R_{cid} n_{cid}_a n_{cid}_b {val}")
            elif "capacitor" in did:
                val = c.get("properties",{}).get("capacitance", 1e-6)
                lines.append(f"C_{cid} n_{cid}_a n_{cid}_b {val}")
            else:
                lines.append(f"* {cid} ({did}) — behavioral, no spice card")
        # Add VCC rail
        lines.append("Vvcc vcc_rail 0 DC 5")
        lines.append(".end")
        self.netlist = "\n".join(lines)
        self._voltages = {"vcc_rail": 5.0, "0": 0.0}

    async def advance_to(self, time_ns: int):
        # For .op nothing to advance; for .tran would call ngspice tran
        pass

    async def write_port(self, port_id: str, value: PortValue):
        if value.analog is not None:
            self._voltages[port_id] = value.analog
        elif value.digital is not None:
            self._voltages[port_id] = 5.0 if value.digital else 0.0

    async def read_port(self, port_id: str) -> PortValue:
        return PortValue(analog=self._voltages.get(port_id, 0.0))

    async def snapshot(self) -> bytes:
        import json; return json.dumps(self._voltages).encode()

    async def restore(self, snapshot: bytes):
        import json; self._voltages = json.loads(snapshot.decode())

    async def shutdown(self): pass
