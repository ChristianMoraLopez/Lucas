"""Cuentas en dólares o bolivianos: los montos se guardan en centavos."""

from __future__ import annotations

import pytest

from lucas_worker.extract.items import items_del_recibo
from lucas_worker.extract.numbers import fijar_moneda, parse_cop_amount, parse_number
from lucas_worker.llm.prompt import build_user_prompt
from lucas_worker.pipeline import Job

from .conftest import FakeLlm
from .test_pipeline import gasto, procesador, respuesta


@pytest.fixture(autouse=True)
def pesos_al_final():
    yield
    fijar_moneda("COP")


def test_en_pesos_todo_sigue_igual():
    fijar_moneda("COP")
    assert parse_number("11.300") == 11_300
    assert parse_number("11,300.00") == 11_300
    assert parse_cop_amount("taxi 45 lucas") == 45_000
    fijar_moneda("CLP")
    assert parse_number("$15.990") == 15_990


@pytest.mark.parametrize(
    ("token", "centavos"),
    [("12.50", 1250), ("$12.50", 1250), ("1,234.56", 123_456), ("1.234,56", 123_456), ("45", 4500), ("1,250", 125_000)],
)
def test_numeros_de_recibo_en_dolares(token, centavos):
    fijar_moneda("USD")
    assert parse_number(token) == centavos


@pytest.mark.parametrize(
    ("texto", "centavos"),
    [
        ("uber 23.40", 2340),
        ("dinner $85 paid by Sam", 8500),
        ("2 tacos 15", 1500),
        ("rent 1.2k", 120_000),
        ("hola", None),
    ],
)
def test_mensajes_en_dolares(texto, centavos):
    fijar_moneda("USD")
    assert parse_cop_amount(texto) == centavos


def test_items_con_centavos():
    fijar_moneda("USD")
    texto = "JOE'S DINER\nBURGER 12.50\nFRIES 4.25\nSODA 2.75\nTOTAL 19.50"
    items = items_del_recibo(texto, 1950)
    # Los precios chicos con centavos se leen (en pesos, «12.50» no sería un precio)
    assert [i.total_cop for i in items] == [1250, 425, 275]
    assert [i.name.lower().split()[-1] for i in items] == ["burger", "fries", "soda"]


def test_el_prompt_pide_centavos():
    from datetime import date

    fijar_moneda("BOB")
    assert "CENTS" in build_user_prompt(kind="photo", today=date(2026, 10, 1), document_text="x")
    fijar_moneda("COP")
    assert "CENTS" not in build_user_prompt(kind="photo", today=date(2026, 10, 1), document_text="x")


def test_un_mensaje_en_una_cuenta_en_dolares(db, extractor):
    db.currency = "USD"
    mid = db.add_message("text", text="uber to the airport 23.40, la pagó Santi", sender="valeria")
    llm = FakeLlm(lambda _p: respuesta(merchant="Uber", total_cop=2340, payer_name="Santi", description_en="Ride"))
    procesador(db, extractor, llm).process(Job(id="j", payload={"message_id": mid}))
    g = gasto(db, mid)
    assert (g["merchant"], g["total_cop"]) == ("Uber", 2340)
