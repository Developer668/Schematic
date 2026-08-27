from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    FRONTEND_URL: str = "http://localhost:3000"
    DATABASE_URL: str = "sqlite:///./data/schematic.db"
    RENODE_BIN: str = "renode"
    NGSPICE_LIB: str = ""
    WASMTIME_CACHE: str = "./data/wasmtime-cache"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
