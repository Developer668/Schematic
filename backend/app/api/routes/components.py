from fastapi import APIRouter, UploadFile, File, Form
from pydantic import BaseModel
import json, os, glob

router = APIRouter()

# Load Velxio-derived catalog if present next to backend (copied or imported)
CATALOG_PATH = os.path.join(os.path.dirname(__file__), "../../../../frontend/src/data/catalog.json")

# Minimal starter catalog (subset of Velxio 150+)
STARTER = [
    {"id":"arduino-uno","title":"Arduino Uno","category":"board","manufacturer":"Arduino","ports":[{"id":"5V","domain":"power","direction":"power"},{"id":"GND","domain":"ground","direction":"power"},{"id":"D13","domain":"gpio","direction":"output"},{"id":"A0","domain":"adc","direction":"input"},{"id":"SDA","domain":"i2c","direction":"bidirectional","protocol":{"role":"controller"}},{"id":"SCL","domain":"i2c","direction":"bidirectional","protocol":{"role":"controller"}}],"models":{"renode":{"engine":"renode","file":"uno.repl","fidelity":"renode","verified":True}}},
    {"id":"esp32-s3","title":"ESP32-S3 DevKit","category":"board","manufacturer":"Espressif","ports":[{"id":"3V3","domain":"power","direction":"power"},{"id":"GND","domain":"ground","direction":"power"},{"id":"GPIO4","domain":"gpio","direction":"bidirectional"},{"id":"SDA","domain":"i2c","direction":"bidirectional"},{"id":"SCL","domain":"i2c","direction":"bidirectional"}],"models":{"renode":{"engine":"renode","file":"esp32s3.repl","fidelity":"renode","verified":True}}},
    {"id":"raspberry-pi-5","title":"Raspberry Pi 5","category":"board","manufacturer":"Raspberry Pi","ports":[{"id":"5V","domain":"power","direction":"power"},{"id":"GND","domain":"ground","direction":"power"},{"id":"GPIO2_SDA","domain":"i2c","direction":"bidirectional"},{"id":"GPIO3_SCL","domain":"i2c","direction":"bidirectional"},{"id":"TX","domain":"uart","direction":"output"},{"id":"RX","domain":"uart","direction":"input"}],"models":{"qemu":{"engine":"qemu","file":"pi5.qemu","fidelity":"qemu","verified":False}}},
    {"id":"bmp280","title":"BMP280 Pressure/Temp","category":"sensor","manufacturer":"Bosch","ports":[{"id":"VCC","domain":"power","direction":"input","electrical":{"nominalVoltage":3.3,"maxVoltage":3.6}},{"id":"GND","domain":"ground","direction":"power"},{"id":"SDA","domain":"i2c","direction":"bidirectional","protocol":{"role":"target","address":118},"electrical":{"requiresPullup":True}},{"id":"SCL","domain":"i2c","direction":"bidirectional","protocol":{"role":"target"}}],"models":{"wasmtime":{"engine":"wasmtime","file":"bmp280.wasm","fidelity":"wasm_behavioral","verified":True}}},
    {"id":"hc-sr501","title":"HC-SR501 PIR Motion","category":"sensor","ports":[{"id":"VCC","domain":"power","direction":"input","electrical":{"nominalVoltage":5,"maxVoltage":12}},{"id":"GND","domain":"ground","direction":"power"},{"id":"OUT","domain":"gpio","direction":"output"}],"models":{"wasmtime":{"engine":"wasmtime","file":"pir.wasm","fidelity":"wasm_behavioral","verified":True}}},
    {"id":"ssd1306","title":"SSD1306 OLED 128x64","category":"display","ports":[{"id":"VCC","domain":"power","direction":"input","electrical":{"nominalVoltage":3.3,"maxVoltage":5}},{"id":"GND","domain":"ground","direction":"power"},{"id":"SDA","domain":"i2c","direction":"bidirectional","protocol":{"role":"target","address":60}},{"id":"SCL","domain":"i2c","direction":"bidirectional"}],"models":{"wasmtime":{"engine":"wasmtime","file":"ssd1306.wasm","fidelity":"wasm_behavioral","verified":True}}},
    {"id":"active-buzzer","title":"Active Buzzer","category":"actuator","ports":[{"id":"IN","domain":"gpio","direction":"input"},{"id":"GND","domain":"ground","direction":"power"}],"models":{}},
    {"id":"led","title":"LED","category":"actuator","ports":[{"id":"Anode","domain":"power","direction":"input"},{"id":"Cathode","domain":"ground","direction":"power"}],"models":{"spice":{"engine":"ngspice","file":"led.lib","fidelity":"spice","verified":True}}},
    {"id":"resistor","title":"Resistor","category":"power","ports":[{"id":"A","domain":"power","direction":"bidirectional"},{"id":"B","domain":"power","direction":"bidirectional"}],"models":{"spice":{"engine":"ngspice","file":"resistor.lib","fidelity":"spice","verified":True}}},
    {"id":"drv8871","title":"TI DRV8871 Motor Driver (example)","category":"actuator","manufacturer":"TI","ports":[{"id":"VIN","domain":"power","direction":"input","electrical":{"nominalVoltage":6.5,"maxVoltage":30}},{"id":"GND","domain":"ground","direction":"power"},{"id":"OUT1","domain":"power_output","direction":"output"},{"id":"OUT2","domain":"power_output","direction":"output"},{"id":"IN1","domain":"gpio","direction":"input"},{"id":"IN2","domain":"gpio","direction":"input"}],"models":{"spice":{"engine":"ngspice","file":"drv8871.lib","fidelity":"spice","verified":False}}},
]

CATALOG = STARTER

@router.get("/search")
def search(q: str = "", domain: str | None = None, category: str | None = None):
    res = CATALOG
    if q:
        ql = q.lower()
        res = [c for c in res if ql in c["id"].lower() or ql in c["title"].lower() or ql in c.get("manufacturer","").lower()]
    if domain:
        res = [c for c in res if any(p["domain"]==domain for p in c["ports"])]
    if category:
        res = [c for c in res if c["category"]==category]
    return {"count": len(res), "results": res}

@router.get("/{component_id}")
def get_one(component_id: str):
    for c in CATALOG:
        if c["id"]==component_id: return c
    return {"error": "not found"}, 404

@router.get("/ports/{component_id}")
def get_ports(component_id: str):
    for c in CATALOG:
        if c["id"]==component_id: return {"componentId": component_id, "ports": c["ports"]}
    return {"error":"not found"}, 404

class ImportReq(BaseModel):
    filenames: list[str]
    fileSizes: list[int] | None = None

@router.post("/import/analyze")
def analyze(req: ImportReq):
    from app.components.importer import analyze_import
    return analyze_import(req.filenames, req.fileSizes or [])

@router.post("/import")
async def do_import(files: list[UploadFile] = File(...)):
    # stub: just analyze filenames
    names = [f.filename or "unknown" for f in files]
    from app.components.importer import analyze_import
    a = analyze_import(names)
    return {"imported": False, "analysis": a, "message": "Stub — real import writes .hwpkg to catalog"}
