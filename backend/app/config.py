from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "postgresql://interview_user:interview_pass@localhost:5432/interview_db"
    redis_url: str = "redis://localhost:6379"

    # AI API keys
    anthropic_api_key: str = ""
    openai_api_key: str = ""

    # Model selection (override via env vars to swap providers)
    interviewer_model: str = "claude-sonnet-4-6"   # or "gpt-4o"
    evaluator_model: str = "gpt-4o-mini"
    recruiter_model: str = "gpt-4o"
    embedding_model: str = "text-embedding-3-small"  # for pgvector dedup

    # Session limits
    session_ttl_seconds: int = 7200   # Redis TTL — 2 hours
    max_questions: int = 8
    max_duration_seconds: int = 2700  # 45 minutes → closing phase

    # Dedup threshold (similarity > this → regenerate question)
    dedup_similarity_threshold: float = 0.85


settings = Settings()
