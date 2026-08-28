from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    FRONTEND_URL: str = "http://localhost:3000"
    DATABASE_URL: str = "sqlite:///./data/schematic.db"
    RENODE_BIN: str = "renode"
    NGSPICE_LIB: str = ""
    WASMTIME_CACHE: str = "./data/wasmtime-cache"
    # SuperTokens core — https://github.com/supertokens/supertokens-core
    # Each user gets a room stored on their device (localStorage per userId), but the session
    # is verified via SuperTokens so WebMCP mutations are scoped to that room.
    SUPERTOKENS_CONNECTION_URI: str = "http://localhost:3567"
    SUPERTOKENS_API_DOMAIN: str = "http://localhost:8001"
    SUPERTOKENS_WEBSITE_DOMAIN: str = "http://localhost:3000"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
