"""De punta a punta con los recibos de ejemplo: OCR, QR y PDF reales; Supabase y Ollama de mentira."""

from __future__ import annotations

from typing import Any

import pytest

from lucas_worker.classify.classifier import CategoryClassifier
from lucas_worker.errors import LlmUnavailable, PermanentError
from lucas_worker.llm.ollama import LlmError
from lucas_worker.llm.schema import ReceiptExtraction
from lucas_worker.pipeline import Job, MessageProcessor

from .conftest import CATEGORIAS, PERSONAS, FakeDb, FakeLlm, llm_caido, make_settings


def respuesta(**kw: Any) -> ReceiptExtraction:
    base = {
        "is_expense": True,
        "merchant": None,
        "date": None,
        "total_cop": None,
        "items": [],
        "description_en": "",
    }
    return ReceiptExtraction.model_validate({**base, **kw})


def qwen_honesto(parts: dict[str, Any]) -> ReceiptExtraction:
    """Un LLM que lee bien: lo que diría Qwen para cada recibo de ejemplo."""
    doc = parts.get("document_text") or ""
    msg = parts.get("message_text") or ""
    if "PANADERIA" in doc:
        return respuesta(
            merchant="Panadería La Espiga",
            date="2026-09-26",
            total_cop=11_300,
            subtotal_cop=9_496,
            tax_cop=1_804,
            items=[
                {"name": "Pandebono", "quantity": 2, "unit_price_cop": 2_500, "total_cop": 5_000},
                {"name": "Tinto grande", "quantity": 1, "unit_price_cop": 3_800, "total_cop": 3_800},
                {"name": "Pan francés", "quantity": 1, "unit_price_cop": 2_500, "total_cop": 2_500},
            ],
            description_en="Bakery breakfast: pandebono, coffee and bread",
        )
    if "TIENDA DON BETO" in doc:
        return respuesta(
            merchant="Tienda Don Beto",
            date="2026-09-25",
            total_cop=45_600,
            description_en="Corner store groceries: milk, eggs, arepas and cheese",
        )
    if "ENERG" in doc:
        return respuesta(
            merchant="Energía del Caribe",
            date="2026-09-22",
            total_cop=244_912,
            description_en="Electricity bill",
        )
    if "taxis" in msg:
        return respuesta(
            merchant="Taxis al aeropuerto", total_cop=100_000, payer_name="Santi", description_en="Airport taxi rides"
        )
    if "hola" in msg:
        return respuesta(is_expense=False, description_en="Greeting")
    return respuesta(description_en="Unknown")


def procesador(db: FakeDb, extractor, llm=None, **settings: Any) -> MessageProcessor:
    return MessageProcessor(db, extractor, CategoryClassifier(None), make_settings(**settings), llm)


def gasto(db: FakeDb, message_id: str) -> dict[str, Any]:
    return next(e for e in db.expenses if e["message_id"] == message_id)


def test_foto_con_qr_de_comercio_conocido_queda_confirmada(db, extractor):
    mid = db.add_message("photo", file="recibo_panaderia_foto.jpg", text="la pagó Santi")
    llm = FakeLlm(qwen_honesto)
    resultado = procesador(db, extractor, llm).process(db.add_job(mid) and Job(id="j1", payload={"message_id": mid}))
    g = gasto(db, mid)
    assert "confirmed" in resultado
    assert g["status"] == "confirmed"
    assert (g["merchant"], g["total_cop"], g["expense_date"]) == ("Panadería La Espiga", 11_300, "2026-09-26")
    assert g["category_id"] == CATEGORIAS["Café"] and g["memory_id"] == "mem-espiga"
    assert g["payer_person_id"] == PERSONAS["santi"]
    assert g["field_confidence"]["total"] == 0.99  # del QR
    assert g["ai_snapshot"]["sources"]["total"] == "qr"
    assert len(g["cufe"]) == 96 and len(g["image_hash"]) == 64
    assert len(g["items"]) == 3
    assert g["description"] == "Bakery breakfast: pandebono, coffee and bread"
    assert "[QR DIAN]" in g["extracted_text"]
    # El LLM recibió el texto del OCR, las pistas y la gente de la cuenta
    llamado = llm.calls[0]
    assert "TOTAL 11.300" in llamado["document_text"] and llamado["qr"].total == 11_300
    assert llamado["message_text"] == "la pagó Santi" and "Santi" in llamado["people"]


