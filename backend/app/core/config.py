from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    FRONTEND_URL: str = "http://localhost:3000"
    DATABASE_URL: str = "sqlite:///./data/schematic.db"
    RENODE_BIN: str = "renode"
    NGSPICE_LIB: str = ""
    WASMTIME_CACHE: str = "./data/wasmtime-cache"

    # Bright Data stays on the API boundary. The browser never receives this
    # token and can only call Schematic's bounded /api/parts/search route.
    BRIGHTDATA_API_KEY: str = ""
    BRIGHTDATA_SERP_ZONE: str = "serp_api1"
    BRIGHTDATA_SERP_ENDPOINT: str = "https://api.brightdata.com/request"
    BRIGHTDATA_SERP_COUNTRY: str = "us"
    BRIGHTDATA_SERP_LANGUAGE: str = "en"
    BRIGHTDATA_SERP_CURRENCY: str = "USD"
    BRIGHTDATA_SERP_TIMEOUT_SECONDS: float = 25.0
    BRIGHTDATA_SERP_CACHE_TTL_SECONDS: int = 180
    BRIGHTDATA_SERP_MAX_RESULTS: int = 16

    # One platform-aware session boundary. Development intentionally uses a
    # stable local identity so the project runs without Docker or a second
    # auth service. Production must set this to cloudflare-access or
    # chatgpt-sites and provide a secret at the API boundary.
    # Deliberately unset: every process must explicitly declare local or
    # hosted operation before the application starts serving requests.
    SCHEMATIC_DEPLOYMENT_ENV: str = ""
    SCHEMATIC_AUTH_MODE: str = "development"
    SCHEMATIC_SESSION_SECRET: str = ""
    SCHEMATIC_SESSION_AUDIENCE: str = "schematic-api"
    SCHEMATIC_SESSION_TTL_SECONDS: int = 3600
    SCHEMATIC_WS_TICKET_TTL_SECONDS: int = 60
    SCHEMATIC_DEV_SUBJECT: str = "local-development"
    SCHEMATIC_DEV_EMAIL: str = "local@localhost"
    SCHEMATIC_TRUST_PLATFORM_HEADERS: bool = False
    SCHEMATIC_PLATFORM_INGRESS_SECRET: str = ""
    CF_ACCESS_TEAM_DOMAIN: str = ""
    CF_ACCESS_AUDIENCE: str = ""

    model_config = SettingsConfigDict(
        env_file=_BACKEND_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )


settings = Settings()
