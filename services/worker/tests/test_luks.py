"""Lo que hace Luks (las cuentas, un cobro, sus respuestas, la imagen del link) no es un gasto."""

from __future__ import annotations

import pytest

from lucas_worker.luks import es_imagen_de_luks, es_mensaje_de_luks
from lucas_worker.pipeline import Job

from .conftest import FakeDb, FakeLlm
from .test_pipeline import procesador, qwen_honesto

CUENTAS = (
    "🧾 *Paseo Santa Marta*\nGastamos *$4.816.000* (4,8 palos) entre 8: *$602.000* cada uno.\n\n"
    "💸 *Quién le paga a quién*\n• Santi → Valeria: *$280.000*\n\n"
    "👀 Cuánto puso cada uno y en qué se fue la plata:\nhttps://mrluks.com/r/76B5n5hlRzSyAs39_Yl50w\n\n"
    "_Esto se hizo en mrluks.com_"
)


@pytest.mark.parametrize(
    "texto",
    [
        CUENTAS,
        "Hola Mafe 👋 me debes $45.000 (45 lucas).\n\nCuentas hechas con Luks · mrluks.com",
        "miren 50 lucas https://lucas-tau-black.vercel.app/r/76B5n5hlRzSyAs39_Yl50w",
        "Anotado: Asadero · $272.500 · pagó Felipe.",
        "Anotados 2:\n• Hielo · $8.000\n• Ron · $116.000",
        "Recibido: Taxi · $45.000. Queda por revisar en Luks.",
    ],
)
def test_reconoce_lo_que_hizo_luks(texto: str) -> None:
    assert es_mensaje_de_luks(texto)


@pytest.mark.parametrize(
    "texto",
    ["taxi al aeropuerto 45 lucas", "Recibido el pago de 50.000, gracias", "pagué 120.000 · el hotel", None, ""],
)
def test_lo_demas_no(texto: str | None) -> None:
    assert not es_mensaje_de_luks(texto)


def test_la_imagen_aunque_el_ocr_lea_a_medias() -> None:
    assert es_imagen_de_luks("luks EVENTO Paseo Gastaron $4.816.000 Esto se hizo en mr luks.com")
    assert not es_imagen_de_luks("TIENDA DON BETO Leche x2 9.800 TOTAL 45.600")


def test_las_cuentas_que_llegan_al_grupo_no_son_un_gasto(db: FakeDb, extractor) -> None:
    mid = db.add_message("text", text=CUENTAS, source="whatsapp")
    llm = FakeLlm(qwen_honesto)
    assert (
        procesador(db, extractor, llm).process(Job(id="j", payload={"message_id": mid}))
        == "lo hizo Luks: no es un gasto"
    )
    assert db.messages[mid]["status"] == "not_expense" and db.expenses == []
    assert llm.calls == []  # ni siquiera se le pregunta al LLM


def test_la_imagen_de_las_cuentas_tampoco(db: FakeDb, extractor) -> None:
    # La vista previa del link /r/TOKEN (apps/web/lib/imagen-cuentas.tsx), con OCR de verdad
    mid = db.add_message("photo", file="cuentas_luks.png", source="whatsapp")
    resultado = procesador(db, extractor, FakeLlm(qwen_honesto)).process(Job(id="j", payload={"message_id": mid}))
    assert resultado == "lo hizo Luks: no es un gasto"
    assert db.messages[mid]["status"] == "not_expense" and db.expenses == []
