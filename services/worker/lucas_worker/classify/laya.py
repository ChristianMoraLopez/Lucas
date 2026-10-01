"""Laya sobre ONNX Runtime, detrás de una interfaz con dos variantes.

`CategoryModel` es lo único que ve el resto del worker. `LayaOnnx` es la
implementación: carga la carpeta de una variante (la que publica el notebook
de ajuste) y responde la pregunta de categoría con probabilidades calibradas.

    <carpeta de la variante>/
      laya.int8.onnx         grafo exportado (INT8 para CPU; también sirve laya.onnx)
      rl_agent_config.json   max_len, head_max_len y temperaturas de calibración
      tokenizer/             tokenizer.json + tokenizer_config.json
      lucas_question.json    (opcional) la pregunta con la que se ajustó

Cambiar de variante es cambiar LAYA_VARIANT (multilingual | english): cada una
arma su propio «state» (question.py) y baja su propia carpeta.
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from ..config import LayaVariant, Settings
from . import laya_format as lf
from .question import QUESTION_ID, ClassifyInput, LayaQuestion, build_state, load_question

log = logging.getLogger(__name__)


@dataclass
class CategoryPrediction:
    category: str  # nombre de la categoría en la base
    confidence: float  # answer_confidence calibrada (con techo si el modelo no está ajustado)
    probabilities: dict[str, float]
    model: str


class CategoryModel(Protocol):
    """La interfaz: cualquier clasificador de categorías (Laya en sus variantes, o un doble en pruebas)."""

    name: str

    def predict(self, inp: ClassifyInput, allowed_categories: list[str]) -> CategoryPrediction | None: ...


class LayaUnavailable(Exception):
    pass


# ---------------------------------------------------------------------------
# Tokenizador: `tokenizers` con la cara que build_sequence espera de transformers
# ---------------------------------------------------------------------------


def _token(config: dict[str, Any], *names: str) -> str | None:
    for name in names:
        v = config.get(name)
        if isinstance(v, dict):
            v = v.get("content")
        if isinstance(v, str) and v:
            return v
    return None


class HfLikeTokenizer:
    def __init__(self, tokenizer_dir: Path):
        from tokenizers import Tokenizer

        self._tok = Tokenizer.from_file(str(tokenizer_dir / "tokenizer.json"))
        self._tok.no_truncation()
        self._tok.no_padding()
        config: dict[str, Any] = {}
        for nombre in ("special_tokens_map.json", "tokenizer_config.json"):
            if (tokenizer_dir / nombre).exists():
                config = {**json.loads((tokenizer_dir / nombre).read_text(encoding="utf-8")), **config}

        self.mask_token = _token(config, "mask_token") or "[MASK]"
        self.cls_token = _token(config, "cls_token", "bos_token") or "[CLS]"
        self.sep_token = _token(config, "sep_token", "eos_token") or "[SEP]"
        self.pad_token = _token(config, "pad_token") or "[PAD]"
        ids = {n: self._tok.token_to_id(getattr(self, f"{n}_token")) for n in ("mask", "cls", "sep", "pad")}
        faltan = [n for n, v in ids.items() if v is None]
        if faltan:
            raise LayaUnavailable(f"El tokenizador no tiene los tokens especiales: {', '.join(faltan)}")
        self.mask_token_id: int = ids["mask"]  # type: ignore[assignment]
        self.cls_token_id: int = ids["cls"]  # type: ignore[assignment]
        self.sep_token_id: int = ids["sep"]  # type: ignore[assignment]
        self.pad_token_id: int = ids["pad"]  # type: ignore[assignment]
        self._lock = threading.Lock()

    def __call__(
        self, text: str, add_special_tokens: bool = True, truncation: bool = False, max_length: int | None = None
    ) -> dict[str, list[int]]:
        with self._lock:
            ids = self._tok.encode(text, add_special_tokens=add_special_tokens).ids
        if truncation and max_length is not None:
            ids = ids[:max_length]
        return {"input_ids": list(ids)}


# ---------------------------------------------------------------------------
# El modelo
# ---------------------------------------------------------------------------


class LayaOnnx:
    def __init__(
        self,
        model_dir: Path,
        variant: LayaVariant,
        *,
        onnx_file: str = "laya.int8.onnx",
        threads: int = 0,
        zero_shot_max_confidence: float = 0.8,
    ):
        import onnxruntime as ort

        self.variant = variant
        self.model_dir = model_dir
        self.name = f"laya-{variant}"
        cfg_path = model_dir / "rl_agent_config.json"
        if not cfg_path.exists():
            raise LayaUnavailable(f"No está {cfg_path}")
        self.cfg: dict[str, Any] = json.loads(cfg_path.read_text(encoding="utf-8"))
        onnx_path = model_dir / onnx_file
        if not onnx_path.exists():
            alterno = model_dir / ("laya.onnx" if onnx_file != "laya.onnx" else "laya.int8.onnx")
            if not alterno.exists():
                raise LayaUnavailable(f"No está el modelo ONNX en {model_dir}")
            onnx_path = alterno

        self.tok = HfLikeTokenizer(model_dir / "tokenizer")
        self.question: LayaQuestion = load_question(variant, model_dir)
        # Lo marca el notebook al guardar un modelo ajustado; el export zero-shot no lo trae
        self.fine_tuned = bool(self.cfg.get("fine_tuned"))
        self.max_confidence = 1.0 if self.fine_tuned else zero_shot_max_confidence
        self.max_len = int(self.cfg.get("max_len", 512))
        self.head_max_len = int(self.cfg.get("head_max_len", 192))
        self.temperature = [lf.clamp_temperature(t) for t in self.cfg.get("temperature", [1.0, 1.0, 1.0])]
        self.temperature_by_options = {
            k: lf.clamp_temperature(v) for k, v in (self.cfg.get("temperature_by_options") or {}).items()
        }

        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        if threads > 0:
            so.intra_op_num_threads = threads
        self.session = ort.InferenceSession(str(onnx_path), sess_options=so, providers=["CPUExecutionProvider"])
        self.onnx_path = onnx_path
        log.info(
            "Laya cargado",
            extra={"detail": f"{self.name} {onnx_path.name} {'ajustado' if self.fine_tuned else 'zero-shot'}"},
        )

    def encode(self, state: dict[str, Any] | str, question: dict[str, Any]) -> dict[str, Any]:
        q = lf.to_internal(question)
        ids, markers = lf.build_sequence(
            self.tok, state, q, self.max_len, self.head_max_len, option_order=q.get("option_order")
        )
        k = len(lf.render_options(q))
        if len(markers) != k:
            raise ValueError(f"Solo {len(markers)} de {k} opciones caben en max_len={self.max_len}")
        return {"ids": ids, "markers": markers, "qtype": lf.QTYPES[q["t"]], "q": q}

    def probabilities(self, state: dict[str, Any] | str, question: dict[str, Any]) -> tuple[list[str], np.ndarray]:
        item = self.encode(state, question)
        inputs = lf.collate([item], self.tok.pad_token_id)
        logits = self.session.run(["logits"], inputs)[0]
        k = len(item["markers"])
        t = self.temperature_by_options.get(lf.temp_bucket(item["qtype"], k), self.temperature[item["qtype"]])
        z = logits[0, :k].astype(np.float64) / t
        p = np.exp(z - z.max())
        p = p / p.sum()
        p = lf.unpermute_probs(p, item["q"].get("option_order"))
        return list(item["q"]["crit"].keys()), p

    def predict(self, inp: ClassifyInput, allowed_categories: list[str]) -> CategoryPrediction | None:
        pregunta = self.question.restricted_to(allowed_categories)
        if len(pregunta.definition["criteria"]) < 2:
            return None
        state = build_state(self.variant, inp)
        if not state:
            return None
        etiquetas, p = self.probabilities(state, pregunta.definition)
        mejor = int(np.argmax(p))
        conf = min(lf.answer_confidence(p, len(etiquetas)), self.max_confidence)
        return CategoryPrediction(
            category=pregunta.label_to_category[etiquetas[mejor]],
            confidence=round(conf, 3),
            probabilities={
                pregunta.label_to_category[e]: round(float(v), 4) for e, v in zip(etiquetas, p, strict=True)
            },
            model=self.name,
        )


# ---------------------------------------------------------------------------
# De dónde sale la carpeta del modelo
# ---------------------------------------------------------------------------


def resolve_model_dir(settings: Settings) -> Path | None:
    """LAYA_MODEL_DIR si existe; si no, baja `<variante>/` de HF_REPO a LAYA_CACHE_DIR."""
    variante = str(settings.laya_variant)
    if settings.laya_model_dir:
        d = settings.laya_model_dir
        for candidata in (d / variante, d):
            if (candidata / "rl_agent_config.json").exists():
                return candidata
        raise LayaUnavailable(f"LAYA_MODEL_DIR={d} no tiene la variante {variante}")
    if not settings.hf_repo:
        return None
    from huggingface_hub import snapshot_download

    token = settings.hf_token.get_secret_value() if settings.hf_token else None
    carpeta = snapshot_download(
        repo_id=settings.hf_repo,
        allow_patterns=[
            f"{variante}/{settings.laya_onnx_file}",
            f"{variante}/rl_agent_config.json",
            f"{variante}/lucas_question.json",
            f"{variante}/tokenizer/*",
        ],
        local_dir=settings.laya_cache_dir,
        token=token,
    )
    d = Path(carpeta) / variante
    if not (d / "rl_agent_config.json").exists():
        raise LayaUnavailable(f"{settings.hf_repo} no tiene la carpeta {variante}/ (corre el notebook de ajuste)")
    return d


def load_laya(settings: Settings) -> CategoryModel | None:
    """Laya listo, o None (y el worker clasifica con memoria y palabras clave)."""
    if not settings.laya_enabled:
        return None
    try:
        d = resolve_model_dir(settings)
        if d is None:
            log.warning("Laya sin configurar (LAYA_MODEL_DIR o HF_REPO): se clasifica con memoria y palabras clave")
            return None
        return LayaOnnx(
            d,
            settings.laya_variant,
            onnx_file=settings.laya_onnx_file,
            threads=settings.laya_threads,
            zero_shot_max_confidence=settings.laya_zero_shot_max_confidence,
        )
    except Exception as e:  # sin Laya el worker sigue funcionando
        log.warning("No se pudo cargar Laya: %s", e, extra={"detail": type(e).__name__})
        return None


__all__ = ["QUESTION_ID", "CategoryModel", "CategoryPrediction", "LayaOnnx", "LayaUnavailable", "load_laya"]
