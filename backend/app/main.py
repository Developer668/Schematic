"""Schematic FastAPI: simulation orchestration, component import, and live engine status."""
import asyncio
import importlib.util
import logging
import shutil
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import compile as compile_router, components as comp_router, simulation as sim_router
from app.core.config import settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Schematic backend starting; engine availability is exposed at /api/engines")
    yield
    logger.info("Schematic backend shutdown")

app = FastAPI(title="Schematic HardwareWebMCP API", description="Universal hardware graph, simulation orchestration, and component import", version="1.0.0", lifespan=lifespan, docs_url="/api/docs", redoc_url="/api/redoc", openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(compile_router.router, prefix="/api/compile", tags=["compilation"])
app.include_router(sim_router.router, prefix="/api/simulation", tags=["simulation"])
app.include_router(comp_router.router, prefix="/api/components", tags=["components"])

def _binary(*names: str) -> str:
    return "available" if any(shutil.which(name) for name in names) else "unavailable"

def _module(name: str) -> str:
    return "available" if importlib.util.find_spec(name) else "unavailable"

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}

@app.get("/api/engines")
def engines():
    return {
        "renode": {"status": _binary("renode", "Renode"), "purpose": "MCU and SoC firmware"},
        "ngspice": {"status": _binary("ngspice"), "purpose": "Analog electrical and SPICE"},
        "wasmtime": {"status": _module("wasmtime"), "purpose": "Sandboxed WASM behaviors"},
        "qemu": {"status": _binary("qemu-system-x86_64", "qemu-system-arm", "qemu-system-aarch64"), "purpose": "Linux SBCs"},
        "verilator": {"status": _binary("verilator"), "purpose": "FPGA and digital logic"},
        "fmi": {"status": _module("fmpy"), "purpose": "FMI physical models"},
        "gazebo": {"status": _binary("gz", "gazebo"), "purpose": "Robotics and physics"},
        "scikit-rf": {"status": _module("skrf"), "purpose": "RF S-parameters"},
        "gnuradio": {"status": _binary("gnuradio-companion"), "purpose": "Radio DSP"},
        "openems": {"status": _binary("openEMS"), "purpose": "Antennas and EM"},
        "meep": {"status": _module("meep"), "purpose": "Photonics"},
        "arduino-cli": {"status": _binary("arduino-cli"), "purpose": "Firmware compilation"},
    }
