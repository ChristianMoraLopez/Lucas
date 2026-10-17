"""Recibos de viaje: un recibo de Chile en una cuenta en pesos colombianos se lee en pesos chilenos y se convierte."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

import httpx
import pytest
import respx
from fpdf import FPDF

from lucas_worker.cambio import Cambio, CambioNoDisponible, Tasa, convertir
from lucas_worker.extract.moneda import detectar_moneda
from lucas_worker.extract.numbers import fijar_moneda
from lucas_worker.llm.prompt import build_user_prompt
from lucas_worker.pipeline import Job, MessageProcessor

from .conftest import CUENTA, HOY, FakeDb, FakeLlm, make_settings
from .test_pipeline import gasto, qwen_honesto, respuesta

BOLETA_CHILE = """SUPERMERCADO LIDER
R.U.T.: 76.042.014-K
BOLETA ELECTRONICA N 123456
S.I.I. - SANTIAGO
FECHA: 28/09/2026
AGUA MINERAL 1.5L 1.290
EMPANADA DE PINO 2.500
TOTAL $ 3.790
Timbre Electronico SII"""

FACTURA_COLOMBIA = """PANADERIA LA ESPIGA S.A.S.
NIT 900.123.456-7
FACTURA ELECTRONICA DE VENTA SETP 990
Resolucion DIAN 18764000001
TOTAL $ 11.300"""


@pytest.fixture(autouse=True)
def pesos_al_final():
    yield
    fijar_moneda("COP")


# ---------------------------------------------------------------------------
# ¿En qué moneda está?
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("documento", "mensaje", "cuenta", "moneda"),
    [
        # Una boleta de Chile en una cuenta en pesos colombianos
        (BOLETA_CHILE, None, "COP", "CLP"),
        # La factura colombiana en una cuenta en pesos colombianos: nada que convertir
        (FACTURA_COLOMBIA, None, "COP", None),
        # …y en una cuenta en pesos chilenos, se convierte desde pesos colombianos
        (FACTURA_COLOMBIA, None, "CLP", "COP"),
        # Lo que llegó de verdad: «BOLETAELECTRONICA» pegado y el RUT sin la palabra (con K)
        (
            "SOC RISTORANTE LE DUE TORRI LIMITADA\n81.300.500-K\nBOLETAELECTRONICA: 254764\nTOTAL 122.180",
            None,
            "COP",
            "CLP",
        ),
        ("RESTAURANTE\n76.123.456-K\nTOTAL 15.990", None, "COP", "CLP"),
        # Un NIT colombiano de persona (dos cifras al comienzo) no es un RUT: sin K
        ("TIENDA DON PEPE\nNIT 79.123.456-1\nTOTAL 15.990", None, "COP", None),
        # Un voucher de tarjeta en Chile
        ("TRANSBANK\nVENTA DEBITO\nMONTO $ 12.500\nREDCOMPRA", None, "COP", "CLP"),
        # Dólares y euros escritos en el papel
        ("JOE'S DINER\nTOTAL US$ 25.00", None, "COP", "USD"),
        ("CAFE DEL PRADO\nTOTAL 12,50 €", None, "COP", "EUR"),
        ("PADARIA\nCNPJ 12.345.678/0001-90\nTOTAL R$ 45,90", None, "COP", "BRL"),
        ("TIENDA\nNIT 1234567\nTOTAL Bs 85.50", None, "COP", "BOB"),
        ("BODEGA\nRUC 20123456789 SUNAT\nTOTAL S/ 32.00", None, "COP", "PEN"),
        # «Chile relleno» en México no es Chile: gana México
        ("TAQUERIA\nRFC: TAQ010101AB1\nCFDI 4.0\nCHILE RELLENO 85.00", None, "COP", "MXN"),
        # Un país suelto no basta (también es una avenida o un plato)
        ("RESTAURANTE\nSALSA DE CHILE 3.000\nTOTAL 23.000", None, "COP", None),
        ("TIENDA AV. MEXICO\nTOTAL 12.000", None, "COP", None),
        # Sin nada que diga de dónde es: la moneda de la cuenta
        ("TOTAL $ 15.990", None, "COP", None),
        # El mensaje manda: lo que escribió quien lo mandó
        ("TOTAL $ 15.990", "almuerzo en Santiago, 15.990 CLP", "COP", "CLP"),
        (None, "taxi 15 lucas chilenas", "COP", "CLP"),
        (None, "el tour 20 dólares, la pagó Santi", "COP", "USD"),
        (None, "cena 45 euros", "COP", "EUR"),
        (None, "100 bolivianos el bus", "COP", "BOB"),
        (None, "mercado 45 lucas", "COP", None),
        # Si dice pesos colombianos (lo que cobró el banco), no se convierte
        (BOLETA_CHILE, "me cobraron 15.800 COP", "COP", None),
        # Si el mensaje nombra dos monedas, se mira el documento
        (BOLETA_CHILE, "son 3.790 pesos chilenos, como 4 dólares", "COP", "CLP"),
        # El QR de la DIAN es de Colombia
        ("TOTAL 11.300", None, "CLP", None),
    ],
)
def test_detectar_moneda(documento, mensaje, cuenta, moneda):
    d = detectar_moneda(documento=documento, mensaje=mensaje, cuenta=cuenta)
    assert (d.moneda if d else None) == moneda


def test_el_qr_de_la_dian_dice_pesos_colombianos():
    d = detectar_moneda(documento="TOTAL 11.300", mensaje=None, cuenta="CLP", qr_dian=True)
    assert d is not None and d.moneda == "COP" and "DIAN" in d.razon


def test_la_razon_dice_por_que():
    d = detectar_moneda(documento=BOLETA_CHILE, mensaje=None, cuenta="COP")
    assert d is not None and "RUT chileno" in d.razon and "SII" in d.razon


# ---------------------------------------------------------------------------
# Convertir
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("monto", "de", "a", "tasa", "esperado"),
    [
        (25_990, "CLP", "COP", "4.17", 108_378),  # pesos a pesos
        (1_250, "USD", "COP", "3900", 48_750),  # US$12,50 (centavos) a pesos
        (100_000, "COP", "USD", "0.000256", 2_560),  # $100.000 a US$25,60
        (3_790, "CLP", "BOB", "0.0073", 2_767),  # pesos chilenos a centavos de boliviano
        (1, "CLP", "COP", "4.5", 5),  # se redondea (mitad hacia arriba)
    ],
)
def test_convertir(monto, de, a, tasa, esperado):
    assert convertir(monto, de, a, Decimal(tasa)) == esperado


# ---------------------------------------------------------------------------
# Las tasas (currency-api, sin llave)
# ---------------------------------------------------------------------------

JSDELIVR = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{dia}/v1/currencies/clp.min.json"
ESPEJO = "https://{dia}.currency-api.pages.dev/v1/currencies/clp.min.json"


@respx.mock
def test_la_tasa_del_dia_del_recibo_y_queda_en_cache():
    ruta = respx.get(JSDELIVR.format(dia="2026-09-28")).mock(
        return_value=httpx.Response(200, json={"date": "2026-09-28", "clp": {"cop": 4.1712, "usd": 0.00106}})
    )
    cambio = Cambio(httpx.Client())
    t = cambio.tasa("CLP", "COP", date(2026, 9, 28), HOY)
    assert (t.valor, t.dia, t.fuente) == (Decimal("4.1712"), date(2026, 9, 28), "currency-api")
    assert cambio.tasa("clp", "usd", date(2026, 9, 28), HOY).valor == Decimal("0.00106")
    assert ruta.call_count == 1


@respx.mock
def test_si_el_dia_no_esta_usa_la_mas_reciente():
    respx.get(JSDELIVR.format(dia="2023-01-05")).mock(return_value=httpx.Response(404))
    respx.get(ESPEJO.format(dia="2023-01-05")).mock(return_value=httpx.Response(404))
    respx.get(JSDELIVR.format(dia="latest")).mock(
        return_value=httpx.Response(200, json={"date": "2026-09-29", "clp": {"cop": 4.2}})
    )
    t = Cambio(httpx.Client()).tasa("CLP", "COP", date(2023, 1, 5), HOY)
    assert (t.valor, t.dia) == (Decimal("4.2"), date(2026, 9, 29))


@respx.mock
def test_si_jsdelivr_falla_va_al_espejo():
    respx.get(JSDELIVR.format(dia="2026-09-28")).mock(side_effect=httpx.ConnectError("caído"))
    respx.get(ESPEJO.format(dia="2026-09-28")).mock(
        return_value=httpx.Response(200, json={"date": "2026-09-28", "clp": {"cop": 4.17}})
    )
    assert Cambio(httpx.Client()).tasa("CLP", "COP", date(2026, 9, 28), HOY).valor == Decimal("4.17")


@respx.mock
def test_sin_red_se_reintenta_mas_tarde():
    respx.get(url__regex=r".*").mock(side_effect=httpx.ConnectError("sin red"))
    with pytest.raises(CambioNoDisponible):
        Cambio(httpx.Client()).tasa("CLP", "COP", date(2026, 9, 28), HOY)


@respx.mock
def test_un_dia_en_el_futuro_usa_el_de_hoy():
    ruta = respx.get(JSDELIVR.format(dia=HOY.isoformat())).mock(
        return_value=httpx.Response(200, json={"date": HOY.isoformat(), "clp": {"cop": 4.1}})
    )
    Cambio(httpx.Client()).tasa("CLP", "COP", date(2027, 1, 1), HOY)
    assert ruta.called


def test_la_misma_moneda_no_pide_nada():
    t = Cambio(httpx.Client(transport=httpx.MockTransport(lambda r: pytest.fail("pidió una tasa")))).tasa(
        "COP", "COP", HOY, HOY
    )
    assert t.valor == 1


# ---------------------------------------------------------------------------
# De punta a punta
# ---------------------------------------------------------------------------


class FakeCambio:
    def __init__(self, tasas: dict[tuple[str, str], str] | None = None, falla: bool = False):
        self.tasas = tasas or {("CLP", "COP"): "4.17", ("COP", "CLP"): "0.24", ("USD", "COP"): "3900"}
        self.falla = falla
        self.calls: list[tuple[str, str, date]] = []

    def tasa(self, de: str, a: str, dia: date, hoy: date) -> Tasa:
        self.calls.append((de, a, dia))
        if self.falla:
            raise CambioNoDisponible("sin red")
        return Tasa(de, a, Decimal(self.tasas[(de, a)]), dia, "currency-api")


def procesador(db: FakeDb, extractor, llm=None, cambio=None) -> MessageProcessor:
    from lucas_worker.classify.classifier import CategoryClassifier

    return MessageProcessor(db, extractor, CategoryClassifier(None), make_settings(), llm, cambio)


def pdf_de(texto: str) -> bytes:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=11)
    for linea in texto.splitlines():
        pdf.cell(0, 6, linea, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def boleta(db: FakeDb, caption: str | None = None) -> str:
    mid = db.add_message("pdf", text=caption)
    path = f"{CUENTA}/{mid}-boleta.pdf"
    db.files[path] = pdf_de(BOLETA_CHILE)
    db.messages[mid]["media_path"] = path
    return mid


def lider(parts: dict[str, Any]):
    """Qwen leyendo la boleta tal cual, en pesos chilenos (si le avisaron la moneda)."""
    assert parts.get("currency") == "CLP"
    return respuesta(
        merchant="Supermercado Lider",
        date="2026-09-28",
        total_cop=3_790,
        items=[
            {"name": "Agua mineral 1.5L", "quantity": 1, "unit_price_cop": 1_290, "total_cop": 1_290},
            {"name": "Empanada de pino", "quantity": 1, "unit_price_cop": 2_500, "total_cop": 2_500},
        ],
        description_en="Supermarket: water and empanada",
    )


def test_una_boleta_de_chile_queda_en_pesos_colombianos(db, extractor):
    cambio = FakeCambio()
    llm = FakeLlm(lider)
    mid = boleta(db, "la pagó Santi")
    procesador(db, extractor, llm, cambio).process(Job(id="j", payload={"message_id": mid}))
    g = gasto(db, mid)
    # 3.790 CLP × 4,17 = 15.804 COP; los ítems también, para dividir por consumo
    assert g["total_cop"] == 15_804
    assert [i["total_cop"] for i in g["items"]] == [5_379, 10_425]
    assert (g["original_currency"], g["original_total"], g["fx_rate"]) == ("CLP", 3_790, "4.17")
    assert (g["fx_date"], g["fx_source"]) == ("2026-09-28", "currency-api")
    # La tasa es la del día del recibo
    assert cambio.calls == [("CLP", "COP", date(2026, 9, 28))]
    snap = g["ai_snapshot"]
    assert snap["total_cop"] == 15_804 and snap["currency"] == "CLP" and "RUT chileno" in snap["currency_reason"]
    # El LLM supo que el documento está en pesos chilenos
    assert llm.calls[0]["currency"] == "CLP"


def test_un_mensaje_en_dolares_en_una_cuenta_en_pesos(db, extractor):
    mid = db.add_message("text", text="el tour 20 dólares, la pagó Santi", sender="valeria")
    llm = FakeLlm(lambda p: respuesta(merchant="Tour", total_cop=2_000, payer_name="Santi", description_en="Tour"))
    procesador(db, extractor, llm, FakeCambio()).process(Job(id="j", payload={"message_id": mid}))
    g = gasto(db, mid)
    # 20 dólares se leen en centavos (2000) y se convierten: US$20 × 3.900 = $78.000
    assert (g["total_cop"], g["original_currency"], g["original_total"]) == (78_000, "USD", 2_000)


def test_una_factura_colombiana_en_una_cuenta_en_pesos_chilenos(db, extractor):
    db.currency = "CLP"
    mid = db.add_message("photo", file="recibo_panaderia_foto.jpg", text="la pagó Santi")
    procesador(db, extractor, FakeLlm(qwen_honesto), FakeCambio()).process(Job(id="j", payload={"message_id": mid}))
    g = gasto(db, mid)
    # El QR de la DIAN dice pesos colombianos: $11.300 × 0,24 = 2.712 CLP
    assert (g["total_cop"], g["original_currency"], g["original_total"]) == (2_712, "COP", 11_300)


def test_lo_de_siempre_no_se_convierte(db, extractor):
    cambio = FakeCambio()
    mid = db.add_message("photo", file="recibo_panaderia_foto.jpg", text="la pagó Santi")
    procesador(db, extractor, FakeLlm(qwen_honesto), cambio).process(Job(id="j", payload={"message_id": mid}))
    g = gasto(db, mid)
    assert g["total_cop"] == 11_300 and "original_currency" not in g
    assert cambio.calls == [] and "currency" not in g["ai_snapshot"]


def test_sin_tasa_se_reintenta(db, extractor):
    mid = boleta(db)
    with pytest.raises(CambioNoDisponible):
        procesador(db, extractor, FakeLlm(lider), FakeCambio(falla=True)).process(
            Job(id="j", attempts=1, payload={"message_id": mid})
        )
    assert db.expenses == []


def test_sin_tasa_en_el_ultimo_intento_queda_por_revisar_con_el_monto_del_recibo(db, extractor):
    mid = boleta(db, "la pagó Santi")
    procesador(db, extractor, FakeLlm(lider), FakeCambio(falla=True)).process(
        Job(id="j", attempts=5, max_attempts=5, payload={"message_id": mid})
    )
    g = gasto(db, mid)
    assert (g["total_cop"], g["status"]) == (0, "pending_review")
    assert (g["original_currency"], g["original_total"]) == ("CLP", 3_790)
    assert "fx_rate" not in g
    assert g["field_confidence"]["total"] == 0
    assert any("Sin tasa de CLP" in n for n in g["ai_snapshot"]["notes"])


def test_la_moneda_de_la_cuenta_vuelve_despues_de_un_recibo_de_viaje(db, extractor):
    from lucas_worker.extract.numbers import con_centavos

    mid = db.add_message("text", text="el tour 20 dólares", sender="valeria")
    llm = FakeLlm(lambda p: respuesta(merchant="Tour", total_cop=2_000, description_en="Tour"))
    procesador(db, extractor, llm, FakeCambio()).process(Job(id="j", payload={"message_id": mid}))
    assert not con_centavos()


def test_el_prompt_dice_la_moneda_del_recibo():
    fijar_moneda("CLP")
    p = build_user_prompt(kind="photo", today=HOY, document_text="x", currency="CLP")
    assert "Chilean pesos (CLP)" in p and "never convert" in p and "CENTS" not in p
    fijar_moneda("EUR")
    p = build_user_prompt(kind="photo", today=HOY, document_text="x", currency="EUR")
    assert "euros (EUR)" in p and "CENTS" in p
    fijar_moneda("COP")
    assert "IMPORTANT" not in build_user_prompt(kind="photo", today=HOY, document_text="x", currency="COP")