def test_la_misma_foto_otra_vez_es_duplicada(db, extractor):
    p = procesador(db, extractor, FakeLlm(qwen_honesto))
    primero = db.add_message("photo", file="recibo_panaderia_foto.jpg")
    p.process(Job(id="j1", payload={"message_id": primero}))
    otra = db.add_message("photo", file="recibo_panaderia_otra.webp")
    # Se lee (la huella sola no basta) y sale repetida: este recibo trae QR con CUFE
    assert "duplicado" in p.process(Job(id="j2", payload={"message_id": otra}))
    assert db.messages[otra]["status"] == "duplicate"
    assert db.messages[otra]["duplicate_of"] == gasto(db, primero)["id"]


def test_comprobante_parecido_con_otro_total_no_es_duplicado(db):
    """Dos comprobantes de Nu: huella casi igual, otro valor (pasó el 4 de octubre con uno de $105.900)."""
    dup = db._worker_find_duplicate
    db.expenses.append(
        {
            "id": "d1",
            "total_cop": 21_350,
            "expense_date": "2026-10-04",
            "image_hash": "f" * 64,
            "extracted_text": "autorización 273548",
        }
    )
    casi = "f" * 62 + "00"
    assert dup("c", None, casi, 12, 105_900, "2026-10-04", "autorización 434409") is None
    assert dup("c", None, casi, 12, 21_350, "2026-10-04", "autorización 999001") is None
    assert dup("c", None, casi, 12, 21_350, "2026-10-04", "autorización 273548") == "d1"
    assert dup("c", None, casi) is None  # sin total, la huella no basta


def test_la_misma_factura_en_otra_foto_se_detecta_por_cufe(db, extractor):
    p = procesador(db, extractor, FakeLlm(qwen_honesto))
    primero = db.add_message("photo", file="recibo_panaderia.png")
    p.process(Job(id="j1", payload={"message_id": primero}))
    # Foto distinta (huella lejana), misma factura: el QR trae el mismo CUFE
    otra = db.add_message("photo", file="recibo_panaderia_foto.jpg")
    assert "duplicado (CUFE)" in p.process(Job(id="j2", payload={"message_id": otra}))


def test_recibo_nuevo_sin_memoria_va_a_revision(db, extractor):
    mid = db.add_message("photo", file="recibo_tienda.jpg", sender="caro")
    procesador(db, extractor, FakeLlm(qwen_honesto)).process(Job(id="j", payload={"message_id": mid}))
    g = gasto(db, mid)
    assert g["status"] == "pending_review"
    assert (g["merchant"], g["total_cop"], g["expense_date"]) == ("Tienda Don Beto", 45_600, "2026-09-25")
    assert g["category_id"] == CATEGORIAS["Mercado"]  # palabras clave: «tienda»
    assert g["ai_snapshot"]["sources"]["category"] == "keywords"
    assert g["payer_person_id"] == PERSONAS["caro"]
    assert g["field_confidence"]["total"] >= 0.9  # el LLM y la línea TOTAL coinciden
    assert g["cufe"] is None


def test_pdf_digital(db, extractor):
    mid = db.add_message("pdf", file="factura_energia.pdf", sender="valeria")
    procesador(db, extractor, FakeLlm(qwen_honesto)).process(Job(id="j", payload={"message_id": mid}))
    g = gasto(db, mid)
    assert (g["total_cop"], g["expense_date"]) == (244_912, "2026-09-22")
    assert g["category_id"] == CATEGORIAS["Servicios"]
    assert g["ai_snapshot"]["method"] == "pdf_text"
    assert len(g["cufe"]) == 96


