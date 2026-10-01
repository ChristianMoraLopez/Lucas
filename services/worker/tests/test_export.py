"""El export de entrenamiento produce filas que Laya (y el notebook) entienden."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import export_training as ex

from lucas_worker.classify import laya_format as lf
from lucas_worker.config import LayaVariant

EJEMPLOS = [
    {
        "id": "te:1",
        "training_id": "1",
        "source": "correction",
        "category": "Mercado",
        "merchant": "Tienda Doña Rosa",
        "description": "Corner store: water and snacks",
        "message_text": "Tienda Doña Rosa 45 lucas, la pagó Santi, entre Vale y Caro. Cel 3001234567",
        "extracted_text": None,
        "items": ["Agua x6", "Papas"],
    },
    {
        "id": "ex:2",
        "training_id": None,
        "source": "confirmed",
        "category": "Café",
        "merchant": "Panadería La Espiga",
        "description": None,
        "message_text": None,
        "extracted_text": "PANADERIA LA ESPIGA\nNIT 900.123.456-7\nTOTAL 11.300",
        "items": [],
    },
    {"id": "ex:3", "category": "Mascotas", "merchant": "Veterinaria"},  # categoría propia de una cuenta
    {"id": "ex:4", "category": "Otros", "merchant": None, "description": None},
]


def test_filas_en_formato_typed_decisions():
    filas, saltados = ex.build_rows(EJEMPLOS, LayaVariant.MULTILINGUAL, smoothing=0.05)
    assert [f["id"] for f in filas] == ["te:1", "ex:2"]
    assert saltados == {"categoria propia: Mascotas": 1, "sin texto": 1}
    fila = filas[0]
    state, questions, gold = (json.loads(fila[k]) for k in ("state", "questions", "gold"))
    assert fila["workflow"] == "lucas-categoria"
    assert questions["category"]["type"] == "choice" and "Mercado" in questions["category"]["criteria"]
    assert gold["category"]["label"] == "Mercado"
    assert abs(sum(gold["category"]["probabilities"].values()) - 1) < 1e-6
    assert gold["category"]["probabilities"]["Mercado"] == 0.95
    assert state["comercio"] == "Tienda Doña Rosa" and state["items"] == ["Agua x6", "Papas"]


def test_sin_nombres_ni_numeros_que_identifiquen():
    filas, _ = ex.build_rows(EJEMPLOS, LayaVariant.MULTILINGUAL)
    texto = filas[0]["state"] + filas[1]["state"]
    for dato in ("Santi", "Vale", "Caro", "3001234567", "900.123.456"):
        assert dato not in texto
    assert "45 lucas" in texto


def test_variante_inglesa_usa_etiquetas_y_descripcion_en_ingles():
    filas, _ = ex.build_rows(EJEMPLOS[:1], LayaVariant.ENGLISH)
    assert json.loads(filas[0]["gold"])["category"]["label"] == "groceries"
    assert json.loads(filas[0]["state"]) == {
        "merchant": "Tienda Doña Rosa",
        "description": "Corner store: water and snacks",
    }


def test_el_notebook_puede_leer_cada_fila_como_el_oficial():
    """Lo mismo que hace build_training_item del notebook: pregunta interna + opciones = etiquetas del gold."""
    filas, _ = ex.build_rows(EJEMPLOS, LayaVariant.MULTILINGUAL)
    for f in filas:
        q = json.loads(f["questions"])["category"]
        interna = {"t": q["type"], "ins": q["instructions"], "crit": q["criteria"]}
        opciones = lf.render_options(interna)
        probs = json.loads(f["gold"])["category"]["probabilities"]
        assert len(opciones) == len(probs) == 8
        assert list(q["criteria"]) == list(probs)


def test_archivos_y_particion_estable(tmp_path):
    filas, saltados = ex.build_rows(EJEMPLOS, LayaVariant.MULTILINGUAL)
    stats = ex.write_variant(filas, saltados, LayaVariant.MULTILINGUAL, tmp_path, test_pct=0.5)
    d = tmp_path / "multilingual"
    assert {p.name for p in d.iterdir()} == {"train.jsonl", "test.jsonl", "lucas_question.json", "stats.json"}
    assert stats["train"] + stats["test"] == 2
    pregunta = json.loads((d / "lucas_question.json").read_text())
    assert pregunta["label_to_category"]["Café"] == "Café"
    assert ex.is_test("te:1", 0.5) == ex.is_test("te:1", 0.5)


def test_desde_json_sin_supabase(tmp_path):
    archivo = tmp_path / "ejemplos.json"
    archivo.write_text(json.dumps(EJEMPLOS))
    assert ex.main(["--desde-json", str(archivo), "--salida", str(tmp_path / "out"), "--variante", "ambas"]) == 0
    assert (tmp_path / "out" / "english" / "train.jsonl").exists()
    assert (tmp_path / "out.zip").exists()
