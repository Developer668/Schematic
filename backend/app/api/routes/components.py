from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.simulation.behavioral import BEHAVIORAL_BOARD_FQBNS

router = APIRouter()

_REPO_ROOT = Path(__file__).resolve().parents[4]
CATALOG_CANDIDATES = (
    _REPO_ROOT / "frontend" / "public" / "components-metadata.json",
    _REPO_ROOT / "frontend" / "dist" / "components-metadata.json",
    Path.cwd() / "frontend" / "public" / "components-metadata.json",
    Path.cwd() / "frontend" / "dist" / "components-metadata.json",
)
CATALOG_PATH = next((path for path in CATALOG_CANDIDATES if path.is_file()), CATALOG_CANDIDATES[0])
CATALOG_SOURCE = "canonical-components-metadata" if CATALOG_PATH.is_file() else "missing-canonical-components-metadata"


def _category(raw: Any, component_id: str, tags: list[str]) -> str:
    value = str(raw or "").lower()
    if value in {"board", "boards"}: return "board"
    if value in {"sensor", "sensors"}: return "sensor"
    if value in {"display", "displays"}: return "display"
    if value in {"actuator", "actuators", "output"}: return "actuator"
    if value in {"power"}: return "power"
    if value in {"logic"}: return "logic"
    if value in {"communication", "rf"}: return "communication"
    text = " ".join([component_id, *tags]).lower()
    if any(token in text for token in ("sensor", "bmp", "dht", "mpu", "pir", "gps", "soil")): return "sensor"
    if any(token in text for token in ("oled", "lcd", "display", "tft", "epaper")): return "display"
    if any(token in text for token in ("servo", "motor", "buzzer", "relay", "driver")): return "actuator"
    if any(token in text for token in ("arduino", "esp32", "raspberry", "stm32", "teensy", "pico", "board")): return "board"
    return "custom"


