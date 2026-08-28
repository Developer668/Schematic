"""Deterministic behavioral simulation for the first supported hardware slice.

This module intentionally has a small, explicit boundary.  It executes the
Arduino subset that the browser runtime advertises and refuses to claim that a
generic protocol device is simulated.  More device models can be added behind
the same session/result contract without changing the API layer.
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


SUPPORTED_BOARD_FQBNS = {
    "esp32": "esp32:esp32:esp32",
    "esp32-devkit-v1": "esp32:esp32:esp32",
    "esp32-s3": "esp32:esp32:esp32s3",
    "esp32-s3-devkitc-1": "esp32:esp32:esp32s3",
    "esp32-c3-devkit": "esp32:esp32:esp32c3",
    "esp32-c3-mini": "esp32:esp32:esp32c3",
    "esp32-s2-devkit": "esp32:esp32:esp32s2",
    "esp32-c6-devkit": "esp32:esp32:esp32c6",
    "esp32-c5-devkit": "esp32:esp32:esp32c5",
    "esp32-cam": "esp32:esp32:esp32",
    "esp32-pico-v3": "esp32:esp32:esp32",
    "esp32-ethernet-kit": "esp32:esp32:esp32",
    "esp32-wroom-32u": "esp32:esp32:esp32",
    "esp8266-nodemcu": "esp8266:esp8266:nodemcuv2",
    "arduino-uno": "arduino:avr:uno",
    "arduino-uno-r3": "arduino:avr:uno",
    "arduino-nano": "arduino:avr:nano",
    "arduino-nano-every": "arduino:megaavr:nona4809",
    "arduino-mega": "arduino:avr:mega",
    "arduino-pro-mini": "arduino:avr:pro:cpu=16MHzatmega328",
    "arduino-leonardo": "arduino:avr:leonardo",
    "raspberry-pi-pico": "rp2040:rp2040:rpipico",
    "raspberry-pi-pico-w": "rp2040:rp2040:rpipicow",
    "raspberry-pi-pico-2": "rp2040:rp2040:rpipico2",
    "rp2040-zero": "rp2040:rp2040:rpipico",
}

# Only boards with an explicit, tested port profile are executable in this
# backend. The broader compiler map above is retained for exact compile
# targeting, but a compiler identity alone is not a behavioral model.
BEHAVIORAL_BOARD_FQBNS = {
    "arduino-uno": SUPPORTED_BOARD_FQBNS["arduino-uno"],
    "arduino-uno-r3": SUPPORTED_BOARD_FQBNS["arduino-uno-r3"],
    "arduino-nano": SUPPORTED_BOARD_FQBNS["arduino-nano"],
    "esp32-devkit-v1": SUPPORTED_BOARD_FQBNS["esp32-devkit-v1"],
    "raspberry-pi-pico": SUPPORTED_BOARD_FQBNS["raspberry-pi-pico"],
    "raspberry-pi-pico-w": SUPPORTED_BOARD_FQBNS["raspberry-pi-pico-w"],
}

# Keep device coverage explicit and shared by the runtime result, netlist
# profile, and catalogue endpoint.  A family name alone is not enough to make
# a part executable: each definition below has a deliberately small model.
BEHAVIORAL_DIGITAL_INPUTS = {
    "pushbutton",
    "pushbutton-6mm",
    "slide-switch",
    "tilt-switch",
    "pir-motion-sensor",
    "hc-sr501-pir",
    "am312-pir",
}
BEHAVIORAL_DIGITAL_OUTPUTS = {
    "led",
    "led-10mm-red",
    "ws2812b-1-led",
    "buzzer",
    "active-buzzer",
}
BEHAVIORAL_PWM_ACTUATORS = {
    "servo",
    "servo-9g-sg90",
    "servo-ds3218",
    "servo-jx6221",
    "servo-mg90s",
    "mg996r-servo",
}
BEHAVIORAL_ADC_SOURCES = {
    "potentiometer",
    "slide-potentiometer",
    "tmp36-temp",
    "lm35-temp",
    "lm35-2",
    "photoresistor-sensor",
    "sharp-gp2y0a02-distance",
    "sharp-gp2y0a02-150",
    "uv-sensor-guva-s12sd",
}


def _model_for_definition(definition: str) -> tuple[str, str, str]:
    """Return the public model identity for a concrete executable definition."""
    if definition.startswith("ds3231"):
        return "i2c-register", "behavioral", "ds3231-register-read:v1"
    if definition in BEHAVIORAL_BOARD_FQBNS:
        return "mcu", "behavioral", "mcu:v1"
    if definition in BEHAVIORAL_DIGITAL_INPUTS:
        return "digital-input", "behavioral", "digital-input:v1"
    if definition in BEHAVIORAL_DIGITAL_OUTPUTS:
        return "digital-output", "behavioral", "digital-output:v1"
    if definition in BEHAVIORAL_PWM_ACTUATORS:
        return "pwm-actuator", "behavioral", "pwm-actuator:v1"
    if definition in BEHAVIORAL_ADC_SOURCES:
        return "adc-source", "behavioral", "adc-source:v1"
    return "metadata-only", "validation", "metadata-only:v1"

SUPPORTED_BOARD_PORTS = {
    "esp32": {f"GPIO{i}" for i in (0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39)} | {"SDA", "SCL", "TX", "RX"},
    "arduino": {*(f"D{i}" for i in range(54)), *(f"A{i}" for i in range(16)), "SDA", "SCL"},
    "rp2040": {*(f"GPIO{i}" for i in range(30)), *(f"ADC{i}" for i in range(4)), "SDA", "SCL"},
}


def _field(value: dict[str, Any], *names: str, default: Any = None) -> Any:
    for name in names:
        if name in value:
            return value[name]
    return default


def _definition_id(component: dict[str, Any]) -> str:
    return str(_field(component, "definitionId", "definition_id", default=""))


def _component_id(component: dict[str, Any]) -> str:
    return str(_field(component, "id", default=""))


def _properties(component: dict[str, Any]) -> dict[str, Any]:
    value = _field(component, "properties", default={})
    return value if isinstance(value, dict) else {}


def _endpoint_key(component_id: str, port_id: str) -> str:
    return f"{component_id}:{port_id}"


class Netlist:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def add(self, key: str) -> None:
        self.parent.setdefault(key, key)

    def find(self, key: str) -> str:
        self.add(key)
        parent = self.parent[key]
        if parent != key:
            parent = self.find(parent)
            self.parent[key] = parent
        return parent

    def union(self, left: str, right: str) -> None:
        self.parent[self.find(left)] = self.find(right)

    def members(self, root: str) -> list[str]:
        normalized = self.find(root)
        return [key for key in self.parent if self.find(key) == normalized]

    def roots(self) -> int:
        return len({self.find(key) for key in self.parent})


def _strip_comments(source: str) -> str:
    return re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", source)


def _balanced_source(source: str) -> bool:
    stack: list[str] = []
    quote = ""
    escaped = False
    pairs = {"}": "{", ")": "(", "]": "["}
    for char in source:
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = ""
            continue
        if char in "\"'":
            quote = char
        elif char in "{([":
            stack.append(char)
        elif char in "})]":
            if not stack or stack.pop() != pairs[char]:
                return False
    return not stack and not quote


def _matching(source: str, start: int, opening: str, closing: str) -> int:
    depth = 0
    quote = ""
    for index in range(start, len(source)):
        char = source[index]
        if quote:
            if char == quote and source[index - 1] != "\\":
                quote = ""
            continue
        if char in "\"'":
            quote = char
        elif char == opening:
            depth += 1
        elif char == closing:
            depth -= 1
            if depth == 0:
                return index
    return -1


def _function_body(source: str, name: str) -> str:
    match = re.search(rf"\b{name}\s*\([^)]*\)\s*\{{", source, re.IGNORECASE)
    if not match:
        return ""
    opening = source.find("{", match.start())
    closing = _matching(source, opening, "{", "}")
    return source[opening + 1:] if closing < 0 else source[opening + 1:closing]


def _split_top_level(source: str, operator: str) -> tuple[str, str] | None:
    depth = 0
    quote = ""
    index = 0
    while index <= len(source) - len(operator):
        char = source[index]
        if quote:
            if char == quote and source[index - 1] != "\\":
                quote = ""
            index += 1
            continue
        if char in "\"'":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif depth == 0 and source[index:index + len(operator)] == operator:
            return source[:index], source[index + len(operator):]
        index += 1
    return None


def _statement(source: str, start: int) -> tuple[str, int]:
    depth = 0
    quote = ""
    for index in range(start, len(source)):
        char = source[index]
        if quote:
            if char == quote and source[index - 1] != "\\":
                quote = ""
        elif char in "\"'":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == ";" and depth == 0:
            return source[start:index + 1], index + 1
    return source[start:], len(source)


def _body_or_statement(source: str, start: int) -> tuple[str, int]:
    while start < len(source) and source[start].isspace():
        start += 1
    if start < len(source) and source[start] == "{":
        closing = _matching(source, start, "{", "}")
        return source[start + 1:] if closing < 0 else source[start + 1:closing], len(source) if closing < 0 else closing + 1
    return _statement(source, start)


def _number(value: Any, default: float = 0) -> float:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        raw = value.strip()
        try:
            return float(int(raw, 16)) if raw.lower().startswith("0x") else float(raw)
        except ValueError:
            return default
    return default


def _bool(value: Any) -> bool:
    return bool(value) if isinstance(value, bool) else _number(value) != 0


def _bcd(value: int) -> int:
    value = max(0, int(value))
    return ((value // 10) << 4) | (value % 10)


@dataclass
class I2CTransaction:
    address: int
    bytes: list[int]
    read_queue: list[int]
    device_id: str | None = None


@dataclass
class SPITransaction:
    data: list[int]
    device_id: str | None = None


class BehavioralSession:
    """One isolated project execution context.

    A session never owns process-global mutable state.  It can be used by an
    API request, a WebSocket, or a test without sharing time, inputs, or
    snapshots with another project.
    """

    def __init__(self, project: dict[str, Any]) -> None:
        self.project = copy.deepcopy(project)
        self.components = [_component for _component in self.project.get("components", []) if isinstance(_component, dict)]
        self.component_by_id = {_component_id(component): component for component in self.components}
        self.netlist = Netlist()
        self.time_ns = 0
        self.duration_ns = 0
        self.inputs: dict[str, bool | float] = {}
        self.outputs: dict[str, bool | float] = {}
        self.events: list[dict[str, Any]] = []
        self.warnings: list[dict[str, Any]] = []
        self.target_issues: list[dict[str, Any]] = []
        self.unsupported_apis: set[str] = set()
        self.serial_output = ""
        self.device_values: dict[str, dict[str, Any]] = {}
        self.device_status: dict[str, str] = {}
        self.i2c_transactions: dict[str, I2CTransaction] = {}
        self.spi_transactions: dict[str, SPITransaction] = {}
        self.serial_rx: dict[str, list[int]] = {}
        self.register_pointers: dict[str, int] = {}
        self.registers: dict[str, list[int]] = {}
        self.programs: list[dict[str, Any]] = []
        self._build_netlist()
        self._reset_devices()
        self._validate_targets()

    def _ports_for(self, component: dict[str, Any]) -> set[str]:
        definition = _definition_id(component)
        if definition in SUPPORTED_BOARD_FQBNS:
            if definition.startswith("arduino"):
                return SUPPORTED_BOARD_PORTS["arduino"] | {"5V", "3V3", "GND"}
            if definition.startswith(("raspberry-pi-pico", "rp2040")):
                return SUPPORTED_BOARD_PORTS["rp2040"] | {"3V3", "VBUS", "GND"}
            return SUPPORTED_BOARD_PORTS["esp32"] | {"3V3", "5V", "GND"}
        if definition.startswith("ds3231"):
            return {"VCC", "GND", "SDA", "SCL"}
        if definition in {"pushbutton", "pushbutton-6mm"}:
            return {"A", "B"}
        if definition in {"slide-switch", "tilt-switch"}:
            return {"A", "B", "COM"}
        if definition in {"pir-motion-sensor", "hc-sr501-pir", "am312-pir"}:
            return {"VCC", "GND", "OUT"}
        if definition in BEHAVIORAL_DIGITAL_OUTPUTS:
            return {"VCC", "GND", "IN"}
        if definition in BEHAVIORAL_PWM_ACTUATORS:
            return {"VCC", "GND", "SIG"}
        if definition in BEHAVIORAL_ADC_SOURCES:
            return {"VCC", "GND", "OUT"}
        return {"VCC", "GND", "IN", "OUT", "SDA", "SCL", "SCK", "MOSI", "MISO", "CS", "TX", "RX"}

    def _build_netlist(self) -> None:
        for component in self.components:
            component_id = _component_id(component)
            for port_id in self._ports_for(component):
                self.netlist.add(_endpoint_key(component_id, port_id))
        for connection in self.project.get("connections", []):
            if not isinstance(connection, dict):
                continue
            source = _field(connection, "source", default={})
            target = _field(connection, "target", default={})
            if not isinstance(source, dict) or not isinstance(target, dict):
                continue
            self.netlist.union(
                _endpoint_key(str(_field(source, "componentId", "component_id", default="")), str(_field(source, "portId", "port_id", default=""))),
                _endpoint_key(str(_field(target, "componentId", "component_id", default="")), str(_field(target, "portId", "port_id", default=""))),
            )

    def _reset_devices(self) -> None:
        self.device_values = {}
        self.device_status = {}
        for component in self.components:
            component_id = _component_id(component)
            definition = _definition_id(component)
            if definition.startswith("ds3231"):
                self.device_values[component_id] = {"seconds": 0, "minutes": 0, "hours": 0, "temperatureC": _number(_properties(component).get("temperatureC", _properties(component).get("temperature", 25)), 25)}
                self.device_status[component_id] = "unwired"
            elif definition in BEHAVIORAL_DIGITAL_INPUTS:
                self.device_values[component_id] = {"value": False, **({"pressed": False} if definition in {"pushbutton", "pushbutton-6mm"} else {})}
                self.device_status[component_id] = "unwired"
            elif definition in BEHAVIORAL_DIGITAL_OUTPUTS:
                self.device_values[component_id] = {"value": False, "brightness": 0}
                self.device_status[component_id] = "unwired"
            elif definition in BEHAVIORAL_PWM_ACTUATORS:
                self.device_values[component_id] = {"angle": 0, "duty": 0}
                self.device_status[component_id] = "unwired"
            elif definition in BEHAVIORAL_ADC_SOURCES:
                self.device_values[component_id] = {"value": _number(_properties(component).get("value", 0))}
                self.device_status[component_id] = "unwired"
            elif definition in BEHAVIORAL_BOARD_FQBNS:
                self.device_values[component_id] = {}
                self.device_status[component_id] = "unwired"
            else:
                self.device_values[component_id] = {}
                self.device_status[component_id] = "unsupported"

    def _validate_targets(self) -> None:
        targets = self.project.get("firmwareTargets", self.project.get("firmware_targets", []))
        if not isinstance(targets, list):
            self.target_issues.append({"componentId": "", "code": "INVALID_FIRMWARE_TARGETS", "message": "firmwareTargets must be an array."})
            return
        for target in targets:
            if not isinstance(target, dict):
                continue
            component_id = str(_field(target, "componentId", "component_id", default=""))
            component = self.component_by_id.get(component_id)
            if not component:
                self.target_issues.append({"componentId": component_id, "code": "INVALID_FIRMWARE_TARGET", "message": "Firmware target is not attached to a catalog component."})
                continue
            definition = _definition_id(component)
            expected_fqbn = BEHAVIORAL_BOARD_FQBNS.get(definition)
            target_definition = str(_field(target, "definitionId", "definition_id", default="") or "")
            if not expected_fqbn:
                self.target_issues.append({"componentId": component_id, "code": "UNSUPPORTED_BOARD_MODEL", "message": f"{definition} has no verified backend firmware model."})
                continue
            if not target_definition:
                self.target_issues.append({"componentId": component_id, "code": "FIRMWARE_DEFINITION_REQUIRED", "message": "Firmware must retain the exact catalog definition of its board target."})
            elif target_definition != definition:
                self.target_issues.append({"componentId": component_id, "code": "FIRMWARE_DEFINITION_MISMATCH", "message": f"Firmware was written for {target_definition}, but the current board is {definition}."})
            target_fqbn = str(_field(target, "boardFqbn", "board_fqbn", default="") or "")
            if not target_fqbn:
                self.target_issues.append({"componentId": component_id, "code": "FIRMWARE_FQBN_REQUIRED", "message": f"Firmware must declare the exact compiler target {expected_fqbn}."})
            elif target_fqbn != expected_fqbn:
                self.target_issues.append({"componentId": component_id, "code": "FIRMWARE_FQBN_MISMATCH", "message": f"Firmware uses {target_fqbn}, but {definition} maps to {expected_fqbn}."})
            files = _field(target, "files", default=[])
            sources = [file for file in files if isinstance(file, dict) and re.search(r"\.(ino|c|cpp|h)$", str(_field(file, "name", default="")), re.IGNORECASE)] if isinstance(files, list) else []
            if not sources:
                self.target_issues.append({"componentId": component_id, "code": "UNSUPPORTED_FIRMWARE_FILES", "message": "No browser-supported C/C++ source file was found."})
                continue
            source = _strip_comments("\n".join(str(_field(file, "content", default="")) for file in sources))
            if not _balanced_source(source):
                self.target_issues.append({"componentId": component_id, "code": "MALFORMED_FIRMWARE", "message": "Firmware source has unbalanced delimiters and was not executed."})
            if not re.search(r"\b(?:setup|loop)\s*\(", source, re.IGNORECASE):
                self.target_issues.append({"componentId": component_id, "code": "NO_EXECUTABLE_ENTRYPOINT", "message": "The supported Arduino runtime requires a setup() or loop() entrypoint."})

    def _warning(self, code: str, message: str, **details: Any) -> None:
        item = {"code": code, "message": message}
        item.update({key: value for key, value in details.items() if value is not None})
        if not any(existing == item for existing in self.warnings):
            self.warnings.append(item)

    def _update_clock(self, device_id: str) -> None:
        component = self.component_by_id.get(device_id)
        if not component or not _definition_id(component).startswith("ds3231"):
            return
        props = _properties(component)
        epoch_ms = _number(props.get("epochMs", props.get("epoch_ms", 1704067200000)), 1704067200000)
        moment = datetime.fromtimestamp((epoch_ms + self.time_ns / 1_000_000) / 1000, tz=timezone.utc)
        values = self.device_values.setdefault(device_id, {})
        values.update({"seconds": moment.second, "minutes": moment.minute, "hours": moment.hour})

    def _advance_to(self, time_ns: int) -> None:
        self.time_ns = max(self.time_ns, min(max(0, int(time_ns)), self.duration_ns))
        for device_id in self.device_values:
            self._update_clock(device_id)

    def advance_to(self, time_ns: int) -> None:
        """Advance an initialized session without mutating its execution trace."""
        self._advance_to(time_ns)

    def _bus_port(self, component: dict[str, Any], line: str) -> str | None:
        definition = _definition_id(component)
        if definition == "bbc-microbit-v2":
            return "P20" if line == "data" else "P19"
        return {"data": "SDA", "clock": "SCL", "sck": "SCK", "tx": "TX", "rx": "RX"}.get(line)

    def _connected(self, left_component: str, left_port: str | None, right_component: str, right_port: str | None) -> bool:
        if not left_port or not right_port:
            return False
        return self.netlist.find(_endpoint_key(left_component, left_port)) == self.netlist.find(_endpoint_key(right_component, right_port))

    def _connected_any(self, left_component: str, left_ports: tuple[str, ...], right_component: str, right_ports: tuple[str, ...]) -> bool:
        return any(self._connected(left_component, left_port, right_component, right_port) for left_port in left_ports for right_port in right_ports)

    def _physical_spi_target(self, controller_id: str) -> str | None:
        controller = self.component_by_id.get(controller_id)
        if not controller:
            return None
        clock_ports = ("SCK", "SCLK", "SCL", "CLK", "CLOCK")
        data_ports = ("MOSI", "SDA", "DIN", "DATA", "MISO", "SDO", "DOUT", "SO")
        select_ports = ("CS", "SS", "NSS", "CE", "CSN")
        for candidate in self.components:
            candidate_id = _component_id(candidate)
            if candidate_id == controller_id or candidate_id in BEHAVIORAL_BOARD_FQBNS:
                continue
            if self._connected_any(controller_id, clock_ports, candidate_id, clock_ports) and (
                self._connected_any(controller_id, data_ports, candidate_id, data_ports)
                or self._connected_any(controller_id, select_ports, candidate_id, select_ports)
            ):
                return candidate_id
        return None

    def _physical_uart_target(self, controller_id: str) -> str | None:
        controller = self.component_by_id.get(controller_id)
        if not controller:
            return None
        tx_ports = ("TX", "TXD", "DO", "RO")
        rx_ports = ("RX", "RXD", "DI")
        for candidate in self.components:
            candidate_id = _component_id(candidate)
            if candidate_id == controller_id or candidate_id in BEHAVIORAL_BOARD_FQBNS:
                continue
            if self._connected_any(controller_id, tx_ports, candidate_id, rx_ports) or self._connected_any(controller_id, rx_ports, candidate_id, tx_ports):
                return candidate_id
        return None

    def _seed_serial_inputs(self) -> None:
        """Queue deterministic one-byte UART inputs from simulation controls.

        The API intentionally accepts scalar values only.  A caller can use
        ``<deviceId>:rx`` (or ``:serial``/``:uart``) with a byte value to make
        ``Serial.available()`` and ``Serial.read()`` observable without
        inventing a device-specific protocol model.
        """
        for key, value in self.inputs.items():
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                continue
            component_id, separator, input_name = str(key).partition(":")
            if not separator or input_name.lower() not in {"rx", "serial", "uart", "incoming"}:
                continue
            byte = max(0, min(255, int(value)))
            for board in self.components:
                board_id = _component_id(board)
                if board_id == component_id or self._physical_uart_target(board_id) == component_id:
                    self.serial_rx.setdefault(board_id, []).append(byte)

    def _spi_transfer(self, board_id: str, value: Any) -> int:
        byte = max(0, min(255, int(_number(value))))
        transaction = self.spi_transactions.get(board_id)
        target_id = transaction.device_id if transaction else self._physical_spi_target(board_id)
        if transaction is None:
            transaction = SPITransaction([], target_id)
            self.spi_transactions[board_id] = transaction
        transaction.data.append(byte)
        # No catalog entry currently has an executable SPI model. Preserve a
        # trace and an explicit warning instead of silently returning success.
        acknowledged = False
        if target_id:
            self._warning("SPI_DEVICE_MODEL_UNAVAILABLE", "The SPI target is wired, but this exact device has no executable behavioral model yet.", componentId=target_id, controllerId=board_id)
        else:
            self._warning("SPI_DEVICE_NOT_FOUND", "SPI.transfer() has no wired SPI target on the active bus.", controllerId=board_id)
        self.events.append({"kind": "spi", "timeMs": self._current_cursor_ms, "controllerId": board_id, "deviceId": target_id, "data": [byte], "response": [0], "acknowledged": acknowledged})
        return 0

    def _serial_write(self, board_id: str, data: list[int]) -> None:
        target_id = self._physical_uart_target(board_id)
        self.events.append({"kind": "uart", "timeMs": self._current_cursor_ms, "controllerId": board_id, "deviceId": target_id, "direction": "tx", "data": [max(0, min(255, int(value))) for value in data], "acknowledged": bool(target_id)})

    def _serial_read(self, board_id: str) -> int:
        queue = self.serial_rx.get(board_id, [])
        if not queue:
            self._warning("UART_READ_WITHOUT_DATA", "Serial.read() was called without an RX byte.", controllerId=board_id)
            return -1
        value = queue.pop(0)
        self.events.append({"kind": "uart", "timeMs": self._current_cursor_ms, "controllerId": board_id, "deviceId": self._physical_uart_target(board_id), "direction": "rx", "data": [value], "acknowledged": True})
        return value

    def _i2c_device(self, controller_id: str, address: int) -> str | None:
        controller = self.component_by_id.get(controller_id)
        if not controller:
            return None
        for candidate in self.components:
            candidate_id = _component_id(candidate)
            if candidate_id == controller_id or not _definition_id(candidate).startswith("ds3231"):
                continue
            if address != 0x68:
                continue
            bus_connected = self._connected(controller_id, self._bus_port(controller, "data"), candidate_id, "SDA") and self._connected(controller_id, self._bus_port(controller, "clock"), candidate_id, "SCL")
            if not bus_connected:
                continue
            powered = any(self._connected(controller_id, port, candidate_id, target_port) for port in ("3V3", "5V", "VBUS", "VCC") for target_port in ("VCC", "VIN", "3V3", "5V", "VBUS"))
            grounded = any(self._connected(controller_id, port, candidate_id, target_port) for port in ("GND", "GND1", "GND2") for target_port in ("GND", "GND1", "GND2"))
            if powered and grounded:
                return candidate_id
            self._warning("I2C_DEVICE_UNPOWERED", "The I²C target has bus wires but requires a connected power and ground net before it can acknowledge transactions.", componentId=candidate_id, controllerId=controller_id)
        return None

    def _read_register(self, device_id: str, register: int) -> int:
        self._update_clock(device_id)
        component = self.component_by_id[device_id]
        props = _properties(component)
        epoch_ms = _number(props.get("epochMs", props.get("epoch_ms", 1704067200000)), 1704067200000)
        moment = datetime.fromtimestamp((epoch_ms + self.time_ns / 1_000_000) / 1000, tz=timezone.utc)
        if register == 0x00:
            return _bcd(moment.second)
        if register == 0x01:
            return _bcd(moment.minute)
        if register == 0x02:
            return _bcd(moment.hour)
        if register == 0x03:
            return _bcd((moment.weekday() + 1) % 7 + 1)
        if register == 0x04:
            return _bcd(moment.day)
        if register == 0x05:
            return _bcd(moment.month)
        if register == 0x06:
            return _bcd(moment.year % 100)
        if register in {0x0E, 0x0F}:
            return 0
        if register == 0x11:
            return int(_number(props.get("temperatureC", props.get("temperature", 25)), 25)) & 0xFF
        if register == 0x12:
            temperature = _number(props.get("temperatureC", props.get("temperature", 25)), 25)
            return (round((temperature - int(temperature)) / 0.25) & 0x03) << 6
        values = self.registers.setdefault(device_id, [0] * 256)
        return values[register & 0xFF]

    def _resolve_pin(self, board_id: str, expression: str, variables: dict[str, Any]) -> str | None:
        raw = expression.strip().strip("()")
        value = variables.get(raw, raw)
        numeric = int(_number(value)) if isinstance(value, (int, float)) and not isinstance(value, bool) else int(_number(value)) if re.fullmatch(r"-?(?:\d+|0x[0-9a-f]+)", str(value), re.IGNORECASE) else None
        board = self.component_by_id.get(board_id)
        if not board:
            return None
        available = self._ports_for(board)
        if raw.upper() in available:
            return raw.upper()
        if numeric is None:
            match = re.search(r"(?:GPIO|PIN|IO|D|A|P)[_ ]?(\d+)", raw, re.IGNORECASE)
            numeric = int(match.group(1)) if match else None
        if numeric is None:
            return None
        for name in (f"GPIO{numeric}", f"D{numeric}", f"A{numeric}", f"IO{numeric}", f"P{numeric}"):
            if name in available:
                return name
        return None

    def _digital_read(self, board_id: str, expression: str, variables: dict[str, Any]) -> bool:
        port = self._resolve_pin(board_id, expression, variables)
        if not port:
            return False
        root = self.netlist.find(_endpoint_key(board_id, port))
        for member in self.netlist.members(root):
            if ":" not in member:
                continue
            component_id, key = member.split(":", 1)
            direct = self.inputs.get(member)
            semantic = self.inputs.get(f"{component_id}:pressed", self.inputs.get(f"{component_id}:button", self.inputs.get(f"{component_id}:motion")))
            if direct is not None:
                electrical = _bool(direct)
                if component_id in self.device_values:
                    self.device_status[component_id] = "active"
                    self.device_values[component_id]["value"] = electrical
                return electrical
            if semantic is not None:
                semantic_value = _bool(semantic)
                active_low = _definition_id(self.component_by_id.get(component_id, {})) in {"pushbutton", "pushbutton-6mm"}
                electrical = not semantic_value if active_low else semantic_value
                if component_id in self.device_values:
                    self.device_status[component_id] = "active"
                    self.device_values[component_id]["value"] = electrical
                    if active_low:
                        self.device_values[component_id]["pressed"] = semantic_value
                return electrical
            if key in {"OUT", "A", "IN"} and f"{component_id}:{key}" in self.inputs:
                electrical = _bool(self.inputs[f"{component_id}:{key}"])
                if component_id in self.device_values:
                    self.device_status[component_id] = "active"
                    self.device_values[component_id]["value"] = electrical
                return electrical
        return False

    def _evaluate(self, expression: str, board_id: str, variables: dict[str, Any], depth: int = 0) -> Any:
        if depth > 16:
            return False
        raw = expression.strip().rstrip(";").strip()
        while raw.startswith("(") and raw.endswith(")") and _matching(raw, 0, "(", ")") == len(raw) - 1:
            raw = raw[1:-1].strip()
        for operator, transform in (("||", lambda left, right: _bool(left) or _bool(right)), ("&&", lambda left, right: _bool(left) and _bool(right))):
            split = _split_top_level(raw, operator)
            if split:
                return transform(self._evaluate(split[0], board_id, variables, depth + 1), self._evaluate(split[1], board_id, variables, depth + 1))
        question = raw.find("?")
        if question >= 0:
            branches = _split_top_level(raw[question + 1:], ":")
            if branches:
                return self._evaluate(branches[0] if _bool(self._evaluate(raw[:question], board_id, variables, depth + 1)) else branches[1], board_id, variables, depth + 1)
        for operator in ("===", "!==", "==", "!=", ">=", "<=", ">", "<"):
            split = _split_top_level(raw, operator)
            if split:
                left = self._evaluate(split[0], board_id, variables, depth + 1)
                right = self._evaluate(split[1], board_id, variables, depth + 1)
                if operator in {"===", "=="}:
                    return left == right or _number(left) == _number(right)
                if operator in {"!==", "!="}:
                    return not (left == right or _number(left) == _number(right))
                if operator == ">=": return _number(left) >= _number(right)
                if operator == "<=": return _number(left) <= _number(right)
                if operator == ">": return _number(left) > _number(right)
                return _number(left) < _number(right)
        arithmetic = re.match(r"^(.+?)\s*([+\-*/%])\s*(.+)$", raw)
        if arithmetic and not re.fullmatch(r"-?(?:\d+(?:\.\d+)?|0x[0-9a-f]+)", raw, re.IGNORECASE):
            left = _number(self._evaluate(arithmetic.group(1), board_id, variables, depth + 1))
            right = _number(self._evaluate(arithmetic.group(3), board_id, variables, depth + 1))
            if arithmetic.group(2) == "+": return left + right
            if arithmetic.group(2) == "-": return left - right
            if arithmetic.group(2) == "*": return left * right
            if arithmetic.group(2) == "/": return 0 if right == 0 else left / right
            return 0 if right == 0 else left % right
        call = re.match(r"^digitalRead\s*\((.*)\)$", raw, re.IGNORECASE)
        if call: return self._digital_read(board_id, call.group(1), variables)
        call = re.match(r"^analogRead\s*\((.*)\)$", raw, re.IGNORECASE)
        if call:
            port = self._resolve_pin(board_id, call.group(1), variables)
            if not port: return 0
            root = self.netlist.find(_endpoint_key(board_id, port))
            for member in self.netlist.members(root):
                component_id = member.split(":", 1)[0]
                for key in (f"{component_id}:value", f"{component_id}:analog", f"{component_id}:temperature", member):
                    if key in self.inputs: return _number(self.inputs[key])
            return 0
        if re.fullmatch(r"Wire\.available\s*\(\s*\)", raw, re.IGNORECASE): return len(self.i2c_transactions.get(board_id, I2CTransaction(0, [], [])).read_queue)
        if re.fullmatch(r"Wire\.read\s*\(\s*\)", raw, re.IGNORECASE): return self._i2c_read(board_id)
        if re.fullmatch(r"Serial\.available\s*\(\s*\)", raw, re.IGNORECASE): return len(self.serial_rx.get(board_id, []))
        if re.fullmatch(r"Serial\.read\s*\(\s*\)", raw, re.IGNORECASE): return self._serial_read(board_id)
        call = re.match(r"^SPI\.transfer\s*\((.*)\)$", raw, re.IGNORECASE)
        if call: return self._spi_transfer(board_id, self._evaluate(call.group(1), board_id, variables))
        if re.fullmatch(r"millis\s*\(\s*\)", raw, re.IGNORECASE): return self._current_cursor_ms
        if re.fullmatch(r"micros\s*\(\s*\)", raw, re.IGNORECASE): return self._current_cursor_ms * 1000
        if raw.startswith("!"): return not _bool(self._evaluate(raw[1:], board_id, variables, depth + 1))
        if raw.lower() in {"true", "high"}: return True
        if raw.lower() in {"false", "low"}: return False
        if re.fullmatch(r"-?(?:\d+(?:\.\d+)?|0x[0-9a-f]+)", raw, re.IGNORECASE): return _number(raw)
        return variables.get(raw, False)

    def _i2c_read(self, board_id: str) -> int:
        transaction = self.i2c_transactions.get(board_id)
        if not transaction or not transaction.read_queue:
            self._warning("I2C_READ_WITHOUT_DATA", "Wire.read() was called without available bytes.", controllerId=board_id)
            return 0
        return transaction.read_queue.pop(0)

    @property
    def _current_cursor_ms(self) -> int:
        return int(self._cursor_ns / 1_000_000)

    def _execute_block(self, source: str, board_id: str, variables: dict[str, Any], executions: list[int]) -> None:
        index = 0
        while index < len(source) and executions[0] < 20_000:
            while index < len(source) and (source[index].isspace() or source[index] == ";"):
                index += 1
            if index >= len(source): break
            remainder = source[index:]
            if re.match(r"^if\s*\(", remainder, re.IGNORECASE):
                condition_start = source.find("(", index)
                condition_end = _matching(source, condition_start, "(", ")")
                if condition_end < 0: break
                yes, after = _body_or_statement(source, condition_end + 1)
                while after < len(source) and source[after].isspace(): after += 1
                no: tuple[str, int] | None = None
                if re.match(r"^else\b", source[after:], re.IGNORECASE): no = _body_or_statement(source, after + 4)
                chosen = yes if _bool(self._evaluate(source[condition_start + 1:condition_end], board_id, variables)) else (no[0] if no else "")
                if chosen: self._execute_block(chosen, board_id, variables, executions)
                index = no[1] if no else after
                continue
            statement, index = _statement(source, index)
            self._execute_statement(statement, board_id, variables, executions)

    def _execute_statement(self, statement: str, board_id: str, variables: dict[str, Any], executions: list[int]) -> None:
        text = statement.strip().rstrip(";").strip()
        if not text: return
        executions[0] += 1
        delay = re.match(r"^delay\s*\((.*)\)$", text, re.IGNORECASE)
        if delay:
            self._cursor_ns += max(0, int(_number(self._evaluate(delay.group(1), board_id, variables)))) * 1_000_000
            self._advance_to(self._cursor_ns)
            return
        if re.match(r"^pinMode\s*\(", text, re.IGNORECASE): return
        if re.match(r"^Wire\.begin\s*\(", text, re.IGNORECASE): return
        call = re.match(r"^Wire\.beginTransmission\s*\((.*)\)$", text, re.IGNORECASE)
        if call:
            address = int(_number(self._evaluate(call.group(1), board_id, variables)))
            device_id = self._i2c_device(board_id, address)
            self.i2c_transactions[board_id] = I2CTransaction(address, [], [], device_id)
            return
        call = re.match(r"^Wire\.write\s*\(([^,)]*)", text, re.IGNORECASE)
        if call:
            transaction = self.i2c_transactions.get(board_id)
            if not transaction:
                self._warning("I2C_WRITE_WITHOUT_START", "Wire.write() was called without Wire.beginTransmission().", controllerId=board_id)
            else:
                transaction.bytes.append(int(_number(self._evaluate(call.group(1), board_id, variables))) & 0xFF)
            return
        if re.match(r"^Wire\.endTransmission\s*\(", text, re.IGNORECASE):
            transaction = self.i2c_transactions.get(board_id)
            if not transaction: return
            acknowledged = bool(transaction.device_id)
            if acknowledged and transaction.bytes:
                pointer = transaction.bytes[0] & 0xFF
                self.register_pointers[transaction.device_id] = pointer
                if _definition_id(self.component_by_id.get(transaction.device_id, {})).startswith("ds3231"):
                    if len(transaction.bytes) > 1:
                        self._warning("DS3231_REGISTER_WRITE_UNSUPPORTED", "The DS3231 model supports deterministic register reads only; control/time register writes were not applied.", componentId=transaction.device_id, controllerId=board_id)
                else:
                    values = self.registers.setdefault(transaction.device_id, [0] * 256)
                    for offset, value in enumerate(transaction.bytes[1:]): values[(pointer + offset) & 0xFF] = value
                self.device_status[transaction.device_id] = "active"
            self.events.append({"kind": "i2c", "timeMs": self._current_cursor_ms, "controllerId": board_id, "deviceId": transaction.device_id, "address": transaction.address, "operation": "write", "register": transaction.bytes[0] if transaction.bytes else None, "data": list(transaction.bytes), "acknowledged": acknowledged})
            if not acknowledged: self._warning("I2C_DEVICE_NOT_FOUND", f"No wired I2C device acknowledged address 0x{transaction.address:x}.", controllerId=board_id)
            return
        call = re.match(r"^Wire\.requestFrom\s*\(([^,]+),\s*([^)]+)\)$", text, re.IGNORECASE)
        if call:
            address = int(_number(self._evaluate(call.group(1), board_id, variables)))
            length = max(0, min(512, int(_number(self._evaluate(call.group(2), board_id, variables)))))
            device_id = self._i2c_device(board_id, address)
            pointer = self.register_pointers.get(device_id or "", 0)
            queue = [self._read_register(device_id, pointer + offset) for offset in range(length)] if device_id else []
            if device_id:
                self.register_pointers[device_id] = (pointer + len(queue)) & 0xFF
                self.device_status[device_id] = "active"
            self.i2c_transactions[board_id] = I2CTransaction(address, [], queue, device_id)
            self.events.append({"kind": "i2c", "timeMs": self._current_cursor_ms, "controllerId": board_id, "deviceId": device_id, "address": address, "operation": "read", "register": pointer, "data": list(queue), "acknowledged": bool(device_id)})
            if not device_id: self._warning("I2C_DEVICE_NOT_FOUND", f"No wired I2C device acknowledged address 0x{address:x}.", controllerId=board_id)
            return
        if re.match(r"^SPI\.(?:begin|end|beginTransaction|endTransaction)\s*\(", text, re.IGNORECASE):
            if re.match(r"^SPI\.beginTransaction\s*\(", text, re.IGNORECASE):
                self.spi_transactions[board_id] = SPITransaction([], self._physical_spi_target(board_id))
            return
        call = re.match(r"^SPI\.transfer\s*\((.*)\)$", text, re.IGNORECASE)
        if call:
            self._spi_transfer(board_id, self._evaluate(call.group(1), board_id, variables))
            return
        serial = re.match(r"^Serial\.(print|println)\s*\((.*)\)$", text, re.IGNORECASE)
        if serial:
            raw = serial.group(2).strip()
            value = raw[1:-1] if len(raw) >= 2 and raw[0] == raw[-1] == '"' else str(self._evaluate(raw, board_id, variables))
            output = value + ("\n" if serial.group(1).lower() == "println" else "")
            self.serial_output += output
            self._serial_write(board_id, list(output.encode()))
            return
        serial_write = re.match(r"^Serial\.write\s*\((.*)\)$", text, re.IGNORECASE)
        if serial_write:
            self._serial_write(board_id, [int(_number(self._evaluate(serial_write.group(1), board_id, variables)))])
            return
        if re.match(r"^Serial\.(?:begin)\s*\(", text, re.IGNORECASE): return
        tone = re.match(r"^tone\s*\(([^,]+),\s*([^,]+),\s*([^)]+)\)$", text, re.IGNORECASE)
        if tone:
            self._write_pin(board_id, tone.group(1), True, variables, reason="tone")
            self._cursor_ns += max(0, int(_number(self._evaluate(tone.group(3), board_id, variables)))) * 1_000_000
            self._advance_to(self._cursor_ns)
            self._write_pin(board_id, tone.group(1), False, variables, reason="tone complete")
            return
        write = re.match(r"^(digitalWrite|analogWrite)\s*\((.*)\)$", text, re.IGNORECASE)
        if write:
            arguments = _split_top_level(write.group(2), ",")
            if not arguments:
                return
            raw_value = self._evaluate(arguments[1], board_id, variables)
            value: bool | float = _number(raw_value) if write.group(1).lower() == "analogwrite" else _bool(raw_value)
            self._write_pin(board_id, arguments[0], value, variables, reason=write.group(1))
            return
        assignment = re.match(r"^(?:(?:const\s+)?(?:bool|boolean|byte|short|int|long|float|double|uint8_t|uint16_t)\s+)?([A-Za-z_]\w*)\s*=\s*(.+)$", text)
        if assignment:
            variables[assignment.group(1)] = self._evaluate(assignment.group(2), board_id, variables)

    def _write_pin(self, board_id: str, expression: str, value: bool | float, variables: dict[str, Any], reason: str) -> None:
        port = self._resolve_pin(board_id, expression, variables)
        if not port: return
        root = self.netlist.find(_endpoint_key(board_id, port))
        for member in self.netlist.members(root):
            self.outputs[member] = value
            if member.split(":", 1)[0] != board_id:
                device_id = member.split(":", 1)[0]
                if device_id in self.device_values:
                    self.device_status[device_id] = "active"
                    definition = _definition_id(self.component_by_id.get(device_id, {}))
                    if definition in BEHAVIORAL_PWM_ACTUATORS:
                        duty = max(0, min(255, _number(value)))
                        self.device_values[device_id]["duty"] = duty
                        self.device_values[device_id]["angle"] = max(0, min(180, round(duty * 180 / 255)))
                    else:
                        self.device_values[device_id]["value"] = value
                        if definition in BEHAVIORAL_DIGITAL_OUTPUTS:
                            self.device_values[device_id]["brightness"] = value
            self.events.append({"kind": "gpio", "timeMs": self._current_cursor_ms, "endpoint": member, "value": value, "reason": f"{board_id} firmware {reason}"})

    def _collect_unsupported(self, source: str) -> None:
        supported = {
            "Wire.begin", "Wire.beginTransmission", "Wire.write", "Wire.endTransmission", "Wire.requestFrom", "Wire.available", "Wire.read",
            "SPI.begin", "SPI.beginTransaction", "SPI.transfer", "SPI.endTransaction", "SPI.end",
            "Serial.begin", "Serial.print", "Serial.println", "Serial.write", "Serial.available", "Serial.read",
        }
        for match in re.finditer(r"\b(Wire|SPI|Serial)\.([A-Za-z_]\w*)\s*\(", source):
            api = f"{match.group(1)}.{match.group(2)}"
            if api not in supported: self.unsupported_apis.add(api)
        for match in re.finditer(r"\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(", source):
            if match.group(1) not in {"Wire", "SPI", "Serial"}:
                self.unsupported_apis.add(f"C++:{match.group(1)}.{match.group(2)}")
        allowed = {
            "setup", "loop", "if", "else", "for", "while", "switch", "digitalRead", "digitalWrite", "analogRead", "analogWrite",
            "pinMode", "delay", "tone", "millis", "micros", "map", "constrain", "min", "max", "abs", "round", "SPISettings",
        }
        for match in re.finditer(r"\b([A-Za-z_]\w*)\s*\(", source):
            name = match.group(1)
            if match.start() > 0 and source[match.start() - 1] == ".":
                continue
            if name not in allowed:
                self.unsupported_apis.add(f"C++:{name}")

    def run(self, inputs: dict[str, bool | float], duration_ns: int) -> dict[str, Any]:
        self.inputs = dict(inputs)
        self.duration_ns = max(0, min(int(duration_ns), 86_400_000_000_000))
        self.time_ns = 0
        self._cursor_ns = 0
        self.outputs = {}
        self.events = []
        self.warnings = []
        self.unsupported_apis = set()
        self.serial_output = ""
        self.programs = []
        self.i2c_transactions = {}
        self.spi_transactions = {}
        self.serial_rx = {}
        self.register_pointers = {}
        self.registers = {}
        self._reset_devices()
        self._seed_serial_inputs()
        for target in self.project.get("firmwareTargets", self.project.get("firmware_targets", [])):
            if not isinstance(target, dict): continue
            component_id = str(_field(target, "componentId", "component_id", default=""))
            if any(issue.get("componentId") == component_id for issue in self.target_issues): continue
            files = _field(target, "files", default=[])
            source = _strip_comments("\n".join(str(_field(file, "content", default="")) for file in files if isinstance(file, dict) and re.search(r"\.(ino|c|cpp|h)$", str(_field(file, "name", default="")), re.IGNORECASE)))
            if not source: continue
            self._collect_unsupported(source)
            source_files = [str(_field(file, "name", default="")) for file in files if isinstance(file, dict) and re.search(r"\.(ino|c|cpp|h)$", str(_field(file, "name", default="")), re.IGNORECASE)] if isinstance(files, list) else []
            variables: dict[str, Any] = {}
            for match in re.finditer(r"(?:(?:const|constexpr)\s+)?(?:bool|boolean|byte|short|int|long|float|double|uint8_t|uint16_t)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);", source):
                raw_value = match.group(2).strip()
                if re.fullmatch(r"(?:true|false|high|low|-?(?:\d+(?:\.\d+)?|0x[0-9a-f]+))", raw_value, re.IGNORECASE):
                    variables[match.group(1)] = self._evaluate(raw_value, component_id, variables)
            executions = [0]
            event_start = len(self.events)
            self._execute_block(_function_body(source, "setup"), component_id, variables, executions)
            loop = _function_body(source, "loop")
            iterations = 0
            while loop and iterations < 20_000 and (iterations == 0 or self._cursor_ns < self.duration_ns):
                before = self._cursor_ns
                self._execute_block(loop, component_id, variables, executions)
                iterations += 1
                if before == self._cursor_ns: break
            self._advance_to(self.duration_ns)
            self.programs.append({
                "componentId": component_id,
                "writes": sum(1 for event in self.events[event_start:] if event.get("kind") in {"gpio", "pwm"}),
                "executions": executions[0],
                "sourceFiles": source_files,
            })
        for key, value in self.inputs.items(): self.outputs.setdefault(key, value)
        targets = self.project.get("firmwareTargets", self.project.get("firmware_targets", []))
        status = "invalid-target" if self.target_issues else "unsupported-api" if self.unsupported_apis else "completed-with-warnings" if self.warnings else "completed" if targets else "no-firmware"
        return self.result(status)

    def result(self, status: str = "completed") -> dict[str, Any]:
        device_states = []
        for component in self.components:
            component_id = _component_id(component)
            definition = _definition_id(component)
            family, support, model_id = _model_for_definition(definition)
            device_states.append({"componentId": component_id, "definitionId": definition, "family": family, "modelId": model_id, "support": support, "status": self.device_status.get(component_id, "unsupported"), "values": copy.deepcopy(self.device_values.get(component_id, {}))})
        return {
            "status": status,
            "runtime": "remote",
            "execution_mode": "behavioral",
            "duration_ns": self.duration_ns,
            "duration_ms": self.duration_ns / 1_000_000,
            "time_ns": self.time_ns,
            "outputs": copy.deepcopy(self.outputs),
            "events": copy.deepcopy(self.events),
            "programs": copy.deepcopy(self.programs),
            "protocol_events": copy.deepcopy([event for event in self.events if event.get("kind") in {"i2c", "spi", "uart", "adc", "pwm"}]),
            "device_states": device_states,
            "warnings": copy.deepcopy(self.warnings),
            "unsupported_apis": sorted(self.unsupported_apis),
            "target_issues": copy.deepcopy(self.target_issues),
            "serial_output": self.serial_output,
            "resolved_nets": self.netlist.roots(),
            "snapshot": self.snapshot(),
            "note": "Firmware executed in an isolated behavioral session with deterministic graph nets and protocol traces." if status == "completed" else "The backend produced a deterministic trace but reported warnings; review wiring/model coverage before treating the build as valid." if status == "completed-with-warnings" else "The backend refused to claim a successful run until the target, model, or API is supported.",
        }

    def snapshot(self) -> dict[str, Any]:
        return {
            "time_ns": self.time_ns,
            "duration_ns": self.duration_ns,
            "inputs": copy.deepcopy(self.inputs),
            "outputs": copy.deepcopy(self.outputs),
            "events": copy.deepcopy(self.events),
            "warnings": copy.deepcopy(self.warnings),
            "serial_output": self.serial_output,
            "device_values": copy.deepcopy(self.device_values),
            "device_status": copy.deepcopy(self.device_status),
            "register_pointers": copy.deepcopy(self.register_pointers),
            "registers": copy.deepcopy(self.registers),
            "i2c_transactions": {key: {"address": value.address, "bytes": value.bytes, "read_queue": value.read_queue, "device_id": value.device_id} for key, value in self.i2c_transactions.items()},
            "spi_transactions": {key: {"data": value.data, "device_id": value.device_id} for key, value in self.spi_transactions.items()},
            "serial_rx": copy.deepcopy(self.serial_rx),
            "programs": copy.deepcopy(self.programs),
        }

    def restore(self, snapshot: dict[str, Any]) -> None:
        self.time_ns = int(snapshot.get("time_ns", 0))
        self.duration_ns = int(snapshot.get("duration_ns", self.duration_ns))
        self.inputs = dict(snapshot.get("inputs", {}))
        self.outputs = dict(snapshot.get("outputs", {}))
        self.events = list(snapshot.get("events", []))
        self.warnings = list(snapshot.get("warnings", []))
        self.serial_output = str(snapshot.get("serial_output", ""))
        self.programs = list(snapshot.get("programs", []))
        self.device_values = dict(snapshot.get("device_values", {}))
        self.device_status = dict(snapshot.get("device_status", {}))
        self.register_pointers = {str(key): int(value) for key, value in snapshot.get("register_pointers", {}).items()}
        self.registers = {str(key): list(value) for key, value in snapshot.get("registers", {}).items()}
        self.i2c_transactions = {str(key): I2CTransaction(int(value.get("address", 0)), list(value.get("bytes", [])), list(value.get("read_queue", [])), value.get("device_id")) for key, value in snapshot.get("i2c_transactions", {}).items()}
        self.spi_transactions = {str(key): SPITransaction(list(value.get("data", [])), value.get("device_id")) for key, value in snapshot.get("spi_transactions", {}).items()}
        self.serial_rx = {str(key): list(value) for key, value in snapshot.get("serial_rx", {}).items() if isinstance(value, list)}
        self._cursor_ns = self.time_ns
        for device_id in self.device_values: self._update_clock(device_id)
