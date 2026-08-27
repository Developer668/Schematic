"""Orchestrator — partitions graph by engine, drives deterministic event queue, isolates workers."""
from __future__ import annotations
import asyncio, heapq, time
from typing import Dict, List
from app.simulation.engine import SimulationEngine, CompiledSubgraph, PortValue
from app.engines.renode import RenodeAdapter
from app.engines.ngspice import NgspiceAdapter
from app.engines.wasmtime import WasmtimeAdapter
from app.engines.base import StubEngine

class SimulationOrchestrator:
    def __init__(self):
        self.engines: Dict[str, SimulationEngine] = {
            "renode": RenodeAdapter(),
            "ngspice": NgspiceAdapter(),
            "wasmtime": WasmtimeAdapter(),
            "qemu": StubEngine("qemu","Linux SBCs"),
            "verilator": StubEngine("verilator","HDL"),
            "fmi": StubEngine("fmi","Physical models"),
            "gazebo": StubEngine("gazebo","Robotics"),
            "scikit-rf": StubEngine("scikit-rf","RF S-params"),
            "gnuradio": StubEngine("gnuradio","DSP"),
            "openems": StubEngine("openems","EM solver — offline"),
            "meep": StubEngine("meep","Photonics — offline"),
        }
        self.event_q: list[tuple[int,int,dict]] = []
        self.time_ns = 0
        self.running = False

    def partition(self, project: dict) -> Dict[str, CompiledSubgraph]:
        """Naive: group components by which engine their definition declares. Real: union-find per domain."""
        out: Dict[str, CompiledSubgraph] = {}
        # For hackathon, every component goes to renode+ngspice+wasmtime according to models
        # Stub: send all components to each enabled engine
        comps = project.get("components",[])
        conns = project.get("connections",[])
        fw = project.get("firmwareTargets",[])
        for name in ("renode","ngspice","wasmtime"):
            out[name] = CompiledSubgraph(engine=name, components=comps, connections=conns, firmware=fw)
        return out

    async def initialize(self, project: dict):
        parts = self.partition(project)
        for eng_name, subgraph in parts.items():
            eng = self.engines[eng_name]
            await eng.initialize(subgraph)
        self.time_ns = 0

    async def advance_to(self, time_ns: int):
        # deterministic: advance all engines to same time
        for eng in self.engines.values():
            await eng.advance_to(time_ns)
        self.time_ns = time_ns

    async def write_port(self, engine: str, port_id: str, value: PortValue):
        await self.engines[engine].write_port(port_id, value)

    async def read_port(self, engine: str, port_id: str) -> PortValue:
        return await self.engines[engine].read_port(port_id)

    async def snapshot(self) -> dict:
        snaps = {}
        for k, eng in self.engines.items():
            snaps[k] = (await eng.snapshot()).hex()
        return {"time_ns": self.time_ns, "engines": snaps}

    async def restore(self, snap: dict):
        self.time_ns = snap["time_ns"]
        for k, hex_s in snap["engines"].items():
            await self.engines[k].restore(bytes.fromhex(hex_s))

    async def shutdown(self):
        for eng in self.engines.values():
            await eng.shutdown()

# Singleton for session use
orchestrator = SimulationOrchestrator()
