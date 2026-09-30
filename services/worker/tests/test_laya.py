"""Laya sobre ONNX Runtime con un modelo de juguete.

El modelo real (cientos de MB) no está en las pruebas. Este grafo ONNX tiene
las mismas entradas y salidas que el exportado por laya (input_ids,
attention_mask, marker_pos, marker_mask, qtype → logits, act_logits): su logit
para cada opción es el id del primer token de la opción. Así se prueba toda la
tubería (tokenizar, armar la secuencia, marcadores, temperatura, etiquetas) con
un resultado predecible.
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import numpy as np
import pytest

from lucas_worker.classify import laya_format as lf
from lucas_worker.classify.categories import CATEGORIES
from lucas_worker.classify.classifier import Category, CategoryClassifier
from lucas_worker.classify.laya import HfLikeTokenizer, LayaOnnx, LayaUnavailable, load_laya
from lucas_worker.classify.question import ClassifyInput, build_state, default_question
from lucas_worker.config import LayaVariant

from .conftest import make_settings

onnx = pytest.importorskip("onnx")


def _grafo(ruta: Path) -> None:
    from onnx import TensorProto, helper

    entradas = [
        helper.make_tensor_value_info("input_ids", TensorProto.INT64, ["b", "l"]),
        helper.make_tensor_value_info("attention_mask", TensorProto.INT64, ["b", "l"]),
        helper.make_tensor_value_info("marker_pos", TensorProto.INT64, ["b", "k"]),
        helper.make_tensor_value_info("marker_mask", TensorProto.BOOL, ["b", "k"]),
        helper.make_tensor_value_info("qtype", TensorProto.INT64, ["b"]),
    ]
    salidas = [
        helper.make_tensor_value_info("logits", TensorProto.FLOAT, ["b", "k"]),
        helper.make_tensor_value_info("act_logits", TensorProto.FLOAT, ["b", 2]),
    ]
    nodos = [
        helper.make_node("Constant", [], ["uno"], value=helper.make_tensor("uno", TensorProto.INT64, [], [1])),
        helper.make_node("Add", ["marker_pos", "uno"], ["siguiente"]),
        helper.make_node("GatherElements", ["input_ids", "siguiente"], ["tokens"], axis=1),
        helper.make_node("Cast", ["tokens"], ["tokens_f"], to=TensorProto.FLOAT),
        helper.make_node("Constant", [], ["menos"], value=helper.make_tensor("menos", TensorProto.FLOAT, [], [-1e4])),
        helper.make_node("Where", ["marker_mask", "tokens_f", "menos"], ["logits"]),
        helper.make_node("Constant", [], ["ini"], value=helper.make_tensor("ini", TensorProto.INT64, [1], [0])),
        helper.make_node("Constant", [], ["fin"], value=helper.make_tensor("fin", TensorProto.INT64, [1], [2])),
        helper.make_node("Constant", [], ["eje"], value=helper.make_tensor("eje", TensorProto.INT64, [1], [1])),
        helper.make_node("Slice", ["logits", "ini", "fin", "eje"], ["act_logits"]),
    ]
    modelo = helper.make_model(
        helper.make_graph(nodos, "laya-juguete", entradas, salidas), opset_imports=[helper.make_opsetid("", 17)]
    )
    modelo.ir_version = 8
    onnx.checker.check_model(modelo)
    onnx.save(modelo, ruta)


def _tokenizador(carpeta: Path, orden: list[str]) -> None:
    """WordLevel: los nombres de categoría en `orden` tienen ids crecientes (el último gana)."""
    from tokenizers import Tokenizer, models, pre_tokenizers

    vocab = {"[PAD]": 0, "[CLS]": 1, "[SEP]": 2, "[MASK]": 3, "[UNK]": 4}
    for palabra in orden:
        vocab[palabra] = len(vocab)
    tok = Tokenizer(models.WordLevel(vocab=vocab, unk_token="[UNK]"))
    tok.pre_tokenizer = pre_tokenizers.Whitespace()
    carpeta.mkdir(parents=True, exist_ok=True)
    tok.save(str(carpeta / "tokenizer.json"))
    (carpeta / "tokenizer_config.json").write_text(
        json.dumps({"cls_token": "[CLS]", "sep_token": "[SEP]", "mask_token": "[MASK]", "pad_token": "[PAD]"})
    )


@pytest.fixture
def carpeta_laya(tmp_path: Path) -> Path:
    d = tmp_path / "multilingual"
    d.mkdir()
    _grafo(d / "laya.int8.onnx")
    # Transporte al final: tiene el id más alto y gana, salvo que no esté permitido
    _tokenizador(
        d / "tokenizer", ["Café", "Licor", "Mercado", "Hospedaje", "Restaurante", "Servicios", "Otros", "Transporte"]
    )
    (d / "rl_agent_config.json").write_text(
        json.dumps({"max_len": 256, "head_max_len": 160, "temperature": [2.0, 1, 1]})
    )
    return d


def test_secuencia_con_el_formato_de_laya(carpeta_laya):
    tok = HfLikeTokenizer(carpeta_laya / "tokenizer")
    q = lf.to_internal({"type": "choice", "instructions": "cual", "criteria": {"Café": None, "Licor": None}})
    ids, markers = lf.build_sequence(tok, "Café", q, 64, 32)
    # [CLS] choice question : cual [SEP] [MASK] Café [MASK] Licor [SEP] Café [SEP]
    assert ids[0] == tok.cls_token_id and ids[-1] == tok.sep_token_id
    assert [ids[m] for m in markers] == [tok.mask_token_id, tok.mask_token_id]
    assert [ids[m + 1] for m in markers] == [tok("Café")["input_ids"][0], tok("Licor")["input_ids"][0]]


def test_predice_y_devuelve_la_categoria_de_la_base(carpeta_laya):
    laya = LayaOnnx(carpeta_laya, LayaVariant.MULTILINGUAL, zero_shot_max_confidence=0.8)
    todas = [c.name for c in CATEGORIES]
    pred = laya.predict(ClassifyInput(merchant="Taxis al aeropuerto"), todas)
    assert pred.category == "Transporte"
    assert pred.model == "laya-multilingual"
    assert abs(sum(pred.probabilities.values()) - 1) < 1e-3
    assert pred.confidence <= 0.8  # sin ajustar: con techo
    # La temperatura del config (2.0) suaviza: el segundo tiene probabilidad visible
    assert sorted(pred.probabilities.values())[-2] > 0.1


def test_solo_elige_entre_las_categorias_de_la_cuenta(carpeta_laya):
    laya = LayaOnnx(carpeta_laya, LayaVariant.MULTILINGUAL)
    pred = laya.predict(ClassifyInput(merchant="x"), ["Café", "Mercado", "Otros"])
    assert pred.category == "Otros"
    assert set(pred.probabilities) == {"Café", "Mercado", "Otros"}


def test_modelo_ajustado_trae_su_pregunta_y_sin_techo(carpeta_laya):
    pregunta = {
        "question": {"type": "choice", "instructions": "cual", "criteria": {"Mercado": "tiendas", "Otros": "resto"}},
        "label_to_category": {"Mercado": "Mercado", "Otros": "Otros"},
    }
    (carpeta_laya / "lucas_question.json").write_text(json.dumps(pregunta))
    cfg = json.loads((carpeta_laya / "rl_agent_config.json").read_text())
    (carpeta_laya / "rl_agent_config.json").write_text(json.dumps({**cfg, "fine_tuned": True}))
    laya = LayaOnnx(carpeta_laya, LayaVariant.MULTILINGUAL, zero_shot_max_confidence=0.5)
    pred = laya.predict(ClassifyInput(merchant="x"), [c.name for c in CATEGORIES])
    assert set(pred.probabilities) == {"Mercado", "Otros"}
    assert laya.fine_tuned and pred.confidence > 0.5


def test_variante_inglesa_lee_la_descripcion():
    q = default_question(LayaVariant.ENGLISH)
    assert q.label_to_category["groceries"] == "Mercado"
    estado = build_state(
        LayaVariant.ENGLISH, ClassifyInput(merchant="Tienda Don Beto", description_en="Groceries: eggs")
    )
    assert estado == {"merchant": "Tienda Don Beto", "description": "Groceries: eggs"}
    es = build_state(LayaVariant.MULTILINGUAL, ClassifyInput(merchant="Tienda", items=["Leche", ""], message_text=None))
    assert es == {"comercio": "Tienda", "items": ["Leche"]}


def test_carga_desde_carpeta_local_y_sin_modelo(carpeta_laya, tmp_path):
    ok = load_laya(make_settings(laya_enabled=True, laya_model_dir=carpeta_laya.parent))
    assert ok is not None and ok.name == "laya-multilingual"
    # Sin carpeta ni HF_REPO: None, y el worker sigue con memoria y palabras clave
    assert load_laya(make_settings(laya_enabled=True)) is None
    # Carpeta sin la variante pedida: None (con aviso), no una excepción
    assert load_laya(make_settings(laya_enabled=True, laya_model_dir=tmp_path / "nada")) is None
    with pytest.raises(LayaUnavailable):
        LayaOnnx(tmp_path, LayaVariant.ENGLISH)


def test_el_clasificador_usa_laya_cuando_no_hay_memoria(carpeta_laya):
    laya = LayaOnnx(carpeta_laya, LayaVariant.MULTILINGUAL)
    cats = [Category(f"id-{c.name}", c.name) for c in CATEGORIES]
    d = CategoryClassifier(laya).classify(ClassifyInput(merchant="Algo nuevo"), cats, [])
    assert (d.source, d.category_name, d.model) == ("laya", "Transporte", "laya-multilingual")


# ---------------------------------------------------------------------------
# Paridad con el paquete oficial (solo si `laya` está instalado)
# ---------------------------------------------------------------------------


def _torch_de_mentira() -> None:
    """laya.common importa torch arriba; para comparar el formato basta con nombres vacíos."""
    if "torch" in sys.modules:
        return
    try:
        import torch

        return
    except ImportError:
        pass
    torch = types.ModuleType("torch")
    nn = types.ModuleType("torch.nn")
    functional = types.ModuleType("torch.nn.functional")
    utils = types.ModuleType("torch.utils")
    checkpoint = types.ModuleType("torch.utils.checkpoint")
    nn.Module = type("Module", (), {})
    nn.MultiheadAttention = type("MultiheadAttention", (), {})
    checkpoint.checkpoint = lambda *a, **k: None
    torch.Tensor, torch.dtype = type("Tensor", (), {}), type("dtype", (), {})
    torch.nn, torch.utils, nn.functional, utils.checkpoint = nn, utils, functional, checkpoint
    sys.modules.update(
        {
            "torch": torch,
            "torch.nn": nn,
            "torch.nn.functional": functional,
            "torch.utils": utils,
            "torch.utils.checkpoint": checkpoint,
        }
    )


@pytest.mark.laya_real
def test_formato_igual_al_paquete_oficial(carpeta_laya):
    pytest.importorskip("laya")
    _torch_de_mentira()
    oficial = pytest.importorskip("laya.common")
    tok = HfLikeTokenizer(carpeta_laya / "tokenizer")
    q = default_question(LayaVariant.MULTILINGUAL).definition
    estado = {"comercio": "Tienda Don Beto", "items": ["Leche", "Huevos"]}
    interno = lf.to_internal(q)
    for max_len, head in ((512, 192), (64, 40)):
        assert lf.build_sequence(tok, estado, interno, max_len, head) == tuple(
            oficial.build_sequence(tok, estado, interno, max_len, head)
        )
    p = np.array([0.1, 0.7, 0.2])
    assert lf.answer_confidence(p, 3) == oficial.answer_confidence(p, 3)
    assert lf.temp_bucket(0, 8) == oficial.temp_bucket(0, 8)
