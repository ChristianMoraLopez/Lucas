"""La pregunta que se le hace a Laya y el «state» que lee, por variante.

Esto lo usan igual el worker (al clasificar) y scripts/export_training.py (al
armar los ejemplos de entrenamiento): si el formato cambia en un lado y no en
el otro, el modelo ajustado lee algo distinto de lo que aprendió. Un modelo
ajustado puede traer su propia pregunta en `lucas_question.json`; si la trae,
esa manda.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
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
    variant: LayaVariant = LayaVariant.MULTILINGUAL

    def restricted_to(self, categories: Iterable[str]) -> LayaQuestion:
        """Solo las opciones que la cuenta tiene."""
        return self.for_account(categories)

    def for_account(
        self, categories: Iterable[str], descriptions: Mapping[str, str | None] | None = None
    ) -> LayaQuestion:
        """Las opciones de una cuenta: las que la pregunta ya conoce y que la cuenta
        tiene, más las categorías propias de la cuenta («Salud», «Mascotas»…),
        descritas con lo que escribió quien las creó. Laya elige entre opciones
        descritas aunque nunca las haya visto: una categoría nueva entra desde el
        primer gasto, y con correcciones se aprende en el siguiente ajuste."""
        nombres = list(dict.fromkeys(categories))
        crit = {k: v for k, v in self.definition["criteria"].items() if self.label_to_category.get(k) in nombres}
        labels = {k: v for k, v in self.label_to_category.items() if k in crit}
        conocidas = set(self.label_to_category.values())
        # Las de siempre que la pregunta no conoce (un modelo ajustado antes de
        # que existieran Salud, Ocio…): con su etiqueta y descripción oficiales
        for nombre in (n for n in nombres if n in BY_NAME and n not in conocidas):
            c = BY_NAME[nombre]
            etiqueta = c.label_en if self.variant == LayaVariant.ENGLISH else c.name
            crit[etiqueta] = c.desc_en if self.variant == LayaVariant.ENGLISH else c.desc_es
            labels[etiqueta] = nombre
        for nombre in sorted(n for n in nombres if n not in BY_NAME and n not in conocidas):
            etiqueta = nombre if nombre not in crit else f"{nombre} (propia)"
            crit[etiqueta] = ((descriptions or {}).get(nombre) or "").strip() or nombre
            labels[etiqueta] = nombre
        return LayaQuestion({**self.definition, "criteria": crit}, labels, self.variant)


def default_question(variant: LayaVariant) -> LayaQuestion:
    if variant == LayaVariant.ENGLISH:
        criteria = {c.label_en: c.desc_en for c in CATEGORIES}
        labels = {c.label_en: c.name for c in CATEGORIES}
    else:
        criteria = {c.name: c.desc_es for c in CATEGORIES}
        labels = {c.name: c.name for c in CATEGORIES}
    definition = {"type": "choice", "instructions": INSTRUCTIONS[variant], "criteria": criteria}
    return LayaQuestion(definition, labels, variant)


def load_question(variant: LayaVariant, model_dir: Path | None) -> LayaQuestion:
    """La pregunta con la que se entrenó el modelo (lucas_question.json) o la de siempre."""
    if model_dir and (archivo := model_dir / "lucas_question.json").exists():
        data = json.loads(archivo.read_text(encoding="utf-8"))
        return LayaQuestion(data["question"], dict(data["label_to_category"]), variant)
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
