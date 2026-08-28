"""Schematic FastAPI: simulation orchestration, component import, and live engine status."""
import asyncio
import importlib.util
import logging
import shutil
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth as auth_router, compile as compile_router, components as comp_router, parts as parts_router, simulation as sim_router
from app.auth.session import validate_auth_config
from app.core.config import settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
logger = logging.getLogger(__name__)

validate_auth_config()
if settings.SCHEMATIC_AUTH_MODE == "development":
    logger.warning("Schematic auth is in development mode; set SCHEMATIC_AUTH_MODE and SCHEMATIC_SESSION_SECRET before exposing the API.")

@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Schematic backend starting; engine availability is exposed at /api/engines")
    yield
    logger.info("Schematic backend shutdown")

app = FastAPI(title="Schematic HardwareWebMCP API", description="Universal hardware graph, simulation orchestration, and component import", version="1.0.0", lifespan=lifespan, docs_url="/api/docs", redoc_url="/api/redoc", openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:4173",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
        settings.FRONTEND_URL,
        "https://schematic-webmcp-studio.pages.dev",
        "https://chat.openai.com",
        "https://chatgpt.com",
    ],
    allow_origin_regex=r"https://([a-z0-9-]+\.)+pages\.dev|https://([a-z0-9-]+\.)+(openai|chatgpt)\.com",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)
app.include_router(auth_router.router, prefix="/api/auth", tags=["auth"])
app.include_router(compile_router.router, prefix="/api/compile", tags=["compilation"])
app.include_router(sim_router.router, prefix="/api/simulation", tags=["simulation"])
app.include_router(comp_router.router, prefix="/api/components", tags=["components"])
app.include_router(parts_router.router, prefix="/api/parts", tags=["parts"])

def _binary(*names: str) -> str:
    return "available" if any(shutil.which(name) for name in names) else "unavailable"

def _module(name: str) -> str:
    return "available" if importlib.util.find_spec(name) else "unavailable"

def _unsupported_adapter(detected: str, purpose: str) -> dict[str, object]:
    """Describe an adapter that is discoverable but not an execution backend yet.

    Discovery of a binary or Python package is not the same as having a working
    graph adapter. Keeping that distinction in the API prevents the settings
    page and WebMCP callers from treating a placeholder as a successful run.
    """
    return {
        "status": "unsupported",
        "detected": detected == "available",
        "purpose": purpose,
        "reason": "The adapter is not execution-ready; behavioral sessions do not use it.",
    }

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}

@app.get("/api/engines")
def engines():
    return {
        "behavioral": {"status": "available", "purpose": "Graph-aware Arduino subset with GPIO, ADC, PWM, serial transport, SPI/I2C traces, and deterministic DS3231 register reads", "verified": True},
        "renode": _unsupported_adapter(_binary("renode", "Renode"), "MCU and SoC firmware"),
        "ngspice": _unsupported_adapter(_binary("ngspice"), "Analog electrical and SPICE"),
        "wasmtime": _unsupported_adapter(_module("wasmtime"), "Sandboxed WASM behaviors"),
        "qemu": _unsupported_adapter(_binary("qemu-system-x86_64", "qemu-system-arm", "qemu-system-aarch64"), "Linux SBCs"),
        "verilator": _unsupported_adapter(_binary("verilator"), "FPGA and digital logic"),
        "fmi": _unsupported_adapter(_module("fmpy"), "FMI physical models"),
        "gazebo": _unsupported_adapter(_binary("gz", "gazebo"), "Robotics and physics"),
        "scikit-rf": _unsupported_adapter(_module("skrf"), "RF S-parameters"),
        "gnuradio": _unsupported_adapter(_binary("gnuradio-companion"), "Radio DSP"),
        "openems": _unsupported_adapter(_binary("openEMS"), "Antennas and EM"),
        "meep": _unsupported_adapter(_module("meep"), "Photonics"),
        "arduino-cli": {"status": _binary("arduino-cli"), "purpose": "Firmware compilation"},
    }
