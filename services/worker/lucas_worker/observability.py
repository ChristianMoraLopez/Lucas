"""Logs en JSON (una línea por evento) y Sentry.

Nada del contenido de los recibos sale en los logs ni en Sentry: solo ids,
etapas, tiempos y errores. `send_default_pii` va apagado.
"""

from __future__ import annotations

import json
import logging
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from . import __version__
from .config import Settings

log = logging.getLogger("lucas_worker")

_EXTRA_FIELDS = ("job_id", "message_id", "account_id", "stage", "attempt", "elapsed_ms", "outcome", "detail")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
            "level": record.levelname.lower(),
            "msg": record.getMessage(),
            "logger": record.name,
        }
        for key in _EXTRA_FIELDS:
            value = getattr(record, key, None)
            if value is not None:
                data[key] = value
        if record.exc_info:
            data["exc"] = self.formatException(record.exc_info)
        return json.dumps(data, ensure_ascii=False, default=str)


def setup_logging(settings: Settings) -> None:
    handler = logging.StreamHandler(sys.stdout)
    if settings.log_json:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(settings.log_level.upper())
    # Librerías ruidosas
    for name in ("httpx", "httpcore", "RapidOCR", "pdfminer", "huggingface_hub", "PIL"):
        logging.getLogger(name).setLevel(logging.WARNING)


def _scrub(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any] | None:
    """Sentry: quita variables locales (podrían tener texto de recibos) y cuerpos HTTP."""
    for exc in (event.get("exception") or {}).get("values", []) or []:
        for frame in (exc.get("stacktrace") or {}).get("frames", []) or []:
            frame.pop("vars", None)
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("data", None)
    return event


def init_sentry(settings: Settings) -> bool:
    if not settings.sentry_dsn:
        return False
    import sentry_sdk
    from sentry_sdk.integrations.logging import LoggingIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=f"lucas-worker@{__version__}",
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
        include_local_variables=False,
        max_breadcrumbs=50,
        before_send=_scrub,
        integrations=[LoggingIntegration(level=logging.INFO, event_level=None)],
    )
    sentry_sdk.set_tag("worker_id", settings.worker_id)
    sentry_sdk.set_tag("ollama_model", settings.ollama_model)
    sentry_sdk.set_tag("laya_variant", str(settings.laya_variant))
    log.info("Sentry activo", extra={"detail": settings.sentry_environment})
    return True


@contextmanager
def job_scope(job_id: str, message_id: str | None, attempt: int) -> Iterator[None]:
    """Etiqueta todo lo que pase dentro (errores, spans) con el trabajo."""
    import sentry_sdk

    with sentry_sdk.isolation_scope() as scope:
        scope.set_tag("job_id", job_id)
        scope.set_tag("attempt", attempt)
        if message_id:
            scope.set_tag("message_id", message_id)
        with sentry_sdk.start_transaction(op="queue.process", name="process_message"):
            yield


@contextmanager
def stage(name: str, **extra: Any) -> Iterator[None]:
    """Mide una etapa del proceso (log + span de Sentry si hay trazas)."""
    import sentry_sdk

    started = time.perf_counter()
    with sentry_sdk.start_span(op="lucas.stage", name=name):
        try:
            yield
        finally:
            ms = round((time.perf_counter() - started) * 1000)
            log.debug("etapa", extra={"stage": name, "elapsed_ms": ms, **extra})


def capture(exc: BaseException, *, level: str = "error", **tags: Any) -> None:
    import sentry_sdk

    with sentry_sdk.new_scope() as scope:
        scope.level = level  # type: ignore[assignment]
        for k, v in tags.items():
            scope.set_tag(k, v)
        sentry_sdk.capture_exception(exc)
