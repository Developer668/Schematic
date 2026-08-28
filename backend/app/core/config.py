from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    FRONTEND_URL: str = "http://localhost:3000"
    DATABASE_URL: str = "sqlite:///./data/schematic.db"
    RENODE_BIN: str = "renode"
    NGSPICE_LIB: str = ""
    WASMTIME_CACHE: str = "./data/wasmtime-cache"
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

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