def test_mensaje_de_texto_con_pagador_y_division(db, extractor):
    mid = db.add_message(
        "text", text="taxis al aeropuerto 100 lucas, la pagó Santi, entre Vale y Caro", sender="valeria"
    )
    procesador(db, extractor, FakeLlm(qwen_honesto)).process(Job(id="j", payload={"message_id": mid}))
    g = gasto(db, mid)
    assert (g["merchant"], g["total_cop"]) == ("Taxis al aeropuerto", 100_000)
    assert g["payer_person_id"] == PERSONAS["santi"]
    assert g["split_person_ids"] == [PERSONAS["valeria"], PERSONAS["caro"]]
    assert g["split_note"].startswith("Leído del mensaje")
    assert g["category_id"] == CATEGORIAS["Transporte"]
    assert g["field_confidence"]["total"] == 0.95  # reglas y LLM coinciden
    assert g["expense_date"] == "2026-09-30"


def test_saludo_desde_whatsapp_no_es_gasto(db, extractor):
    mid = db.add_message("text", text="hola a todos", source="whatsapp")
    assert (
        procesador(db, extractor, FakeLlm(qwen_honesto)).process(Job(id="j", payload={"message_id": mid}))
        == "no es un gasto"
    )
    assert db.messages[mid]["status"] == "not_expense" and db.expenses == []


def test_lo_que_suben_desde_la_web_siempre_llega_a_revision(db, extractor):
    mid = db.add_message("text", text="hola a todos", source="web")
    procesador(db, extractor, FakeLlm(qwen_honesto)).process(Job(id="j", payload={"message_id": mid}))
    assert gasto(db, mid)["status"] == "pending_review"


def test_ollama_caido_se_reintenta_y_en_el_ultimo_intento_sigue_con_reglas(db, extractor):
    mid = db.add_message("text", text="taxis al aeropuerto 100 lucas", sender="santi")
    p = procesador(db, extractor, FakeLlm(llm_caido))
    with pytest.raises(LlmUnavailable):
        p.process(Job(id="j", attempts=1, max_attempts=5, payload={"message_id": mid}))
    assert db.expenses == []
    p.process(Job(id="j", attempts=5, max_attempts=5, payload={"message_id": mid}))
    g = gasto(db, mid)
    assert (g["total_cop"], g["merchant"], g["status"]) == (100_000, "Taxis al aeropuerto", "pending_review")
    assert g["description"] == "Transport"  # sin LLM: descripción por categoría
    assert "llm_model" not in g["ai_snapshot"]


def test_json_invalido_del_llm_no_tumba_el_gasto(db, extractor):
    mid = db.add_message("photo", file="recibo_tienda.jpg")
    procesador(db, extractor, FakeLlm(lambda _: LlmError("x"))).process(Job(id="j", payload={"message_id": mid}))
    g = gasto(db, mid)
    assert g["total_cop"] == 45_600 and g["merchant"] == "Tienda Don Beto"


def test_el_llm_no_puede_contradecir_el_qr(db, extractor):
    mid = db.add_message("photo", file="recibo_panaderia.png")
    mentiroso = FakeLlm(lambda p: respuesta(merchant="Panadería La Espiga", total_cop=20_000, description_en="Bakery"))
    procesador(db, extractor, mentiroso).process(Job(id="j", payload={"message_id": mid}))
    g = gasto(db, mid)
    assert g["total_cop"] == 11_300
    assert any("QR" in n for n in g["ai_snapshot"]["notes"])