def _ports(item: dict[str, Any]) -> list[dict[str, Any]]:
    component_id = str(item.get("id", ""))
    tags = [str(tag) for tag in item.get("tags", []) if tag]
    text = " ".join([component_id, str(item.get("name", "")), str(item.get("description", "")), *tags]).lower()
    pin_count = max(2, min(int(item.get("pinCount") or 2), 64))
    if component_id in BEHAVIORAL_BOARD_FQBNS:
        if component_id.startswith("arduino"):
            return [
                {"id": "5V", "name": "5V", "domain": "power", "direction": "power"},
                {"id": "3V3", "name": "3V3", "domain": "power", "direction": "power"},
                {"id": "GND", "name": "GND", "domain": "ground", "direction": "power"},
                {"id": "SDA", "name": "SDA", "domain": "i2c", "direction": "bidirectional", "protocol": {"role": "controller"}},
                {"id": "SCL", "name": "SCL", "domain": "i2c", "direction": "bidirectional", "protocol": {"role": "controller"}},
                *[{"id": f"D{index}", "name": f"D{index}", "domain": "gpio", "direction": "bidirectional"} for index in range(14)],
                *[{"id": f"A{index}", "name": f"A{index}", "domain": "adc", "direction": "input"} for index in range(6)],
            ]
        if component_id.startswith("raspberry-pi-pico"):
            return [
                {"id": "3V3", "name": "3V3", "domain": "power", "direction": "power"},
                {"id": "VBUS", "name": "VBUS", "domain": "power", "direction": "power"},
                {"id": "GND", "name": "GND", "domain": "ground", "direction": "power"},
                {"id": "SDA", "name": "SDA", "domain": "i2c", "direction": "bidirectional", "protocol": {"role": "controller"}},
                {"id": "SCL", "name": "SCL", "domain": "i2c", "direction": "bidirectional", "protocol": {"role": "controller"}},
                *[{"id": f"GPIO{index}", "name": f"GPIO{index}", "domain": "gpio", "direction": "bidirectional"} for index in range(30)],
                *[{"id": f"ADC{index}", "name": f"ADC{index}", "domain": "adc", "direction": "input"} for index in range(4)],
            ]
        return [
            {"id": "3V3", "name": "3V3", "domain": "power", "direction": "power"},
            {"id": "5V", "name": "5V", "domain": "power", "direction": "power"},
            {"id": "GND", "name": "GND", "domain": "ground", "direction": "power"},
            {"id": "SDA", "name": "SDA", "domain": "i2c", "direction": "bidirectional", "protocol": {"role": "controller"}},
            {"id": "SCL", "name": "SCL", "domain": "i2c", "direction": "bidirectional", "protocol": {"role": "controller"}},
            *[{"id": f"GPIO{index}", "name": f"GPIO{index}", "domain": "gpio", "direction": "bidirectional"} for index in (0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39)],
            {"id": "TX", "name": "TX", "domain": "uart", "direction": "output"},
            {"id": "RX", "name": "RX", "domain": "uart", "direction": "input"},
        ]
    if component_id.startswith("ds3231") or "ds3231" in text:
        return [{"id": "VCC", "name": "VCC", "domain": "power", "direction": "power"}, {"id": "GND", "name": "GND", "domain": "ground", "direction": "power"}, {"id": "SDA", "name": "SDA", "domain": "i2c", "direction": "bidirectional", "protocol": {"role": "target", "address": 0x68}}, {"id": "SCL", "name": "SCL", "domain": "i2c", "direction": "bidirectional", "protocol": {"role": "target"}}]
    if "i2c" in text or "sda" in text or "scl" in text:
        return [{"id": "VCC", "name": "VCC", "domain": "power", "direction": "power"}, {"id": "GND", "name": "GND", "domain": "ground", "direction": "power"}, {"id": "SDA", "name": "SDA", "domain": "i2c", "direction": "bidirectional", "protocol": {"role": "target"}}, {"id": "SCL", "name": "SCL", "domain": "i2c", "direction": "bidirectional", "protocol": {"role": "target"}}]
    if component_id in {"pushbutton", "pushbutton-6mm"}:
        return [{"id": "VCC", "name": "VCC", "domain": "power", "direction": "power"}, {"id": "GND", "name": "GND", "domain": "ground", "direction": "power"}, {"id": "A", "name": "A", "domain": "gpio", "direction": "bidirectional"}, {"id": "B", "name": "B", "domain": "gpio", "direction": "bidirectional"}]
    if component_id in {"led", "led-10mm-red", "ws2812b-1-led", "buzzer", "active-buzzer"}:
        return [{"id": "VCC", "name": "VCC", "domain": "power", "direction": "power"}, {"id": "GND", "name": "GND", "domain": "ground", "direction": "power"}, {"id": "IN", "name": "IN", "domain": "gpio", "direction": "input"}]
    if component_id in {"servo", "servo-9g-sg90", "servo-ds3218", "servo-jx6221", "servo-mg90s", "mg996r-servo"}:
        return [{"id": "VCC", "name": "VCC", "domain": "power", "direction": "power"}, {"id": "GND", "name": "GND", "domain": "ground", "direction": "power"}, {"id": "SIG", "name": "SIG", "domain": "pwm", "direction": "input"}]
    if component_id in {"potentiometer", "slide-potentiometer", "tmp36-temp", "lm35-temp", "lm35-2", "photoresistor-sensor", "sharp-gp2y0a02-distance", "sharp-gp2y0a02-150", "uv-sensor-guva-s12sd"}:
        return [{"id": "VCC", "name": "VCC", "domain": "power", "direction": "power"}, {"id": "GND", "name": "GND", "domain": "ground", "direction": "power"}, {"id": "OUT", "name": "OUT", "domain": "adc", "direction": "output"}]
    if any(token in text for token in ("spi", "mosi", "miso", "sck")):
        return [{"id": "VCC", "name": "VCC", "domain": "power", "direction": "power"}, {"id": "GND", "name": "GND", "domain": "ground", "direction": "power"}, *[{"id": name, "name": name, "domain": "spi", "direction": "bidirectional"} for name in ("SCK", "MOSI", "MISO", "CS")]]
    if any(token in text for token in ("uart", "serial", "tx", "rx")):
        return [{"id": "VCC", "name": "VCC", "domain": "power", "direction": "power"}, {"id": "GND", "name": "GND", "domain": "ground", "direction": "power"}, {"id": "TX", "name": "TX", "domain": "uart", "direction": "output"}, {"id": "RX", "name": "RX", "domain": "uart", "direction": "input"}]
    return [{"id": f"P{index + 1}", "name": f"P{index + 1}", "domain": "gpio", "direction": "bidirectional"} for index in range(pin_count)]


