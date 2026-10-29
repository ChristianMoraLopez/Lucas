"""Reglas: montos, fechas, totales de recibos, CUFE y comercio."""

from datetime import date

import pytest

from lucas_worker.extract.numbers import (
    find_amounts,
    merchant_key,
    normalize_merchant,
    parse_cop_amount,
    parse_number,
)
from lucas_worker.extract.rules import (
    analyze_document,
    analyze_message,
    best_date,
    find_cufe,
    find_dates,
    merchant_from_text,
    relative_date,
)

HOY = date(2026, 9, 30)  # miércoles


# Los mismos casos que prueban public.parse_cop_amount (supabase/tests/fase2.test.ts)
@pytest.mark.parametrize(
    ("texto", "esperado"),
    [
        ("taxis al aeropuerto 100 lucas", 100_000),
        ("132,5 lucas", 132_500),
        ("me debes 40 lucas", 40_000),
        ("84 mil el mercado", 84_000),
        ("1,2 palos el hotel", 1_200_000),
        ("2 millones", 2_000_000),
        ("$84.300", 84_300),
        ("Empanadas y jugos en La Bahía 111.500", 111_500),
        ("TOTAL 1.014.500", 1_014_500),
        ("84.300,50", 84_300),
        ("84300", 84_300),
        ("pagué 38 el taxi", 38_000),
        ("50k de gasolina", 50_000),
        ("almuerzo del 26/09", None),
        ("sin plata", None),
    ],
)
def test_montos_como_los_escribe_la_gente(texto, esperado):
    assert parse_cop_amount(texto) == esperado


@pytest.mark.parametrize(
    ("token", "esperado"),
    [
        ("11.300", 11_300),
        ("$ 11.300", 11_300),
        ("11,300.00", 11_300),
        ("11.300,00", 11_300),
        ("11300.00", 11_300),
        ("1.785.000", 1_785_000),
        ("1,785,000", 1_785_000),
        ("0", 0),
        ("abc", None),
    ],
)
def test_numeros_de_recibos(token, esperado):
    assert parse_number(token) == esperado


def test_montos_de_una_linea():
    assert find_amounts("TOTAL A PAGAR $ 244.912") == [244_912]
    assert find_amounts("2 Pandebono 5.000") == [2, 5_000]


def test_normalizar_comercios_como_postgres():
    assert normalize_merchant("Panadería  La Espiga") == "panaderia la espiga"
    assert normalize_merchant("TIENDA DOÑA ROSA!!") == "tienda dona rosa"
    assert normalize_merchant("  ") is None
    assert merchant_key("PANADERIA LA ESPIGA S.A.S.") == "panaderia la espiga"
    assert merchant_key("Distribuidora Ltda.") == "distribuidora"


def test_comercio_a_partir_del_mensaje():
    casos = {
        "taxis al aeropuerto 100 lucas": "Taxis al aeropuerto",
        "La lancha a Playa Cristal la pagó Santi: 210.500": "Lancha a Playa Cristal",
        "pagué el almuerzo en El Sazón de Mamá 41.200": "Almuerzo en El Sazón de Mamá",
        "100 lucas": "Gasto sin nombre",
        "hielo 12 lucas entre Vale y Santi, ayer": "Hielo",
        # Mensajes reales: el «en qué», sin verbos, fechas ni a quién beneficia
        "Ayer gastamos 47,500 en un vale de salud para Valentina": "Vale de salud",
        "El día de hoy, 1 de octubre gastamos otros 47,500 para un Vale de salud": "Vale de salud",
        "pagué 120000 por las cabañas": "Cabañas",
        "gasolina 90 mil, la pagó Andrés": "Gasolina",
        "nos cobraron 80 lucas por el parqueadero del centro comercial Santafé de Bogotá": "Parqueadero del centro comercial Santafé",
        # El saludo, a quién le habla y quién pagó no son el comercio (Sam en Gentelinda)
        "Hola papi fueron 95k de salchipapas": "Salchipapas",
        "Gente, 120 lucas del mercado": "Mercado",
        "Christian pagó 95k de salchipapas": "Salchipapas",
        "Holanda 30k": "Holanda",
    }
    for texto, esperado in casos.items():
        assert merchant_from_text(texto) == esperado


def test_fechas_colombianas():
    valores = [h.value for h in find_dates("Fecha: 26/09/2026 08:14 · vence 05-10-26 · 2026-09-01", HOY)]
    assert valores == [date(2026, 9, 1), date(2026, 9, 26), date(2026, 10, 5)]
    assert [h.value for h in find_dates("26 de septiembre de 2026", HOY)] == [date(2026, 9, 26)]
    assert [h.value for h in find_dates("almuerzo del 26 sep", HOY)] == [date(2026, 9, 26)]
    # Sin año y en el futuro: era el año pasado
    assert [h.value for h in find_dates("cena del 20/12", HOY)] == [date(2025, 12, 20)]
    # El OCR pegó el año con la hora
    assert [h.value for h in find_dates("Fecha: 26/09/202608:14", HOY)] == [date(2026, 9, 26)]
    # Datáfono gringo: mes/día
    assert [h.value for h in find_dates("09/26/2026", HOY)] == [date(2026, 9, 26)]