def test_sin_llm_configurado(db, extractor):
    mid = db.add_message("photo", file="recibo_panaderia.png")
    procesador(db, extractor, None).process(Job(id="j", payload={"message_id": mid}))
    g = gasto(db, mid)
    assert g["total_cop"] == 11_300 and g["merchant"] == "Panaderia La Espiga"
    assert g["category_id"] == CATEGORIAS["Café"]  # la memoria reconoce el comercio aunque venga con S.A.S.


def test_errores_definitivos(db, extractor):
    p = procesador(db, extractor, None)
    with pytest.raises(PermanentError):
        p.process(Job(id="j", payload={}))
    with pytest.raises(PermanentError):
        p.process(Job(id="j", payload={"message_id": "no-existe"}))
    mid = db.add_message("photo", file="recibo_tienda.jpg")
    db.files.clear()
    with pytest.raises(PermanentError):
        p.process(Job(id="j", payload={"message_id": mid}))


def test_mensaje_ya_procesado_no_se_repite(db, extractor):
    mid = db.add_message("text", text="hielo 12 lucas")
    db.messages[mid]["status"] = "done"
    assert procesador(db, extractor, None).process(Job(id="j", payload={"message_id": mid})) == "ya estaba procesado"


def test_un_mensaje_con_varias_cosas_suma_todo_y_trae_los_items(db, extractor):
    mid = db.add_message(
        "text",
        text="5 k bloqueador \n4.5 k de cerveza \n\n980 de tours \n\nTodo es viaje de amazonas",
        sender="valeria",
    )
    # El LLM se queda con el primer monto: ganan las reglas y queda por revisar
    llm = FakeLlm(
        lambda _p: respuesta(merchant="Bloqueador", total_cop=5_000, description_en="Sunscreen and beer on a trip")
    )
    procesador(db, extractor, llm).process(Job(id="j", payload={"message_id": mid}))
    g = gasto(db, mid)
    assert (g["merchant"], g["total_cop"], g["status"]) == ("Viaje de amazonas", 989_500, "pending_review")
    assert [(i["name"], i["total_cop"]) for i in g["items"]] == [
        ("Bloqueador", 5_000),
        ("Cerveza", 4_500),
        ("Tours", 980_000),
    ]
    assert "Se sumaron 3 montos del mensaje" in g["ai_snapshot"]["notes"]


def test_el_pantallazo_de_un_pago_a_alguien_de_la_cuenta_no_es_un_gasto(db, extractor, monkeypatch):
    """Javi manda el comprobante de Nu con «ya pagué mi amor ❤️»: queda pagado, no es un gasto (migración 510)."""
    from lucas_worker.extract.cascade import Extraction
    from lucas_worker.extract.rules import analyze_document

    from .test_envios import NU_BRE_B

    def leido(img, image_hash, caption, today):
        return Extraction(
            kind="photo", method="photo_ocr", text=NU_BRE_B, quality=0.97, hints=analyze_document(NU_BRE_B, today)
        )

    monkeypatch.setattr(extractor, "photo", leido)
    llm = FakeLlm(qwen_honesto)
    p = procesador(db, extractor, llm)

    db.pago = {"handled": True, "tipo": "pagada"}
    mid = db.add_message(
        "photo", file="recibo_panaderia_foto.jpg", text="@MrLuks ya pagué mi amor ❤️", source="whatsapp"
    )
    assert p.process(Job(id="j1", payload={"message_id": mid})) == "pago entre ellos (pagada)"
    assert db.pagos == [{"message_id": mid, "monto": 48_750, "para": ["chr", "rey", "mor", "lop"]}]
    assert db.messages[mid]["status"] == "not_expense"
    assert not [e for e in db.expenses if e["message_id"] == mid]

    # A alguien que no es de la cuenta (la base dice que no): es un gasto como siempre
    db.pago = {"handled": False}
    otro = db.add_message("photo", file="recibo_panaderia_foto.jpg", source="whatsapp")
    assert "pago entre ellos" not in p.process(Job(id="j2", payload={"message_id": otro}))
