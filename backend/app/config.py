"""App settings, read from environment variables (or a .env file)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database: SQLite locally, Postgres on Render (postgresql+psycopg://...)
    database_url: str = "sqlite:///./mandate.db"

    # PayPal (sandbox). Leave client id empty to run in mock mode.
    paypal_client_id: str = ""
    paypal_client_secret: str = ""
    paypal_base_url: str = "https://api-m.sandbox.paypal.com"
    paypal_webhook_id: str = ""
    currency: str = "USD"

    # Anthropic
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5-5"

    # Channel3 product search. Empty key -> built-in demo catalog.
    channel3_api_key: str = ""
    channel3_base_url: str = "https://api.trychannel3.com"

    # Where the frontend lives (CORS + PayPal return URLs)
    frontend_url: str = "http://localhost:3000"

    @property
    def paypal_mock(self) -> bool:
        return not (self.paypal_client_id and self.paypal_client_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