def _model(component_id: str, category: str) -> dict[str, Any]:
    if component_id in BEHAVIORAL_BOARD_FQBNS:
        return {"version": 1, "family": "mcu", "support": "behavioral", "capabilities": ["firmware", "gpio"], "verified": False, "source": "family-template", "modelId": "mcu:v1"}
    if component_id.startswith("ds3231"):
        return {"version": 1, "family": "i2c-register", "support": "behavioral", "capabilities": ["i2c", "register-read", "rtc"], "verified": False, "source": "catalog-model", "modelId": "ds3231-register-read:v1", "reason": "Deterministic clock and register-read model; power, ground, and control-register writes are validation-only."}
    if component_id in {"led", "led-10mm-red", "ws2812b-1-led", "buzzer", "active-buzzer"}:
        return {"version": 1, "family": "digital-output", "support": "behavioral", "capabilities": ["gpio", "actuator-state"], "verified": False, "source": "family-template", "modelId": "digital-output:v1"}
    if component_id in {"pushbutton", "pushbutton-6mm", "slide-switch", "tilt-switch", "pir-motion-sensor", "hc-sr501-pir", "am312-pir"}:
        return {"version": 1, "family": "digital-input", "support": "behavioral", "capabilities": ["digital-input", "gpio"], "verified": False, "source": "family-template", "modelId": "digital-input:v1"}
    if component_id in {"servo", "servo-9g-sg90", "servo-ds3218", "servo-jx6221", "servo-mg90s", "mg996r-servo"}:
        return {"version": 1, "family": "pwm-actuator", "support": "behavioral", "capabilities": ["gpio", "pwm", "actuator-state"], "verified": False, "source": "family-template", "modelId": "pwm-actuator:v1"}
    if component_id in {"potentiometer", "slide-potentiometer", "tmp36-temp", "lm35-temp", "lm35-2", "photoresistor-sensor", "sharp-gp2y0a02-distance", "sharp-gp2y0a02-150", "uv-sensor-guva-s12sd"}:
        return {"version": 1, "family": "adc-source", "support": "behavioral", "capabilities": ["adc", "analog-input"], "verified": False, "source": "family-template", "modelId": "adc-source:v1"}
    return {"version": 1, "family": "metadata-only", "support": "validation", "capabilities": ["typed-ports"], "verified": False, "source": "none", "modelId": "metadata-only:v1", "reason": "No executable device-specific backend model is assigned yet."}


def _load_catalog() -> list[dict[str, Any]]:
    try:
        raw = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        components = raw.get("components", []) if isinstance(raw, dict) else []
    except (OSError, json.JSONDecodeError):
        components = []
    catalog: list[dict[str, Any]] = []
    for item in components:
        if not isinstance(item, dict) or not item.get("id"): continue
        component_id = str(item["id"])
        tags = [str(tag) for tag in item.get("tags", []) if tag]
        category = _category(item.get("category"), component_id, tags)
        catalog.append({"id": component_id, "title": str(item.get("name") or component_id), "category": category, "manufacturer": item.get("manufacturer"), "description": item.get("description"), "ports": _ports(item), "models": {}, "model": _model(component_id, category), "tags": tags, "thumbnail": item.get("thumbnail")})
    return catalog


CATALOG = _load_catalog()
CATALOG_BY_ID = {component["id"]: component for component in CATALOG}


@router.get("/search")
def search(q: str = "", domain: str | None = None, category: str | None = None):
    query = q.strip().lower()
    results = [component for component in CATALOG if (not query or query in " ".join(str(component.get(field, "")) for field in ("id", "title", "manufacturer", "description")).lower() or query in " ".join(component.get("tags", [])).lower()) and (not domain or any(port["domain"] == domain for port in component["ports"])) and (not category or component["category"] == category)]
    coverage: dict[str, int] = {}
    for component in results:
        key = f"{component['model']['support']}:{component['model']['family']}"
        coverage[key] = coverage.get(key, 0) + 1
    return {"count": len(results), "results": results, "source": CATALOG_SOURCE, "catalogPath": str(CATALOG_PATH), "modelCoverage": coverage}


@router.get("/ports/{component_id}")
def get_ports(component_id: str):
    component = CATALOG_BY_ID.get(component_id)
    if not component:
        raise HTTPException(status_code=404, detail=f"Unknown component {component_id}")
    return {"componentId": component_id, "ports": component["ports"], "model": component["model"]}


@router.get("/{component_id}")
def get_one(component_id: str):
    component = CATALOG_BY_ID.get(component_id)
    if not component:
        raise HTTPException(status_code=404, detail=f"Unknown component {component_id}")
    return component


class ImportReq(BaseModel):
    filenames: list[str]
    fileSizes: list[int] | None = None


@router.post("/import/analyze")
def analyze(req: ImportReq):
    from app.components.importer import analyze_import
    return analyze_import(req.filenames, req.fileSizes or [])


@router.post("/import")
async def do_import(files: list[UploadFile] = File(...)):
    names = [file.filename or "unknown" for file in files]
    from app.components.importer import analyze_import
    analysis = analyze_import(names)
    return {"imported": False, "analysis": analysis, "message": "Import analysis complete; catalog writes require a reviewed model package."}
