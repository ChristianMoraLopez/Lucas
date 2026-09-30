"""La cascada de clasificación.

1. Memoria de comercios de la cuenta (lo que las personas ya confirmaron).
2. Laya (la variante configurada), si está cargado.
3. Palabras clave del mensaje o del recibo.
4. «Otros», con confianza baja: que lo decida una persona.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from .categories import BY_NAME, OTHER, keyword_category
from .laya import CategoryModel
from .memory import MemoryEntry, match_memory
from .question import ClassifyInput

log = logging.getLogger(__name__)


@dataclass
class Category:
    id: str
    name: str


@dataclass
class CategoryDecision:
    category_id: str | None
    category_name: str | None
    confidence: float
    source: str  # memory | laya | keywords | default
    memory_id: str | None = None
    memory_score: float | None = None
    probabilities: dict[str, float] = field(default_factory=dict)
    model: str | None = None


class CategoryClassifier:
    def __init__(self, model: CategoryModel | None):
        self.model = model

    def classify(
        self,
        inp: ClassifyInput,
        categories: list[Category],
        memory: list[MemoryEntry],
        keyword_text: str | None = None,
    ) -> CategoryDecision:
        por_id = {c.id: c for c in categories}
        por_nombre = {c.name: c for c in categories}

        # 1. Memoria
        if (m := match_memory(inp.merchant, memory)) and m.entry.category_id in por_id:
            cat = por_id[m.entry.category_id]
            return CategoryDecision(cat.id, cat.name, m.confidence, "memory", m.entry.id, m.score)

        # 2. Laya
        if self.model is not None:
            permitidas = [n for n in por_nombre if n in BY_NAME]
            try:
                pred = self.model.predict(inp, permitidas)
            except Exception as e:  # un fallo de Laya no tumba el gasto
                log.warning("Laya falló al clasificar: %s", type(e).__name__, exc_info=True)
                pred = None
            if pred and pred.category in por_nombre:
                cat = por_nombre[pred.category]
                return CategoryDecision(
                    cat.id, cat.name, pred.confidence, "laya", probabilities=pred.probabilities, model=pred.model
                )

        # 3. Palabras clave
        for texto in (inp.merchant, keyword_text, inp.message_text, " ".join(inp.items)):
            if (nombre := keyword_category(texto)) and nombre in por_nombre:
                cat = por_nombre[nombre]
                return CategoryDecision(cat.id, cat.name, 0.7, "keywords")

        # 4. Otros
        cat = por_nombre.get(OTHER)
        return CategoryDecision(cat.id if cat else None, cat.name if cat else None, 0.45, "default")
