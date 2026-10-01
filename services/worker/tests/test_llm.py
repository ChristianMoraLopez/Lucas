"""Cliente de Ollama: salida estructurada, validación Pydantic y errores."""

from __future__ import annotations

import json

import httpx
import pytest

from lucas_worker.errors import LlmUnavailable
from lucas_worker.llm.ollama import LlmError, OllamaClient
from lucas_worker.llm.prompt import build_user_prompt
from lucas_worker.llm.schema import ReceiptExtraction, inline_schema

from .conftest import HOY

BUENO = {
    "is_expense": True,
    "merchant": "Panadería La Espiga",
    "merchant_nit": "900.123.456-7",
    "date": "2026-09-26",
    "total_cop": 11300,
    "subtotal_cop": "9.496",
    "tax_cop": 1804.2,
    "items": [{"name": "Pandebono", "quantity": 2, "unit_price_cop": 2500, "total_cop": 5000}],
    "payer_name": None,
    "description_en": "Bakery breakfast: pandebono, coffee and bread",
}


def _cliente(respuestas: list[httpx.Response | Exception], vistos: list[dict] | None = None) -> OllamaClient:
    cola = list(respuestas)

    def manejar(request: httpx.Request) -> httpx.Response:
        if vistos is not None:
            vistos.append(json.loads(request.content))
        r = cola.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    http = httpx.Client(transport=httpx.MockTransport(manejar))
    return OllamaClient("http://ollama:11434", "qwen2.5:7b", client=http)


def _chat(contenido: dict | str) -> httpx.Response:
    texto = contenido if isinstance(contenido, str) else json.dumps(contenido)
    return httpx.Response(200, json={"message": {"role": "assistant", "content": texto}, "done": True})


def test_pide_json_con_esquema_y_valida():
    vistos: list[dict] = []
    r = _cliente([_chat(BUENO)], vistos).extract(kind="receipt photo (OCR)", today=HOY, document_text="TOTAL 11.300")
    assert r.total_cop == 11_300 and r.subtotal_cop == 9_496 and r.tax_cop == 1_804
    assert r.merchant_nit == "900123456"
    assert r.parsed_date.isoformat() == "2026-09-26"
    pedido = vistos[0]
    assert pedido["format"]["type"] == "object" and "description_en" in pedido["format"]["properties"]
    assert pedido["options"]["temperature"] == 0 and pedido["stream"] is False


def test_esquema_sin_referencias():
    s = json.dumps(inline_schema(ReceiptExtraction))
    assert "$ref" not in s and "$defs" not in s
    assert '"items"' in s and '"name"' in s


def test_si_el_json_no_valida_le_pide_corregirlo():
    malo = {**BUENO, "is_expense": "quizás"}
    vistos: list[dict] = []
    r = _cliente([_chat(malo), _chat(BUENO)], vistos).extract(kind="x", today=HOY)
    assert r.merchant == "Panadería La Espiga"
    assert "failed validation" in vistos[1]["messages"][-1]["content"]


def test_dos_json_invalidos_es_error_del_llm():
    with pytest.raises(LlmError):
        _cliente([_chat("no es json"), _chat("{}")]).extract(kind="x", today=HOY)


def test_ollama_caido_o_sin_modelo_se_reintenta():
    with pytest.raises(LlmUnavailable):
        _cliente([httpx.ConnectError("sin red")]).extract(kind="x", today=HOY)
    with pytest.raises(LlmUnavailable, match="ollama pull"):
        _cliente([httpx.Response(404, json={"error": "model not found"})]).extract(kind="x", today=HOY)


def test_limpia_lo_que_el_modelo_exagera():
    raro = {
        **BUENO,
        "date": "26/09/2026",  # no es ISO: se descarta
        "total_cop": -5,
        "items": [{"name": "  Pan  ", "quantity": "dos"}] * 40,
        "description_en": " x " * 100,
    }
    r = ReceiptExtraction.model_validate(raro)
    assert r.date is None and r.total_cop == 0
    assert len(r.items) == 30 and r.items[0].name == "Pan" and r.items[0].quantity == 1
    assert len(r.description_en) <= 160


def test_prompt_trae_pistas_y_recorta_documentos_largos():
    p = build_user_prompt(
        kind="receipt photo (OCR)",
        today=HOY,
        document_text="ARRIBA\n" + "x" * 20_000 + "\nTOTAL 11.300",
        total_candidates=[11_300],
        people=["Valeria", "Santi"],
        max_chars=2000,
    )
    assert "today: 2026-09-30" in p and "11300" in p and "Valeria, Santi" in p
    assert "ARRIBA" in p and "TOTAL 11.300" in p and len(p) < 3000