def test_fechas_relativas():
    assert relative_date("ayer pagué el taxi", HOY).value == date(2026, 9, 29)
    assert relative_date("antier fuimos", HOY).value == date(2026, 9, 28)
    assert relative_date("el sábado en la tienda", HOY).value == date(2026, 9, 26)
    assert relative_date("el miércoles", HOY).value == date(2026, 9, 23)  # hoy es miércoles: el pasado
    assert relative_date("sin fecha", HOY) is None


def test_mejor_fecha_descarta_futuras_y_viejas():
    hits = find_dates("vence 05/12/2026 · 01/01/2020 · 26/09/2026", HOY)
    assert best_date(hits, HOY) == date(2026, 9, 26)


def test_mensaje():
    h = analyze_message("taxis al aeropuerto 100 lucas, la pagó Santi ayer", HOY)
    assert h.amount == 100_000
    assert [d.value for d in h.dates] == [date(2026, 9, 29)]
    assert h.merchant_guess == "Taxis al aeropuerto"
    assert h.category_guess == "Transporte"


RECIBO = """PANADERIA LA ESPIGA S.A.S.
NIT 900.123.456-7
Fecha: 26/09/2026 08:14
2 Pandebono 5.000
SUBTOTAL 9.496
IVA 19% 1.804
TOTAL 11.300
TOTAL ITEMS 4
Efectivo 20.000
Cambio 8.700"""


def test_recibo():
    h = analyze_document(RECIBO, HOY)
    assert h.total_candidates == [11_300]
    assert (h.subtotal, h.tax) == (9_496, 1_804)
    assert h.nit == "900123456-7"
    assert h.merchant_guess == "PANADERIA LA ESPIGA S.A.S."
    assert [d.value for d in h.dates] == [date(2026, 9, 26)]


def test_total_en_la_linea_siguiente():
    h = analyze_document("TIENDA X\nTOTAL A PAGAR\n$ 45.600\n", HOY)
    assert h.total_candidates == [45_600]


def test_cufe_en_el_texto():
    cufe = "ab" * 48
    assert find_cufe(f"Factura\nCUFE: {cufe.upper()}\n") == cufe
    assert find_cufe("CUFE: corto") is None


def test_total_pagado_no_es_el_total_y_el_comercio_no_es_una_linea_de_plata():
    h = analyze_document("SUBTOTAL 10.000\nTOTAL 11.900\nTOTAL PAGADO 20.000\nCAMBIO 8.100", HOY)
    assert h.total_candidates == [11_900]
    assert h.merchant_guess is None


# Un mensaje con varias cosas se suma (el de Amazonas llegaba como $5.000)
AMAZONAS = "5 k bloqueador \n4.5 k de cerveza \n\n980 de tours \n\nTodo es viaje de amazonas"


@pytest.mark.parametrize(
    ("texto", "esperado"),
    [
        (AMAZONAS, 989_500),
        ("Mercado 120.000 y farmacia 35.500", 155_500),
        ("pan 5k, leche 10k", 15_000),
        ("hielo 8 lucas y ron 116 lucas, los pagó Santi", 124_000),
        # No se suma: cantidades, a cuántos se divide, horas, por persona, el total dicho, vueltos
        ("2 cervezas 10k", 10_000),
        ("hotel 300 mil por 2 noches", 300_000),
        ("almuerzo 25.000 para 4", 25_000),
        ("taxi 45 lucas, la pagó Andrés, entre 3", 45_000),
        ("a las 3:30 el taxi 20 lucas", 20_000),
        ("hotel 300 mil cada uno", 300_000),
        ("total 15k: 5k pan y 10k leche", 15_000),
        ("5k pan y 10k leche, 15k en total", 15_000),
        ("pagué 50 lucas y me dieron 5 de vuelto", 50_000),
        # Antes se perdía: la coma de miles y la fecha escrita
        ("El día de hoy, 1 de octubre gastamos otros 47,500 para un Vale de salud", 47_500),
    ],
)
def test_varias_cosas_en_un_mensaje_se_suman(texto, esperado):
    assert parse_cop_amount(texto) == esperado


def test_el_mensaje_de_amazonas_trae_sus_cosas():
    h = analyze_message(AMAZONAS, HOY)
    assert (h.amount, h.sumados) == (989_500, 3)
    assert [(i.name, i.total_cop) for i in h.items] == [("Bloqueador", 5_000), ("Cerveza", 4_500), ("Tours", 980_000)]
    assert h.merchant_guess == "Viaje de amazonas"


def test_sin_linea_aparte_el_nombre_son_las_cosas():
    h = analyze_message("Mercado 120.000 y farmacia 35.500", HOY)
    assert [(i.name, i.total_cop) for i in h.items] == [("Mercado", 120_000), ("Farmacia", 35_500)]
    assert h.merchant_guess == "Mercado y farmacia"
    # Montos sin nombre: se suman, pero sin ítems
    h = analyze_message("5k 10k", HOY)
    assert (h.amount, h.items) == (15_000, [])
