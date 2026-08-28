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

# SuperTokens — per-user room (stored on device) + session verification for WebMCP
# Core: https://github.com/supertokens/supertokens-core (run via `docker run -p 3567:3567 supertokens/supertokens-postgresql`)
try:
    from supertokens_python import init, InputAppInfo, SupertokensConfig
    from supertokens_python.recipe import session, emailpassword
    from supertokens_python.framework.fastapi import get_middleware
    from supertokens_python.recipe.session.framework.fastapi import verify_session

    _supertokens_available = True
except ImportError:
    _supertokens_available = False
    init = None  # type: ignore
    verify_session = None  # type: ignore

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
logger = logging.getLogger(__name__)

def _init_supertokens():
    if not _supertokens_available or init is None:
        logger.info("SuperTokens not installed — using local device room (mock). For production, run supertokens-core: https://github.com/supertokens/supertokens-core")
        return
    try:
        init(
            app_info=InputAppInfo(
                app_name="Schematic",
                api_domain=settings.SUPERTOKENS_API_DOMAIN,
                website_domain=settings.SUPERTOKENS_WEBSITE_DOMAIN,
                api_base_path="/api/auth",
                website_base_path="/auth",
            ),
            supertokens_config=SupertokensConfig(
                connection_uri=settings.SUPERTOKENS_CONNECTION_URI,
            ),
            framework="fastapi",
            recipe_list=[
                session.init(anti_csrf="VIA_TOKEN", cookie_secure=False, cookie_same_site="lax"),
                emailpassword.init(),
            ],
            mode="asgi",
        )
        logger.info(f"SuperTokens initialized core={settings.SUPERTOKENS_CONNECTION_URI}")
    except Exception as e:
        logger.warning(f"SuperTokens init failed (using local mock room): {e}")

_init_supertokens()

@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Schematic backend starting; engine availability is exposed at /api/engines")
    yield
    logger.info("Schematic backend shutdown")

app = FastAPI(title="Schematic HardwareWebMCP API", description="Universal hardware graph, simulation orchestration, and component import", version="1.0.0", lifespan=lifespan, docs_url="/api/docs", redoc_url="/api/redoc", openapi_url="/api/openapi.json")
# SuperTokens middleware must be added before CORSMiddleware
if _supertokens_available:
    try:
        app.add_middleware(get_middleware())  # type: ignore[arg-type]
    except Exception as e:
        logger.warning(f"SuperTokens middleware failed: {e}")
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
        "https://*.pages.dev",
        "https://chat.openai.com",
        "https://chatgpt.com",
        "https://*.openai.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)
# Auth is optional for local device rooms — WebMCP tools are still per-user via localStorage key
# For protected routes, use `verify_session` dependency; for now, keep compilation/simulation open
# but expose session info at /api/auth/session
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
