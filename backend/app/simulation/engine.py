"""SimulationEngine interface — one adapter per engine (per HardwareWebMCP.md)."""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

@dataclass
class PortValue:
    digital: bool | None = None
    analog: float | None = None
    bus: dict | None = None  # {protocol, address, operation, register, length, data}

@dataclass
class CompiledSubgraph:
    engine: str
    components: list[dict]
    connections: list[dict]
    firmware: list[dict] | None = None

class SimulationEngine(ABC):
    @abstractmethod
    async def initialize(self, model: CompiledSubgraph) -> None: ...
    @abstractmethod
    async def advance_to(self, time_ns: int) -> None: ...
    @abstractmethod
    async def write_port(self, port_id: str, value: PortValue) -> None: ...
    @abstractmethod
    async def read_port(self, port_id: str) -> PortValue: ...
    @abstractmethod
    async def snapshot(self) -> bytes: ...
    @abstractmethod
    async def restore(self, snapshot: bytes) -> None: ...
    @abstractmethod
    async def shutdown(self) -> None: ...
