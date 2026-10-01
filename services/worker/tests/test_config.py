"""La configuración de ejemplo se lee y los valores de ejemplo cuentan como vacíos."""

from pathlib import Path

from lucas_worker.config import LayaVariant, Settings


def test_env_example_se_lee(monkeypatch):
    for nombre in ("SUPABASE_URL", "HF_REPO", "HF_TOKEN", "SENTRY_DSN", "LAYA_VARIANT"):
        monkeypatch.delenv(nombre, raising=False)
    s = Settings(_env_file=Path(__file__).parent.parent / ".env.example")  # type: ignore[call-arg]
    assert s.supabase_url == "https://tu-proyecto.supabase.co"
    assert s.laya_variant == LayaVariant.MULTILINGUAL
    assert s.hf_repo is None and s.hf_token is None  # «tu-usuario/…» y «hf_xxx…» no son reales
    assert s.sentry_dsn is None
    assert s.ollama_model == "qwen2.5:7b" and s.auto_confirm_min == 0.9


def test_variante_inglesa(monkeypatch):
    monkeypatch.setenv("LAYA_VARIANT", "english")
    s = Settings(_env_file=None, supabase_url="https://x.supabase.co/", supabase_service_role_key="k")  # type: ignore[call-arg]
    assert s.laya_variant == LayaVariant.ENGLISH and s.supabase_url == "https://x.supabase.co"
