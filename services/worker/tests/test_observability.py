"""Sentry: etiquetas por trabajo y nada del contenido de los recibos."""

from __future__ import annotations

import json
import logging

import sentry_sdk
from sentry_sdk.transport import Transport

from lucas_worker.observability import JsonFormatter, capture, init_sentry, job_scope

from .conftest import make_settings


class TransporteDePrueba(Transport):
    def __init__(self) -> None:
        super().__init__()
        self.eventos: list[dict] = []

    def capture_envelope(self, envelope) -> None:
        for item in envelope.items:
            if item.headers.get("type") == "event":
                self.eventos.append(item.payload.json)


def test_sin_dsn_no_se_activa():
    assert init_sentry(make_settings(sentry_dsn=None)) is False


def test_errores_con_etiquetas_y_sin_variables_locales():
    assert init_sentry(make_settings(sentry_dsn="https://llave@o0.ingest.sentry.io/1", sentry_environment="pruebas"))
    transporte = TransporteDePrueba()
    sentry_sdk.get_client().transport = transporte
    try:
        with job_scope("job-1", "msg-1", 2):
            # El texto de un recibo en una variable local: no debe llegar a Sentry
            texto_del_recibo = "TOTAL " + "11.300 " * 3  # noqa: F841
            try:
                raise ValueError("Ollama no respondió")
            except ValueError as e:
                capture(e, level="warning", final=False)
        sentry_sdk.flush()
        assert len(transporte.eventos) == 1
        evento = transporte.eventos[0]
        assert evento["tags"]["job_id"] == "job-1" and evento["tags"]["message_id"] == "msg-1"
        assert evento["tags"]["final"] is False or evento["tags"]["final"] == "False"
        assert evento["environment"] == "pruebas" and evento["release"].startswith("lucas-worker@")
        assert "11.300 11.300" not in json.dumps(evento)
    finally:
        sentry_sdk.init(dsn=None)


def test_logs_en_json_con_los_ids():
    registro = logging.LogRecord("lucas_worker", logging.INFO, __file__, 1, "Trabajo listo: %s", ("ok",), None)
    registro.job_id = "job-1"
    registro.elapsed_ms = 1234
    linea = json.loads(JsonFormatter().format(registro))
    assert linea["msg"] == "Trabajo listo: ok" and linea["job_id"] == "job-1" and linea["elapsed_ms"] == 1234
