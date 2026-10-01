"""Configuración por variables de entorno (ver .env.example)."""

from __future__ import annotations

import os
import socket
from enum import StrEnum
from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class LayaVariant(StrEnum):
    """Las dos variantes de Laya que el worker sabe usar.

    - multilingual: laya-multilingual (mmBERT-base, 322M). Lee el texto original
      en español: comercio, mensaje, ítems y lo que salió del recibo.
    - english: laya (ModernBERT-large, 421M). Lee la descripción normalizada en
      inglés que escribe el LLM, más el comercio.
    """

    MULTILINGUAL = "multilingual"
    ENGLISH = "english"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Supabase (service role: salta RLS; jamás fuera de este servidor)
    supabase_url: str
    supabase_service_role_key: SecretStr
    evidence_bucket: str = "evidencias"

    # Cola
    worker_id: str = Field(default_factory=lambda: f"{socket.gethostname()}-{os.getpid()}")
    poll_interval_s: float = 3.0
    batch_size: int = 1  # Ollama en CPU atiende uno a la vez: más no acelera
    stale_after_minutes: int = 15

    # Ollama
    llm_enabled: bool = True
    ollama_base_url: str = "http://ollama:11434"
    ollama_model: str = "qwen2.5:7b"
    ollama_timeout_s: float = 300.0
    ollama_num_ctx: int = 4096
    ollama_keep_alive: str = "30m"

    # OCR
    ocr_threads: int = 0  # 0 = los que tenga la máquina
    ocr_max_side: int = 2000
    pdf_max_pages: int = 4

    # Laya
    laya_enabled: bool = True
    laya_variant: LayaVariant = LayaVariant.MULTILINGUAL
    laya_model_dir: Path | None = None  # carpeta local con la variante; si no, se baja de HF_REPO
    hf_repo: str | None = None
    hf_token: SecretStr | None = None
    laya_cache_dir: Path = Path("/models/laya")
    laya_onnx_file: str = "laya.int8.onnx"
    laya_threads: int = 0
    # Un checkpoint sin ajustar (zero-shot) es demasiado seguro de sí mismo: se
    # le pone techo para que lo que clasifique pase por revisión humana.
    laya_zero_shot_max_confidence: float = 0.8

    # Reglas de decisión
    auto_confirm_min: float = 0.9
    dedup_hash_max_distance: int = 12

    # Observabilidad
    sentry_dsn: str | None = None
    sentry_environment: str = "production"
    sentry_traces_sample_rate: float = 0.0
    log_level: str = "INFO"
    log_json: bool = True
    heartbeat_file: Path = Path("/tmp/lucas-worker-heartbeat")

    @field_validator("supabase_url", "ollama_base_url")
    @classmethod
    def _sin_barra(cls, v: str) -> str:
        return v.rstrip("/")

    @field_validator("hf_repo", "sentry_dsn", "laya_model_dir", mode="before")
    @classmethod
    def _vacio_es_none(cls, v: object) -> object:
        # En .env.example quedan vacíos o con el ejemplo «tu-usuario/…»
        if isinstance(v, str) and (not v.strip() or v.strip().startswith("tu-usuario/")):
            return None
        return v

    @field_validator("hf_token", mode="before")
    @classmethod
    def _token_vacio(cls, v: object) -> object:
        if isinstance(v, str) and (not v.strip() or v.strip().startswith("hf_xxx")):
            return None
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
