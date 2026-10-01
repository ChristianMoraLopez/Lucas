"""Validación: de dónde sale cada campo y cuánta confianza merece."""

from datetime import date

from lucas_worker.extract.cascade import Extraction
from lucas_worker.extract.qr_dian import DianQr
from lucas_worker.extract.rules import analyze_document, analyze_message
from lucas_worker.llm.schema import ReceiptExtraction
from lucas_worker.validate import AccountWindow, reconcile

from .conftest import HOY

HOGAR = AccountWindow()


def llm(**kw) -> ReceiptExtraction:
    return ReceiptExtraction.model_validate(
        {"is_expense": True, "merchant": None, "date": None, "total_cop": None, "description_en": "x", **kw}
    )


def doc(texto: str, quality: float = 0.95, qr: DianQr | None = None) -> Extraction:
    return Extraction(
        kind="photo", method="photo_ocr", text=texto, quality=quality, qr=qr, hints=analyze_document(texto, HOY)
    )


def test_total_del_llm_que_coincide_con_la_linea_total():
    d = reconcile(doc("TIENDA\nTOTAL 45.600"), llm(total_cop=45_600), today=HOY, received=HOY, account=HOGAR)
    assert d.total_cop == 45_600 and d.confidence["total"] >= 0.9 and d.sources["total"] == "llm+reglas"


def test_total_ambiguo_gana_el_que_cuadra_con_subtotal_mas_iva():
    texto = "X\nSUBTOTAL 10.000\nIVA 1.900\nTOTAL 11.900\nTOTAL 20.000"
    d = reconcile(doc(texto), llm(total_cop=20_000), today=HOY, received=HOY, account=HOGAR)
    assert d.total_cop == 11_900 and d.sources["total"] == "aritmetica"


def test_llm_con_un_total_que_no_esta_en_el_recibo_es_poco_confiable():
    d = reconcile(doc("TIENDA\nleche 9.800"), llm(total_cop=77_000), today=HOY, received=HOY, account=HOGAR)
    assert d.total_cop == 77_000 and d.confidence["total"] < 0.75


def test_sin_total_por_ningun_lado():
    d = reconcile(doc("GRACIAS POR SU COMPRA"), llm(), today=HOY, received=HOY, account=HOGAR)
    assert d.total_cop == 0 and d.confidence["total"] < 0.5


def test_fecha_futura_del_llm_se_ignora_y_sin_fecha_usa_la_del_mensaje():
    d = reconcile(
        doc("TIENDA\nTOTAL 1.000"), llm(date="2027-01-01"), today=HOY, received=date(2026, 9, 29), account=HOGAR
    )
    assert d.expense_date == date(2026, 9, 29) and d.confidence["date"] == 0.6


def test_fecha_del_qr_manda():
    qr = DianQr(raw="x", total=11_300, issued_on=date(2026, 9, 26))
    d = reconcile(
        doc("TOTAL 11.300", qr=qr), llm(date="2026-09-20", total_cop=11_300), today=HOY, received=HOY, account=HOGAR
    )
    assert (d.expense_date, d.confidence["date"], d.confidence["total"]) == (date(2026, 9, 26), 0.99, 0.99)


def test_fecha_fuera_del_evento_baja_la_confianza():
    paseo = AccountWindow("evento", date(2026, 9, 24), date(2026, 9, 28))
    d = reconcile(doc("TOTAL 1.000\nFecha: 01/06/2026"), llm(), today=HOY, received=HOY, account=paseo)
    assert d.expense_date == date(2026, 6, 1) and d.confidence["date"] <= 0.6
    assert "fuera de las fechas del evento" in d.notes[0]


def test_comercio_del_llm_que_aparece_en_el_recibo():
    d = reconcile(
        doc("PANADERIA LA ESPIGA\nTOTAL 1.000"),
        llm(merchant="Panadería La Espiga"),
        today=HOY,
        received=HOY,
        account=HOGAR,
    )
    assert d.merchant == "Panadería La Espiga" and d.confidence["merchant"] >= 0.85
    inventado = reconcile(doc("TIENDA X\nTOTAL 1.000"), llm(merchant="Éxito"), today=HOY, received=HOY, account=HOGAR)
    assert inventado.confidence["merchant"] < 0.75


def test_mensaje_de_texto_reglas_primero():
    ex = Extraction(
        kind="text", method="text", text="hielo 12 lucas ayer", hints=analyze_message("hielo 12 lucas ayer", HOY)
    )
    d = reconcile(ex, None, today=HOY, received=HOY, account=HOGAR)
    assert (d.total_cop, d.expense_date, d.merchant) == (12_000, date(2026, 9, 29), "Hielo")
    assert d.confidence["total"] == 0.84  # como el procesador simulado cuando solo hay reglas
