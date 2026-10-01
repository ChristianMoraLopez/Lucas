"""La pregunta que se le hace a Laya y el «state» que lee, por variante.

Esto lo usan igual el worker (al clasificar) y scripts/export_training.py (al
armar los ejemplos de entrenamiento): si el formato cambia en un lado y no en
el otro, el modelo ajustado lee algo distinto de lo que aprendió. Un modelo
ajustado puede traer su propia pregunta en `lucas_question.json`; si la trae,
esa manda.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..config import LayaVariant
from .categories import BY_NAME, CATEGORIES

QUESTION_ID = "category"

INSTRUCTIONS = {
    LayaVariant.ENGLISH: "Which spending category does this Colombian expense belong to?",
    LayaVariant.MULTILINGUAL: "¿En qué categoría de gasto va esta compra hecha en Colombia?",
}


@dataclass
class ClassifyInput:
    merchant: str | None = None
    description_en: str | None = None
    message_text: str | None = None
    items: list[str] = field(default_factory=list)
    document_text: str | None = None


@dataclass
class LayaQuestion:
    definition: dict[str, Any]  # {"type": "choice", "instructions": …, "criteria": {etiqueta: descripción}}
    label_to_category: dict[str, str]  # etiqueta de Laya → nombre de la categoría en la base

    def restricted_to(self, categories: Iterable[str]) -> LayaQuestion:
        """Solo las opciones que la cuenta tiene."""
        permitidas = set(categories)
        crit = {k: v for k, v in self.definition["criteria"].items() if self.label_to_category.get(k) in permitidas}
        return LayaQuestion(
            {**self.definition, "criteria": crit},
            {k: v for k, v in self.label_to_category.items() if k in crit},
        )


def default_question(variant: LayaVariant) -> LayaQuestion:
    if variant == LayaVariant.ENGLISH:
        criteria = {c.label_en: c.desc_en for c in CATEGORIES}
        labels = {c.label_en: c.name for c in CATEGORIES}
    else:
        criteria = {c.name: c.desc_es for c in CATEGORIES}
        labels = {c.name: c.name for c in CATEGORIES}
    return LayaQuestion({"type": "choice", "instructions": INSTRUCTIONS[variant], "criteria": criteria}, labels)


def load_question(variant: LayaVariant, model_dir: Path | None) -> LayaQuestion:
    """La pregunta con la que se entrenó el modelo (lucas_question.json) o la de siempre."""
    if model_dir and (archivo := model_dir / "lucas_question.json").exists():
        data = json.loads(archivo.read_text(encoding="utf-8"))
        labels = {k: v for k, v in data["label_to_category"].items() if v in BY_NAME}
        return LayaQuestion(data["question"], labels)
    return default_question(variant)


def _corto(texto: str | None, limite: int) -> str | None:
    if not texto:
        return None
    t = " ".join(texto.split())
    return t[:limite] or None


def build_state(variant: LayaVariant, inp: ClassifyInput) -> dict[str, Any]:
    """Lo que Laya lee. Laya serializa un dict como JSON (serialize_state)."""
    if variant == LayaVariant.ENGLISH:
        state = {
            "merchant": _corto(inp.merchant, 80),
            "description": _corto(inp.description_en, 160),
        }
    else:
        state = {
            "comercio": _corto(inp.merchant, 80),
            "mensaje": _corto(inp.message_text, 300),
            "items": [i for i in (_corto(x, 40) for x in inp.items[:10]) if i] or None,
            "texto": _corto(inp.document_text, 600),
        }
    return {k: v for k, v in state.items() if v}
