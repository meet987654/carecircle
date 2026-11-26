from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://carecircle:carecircle@localhost:5432/carecircle"

    # A task due at 08:00 shows as "due" until 08:00 + grace, then "overdue".
    # Stops the list turning red the minute something is due.
    overdue_grace_minutes: int = 15

    # Assistant: "template" (default, no network, deterministic) or "openai_compatible"
    # (Groq, Ollama, OpenAI... anything speaking /v1/chat/completions).
    assistant_provider: str = "template"
    llm_base_url: str = "https://api.groq.com/openai/v1"
    llm_api_key: str = ""
    llm_model: str = "qwen/qwen3.8-27b"
    llm_timeout_seconds: float = 20.0

    # Voice agent. Speech-to-text runs on the same OpenAI-compatible endpoint/key
    # (Groq Whisper); without a key the browser's own recognition is used.
    stt_model: str = "whisper-large-v3-turbo"
    # Server voice is optional: empty means the browser speaks the answer.
    # Groq's Orpheus voice needs its terms accepted once in the Groq console.
    tts_model: str = ""
    tts_voice: str = "hannah"

    # Signs session tokens. Set a long random value in any real deployment.
    auth_secret: str = "dev-only-change-me"
    session_days: int = 30
    # True behind HTTPS so the session cookie is never sent over plain HTTP.
    cookie_secure: bool = False

    seed_demo_data: bool = True
    cors_origins: str = "http://localhost:5173,http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()
