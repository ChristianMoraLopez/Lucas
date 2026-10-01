"""Memoria de comercios de la cuenta con RapidFuzz.

Cada vez que alguien confirma un gasto, `review_expense` guarda comercio →
categoría. Aquí se busca el comercio leído en esa memoria: igual (tras
normalizar y quitar «S.A.S.») o casi igual, para aguantar errores de OCR
(«PANADERIA LA ESP1GA») sin confundir «Tienda» con «Tienda Don Beto».
"""

from __future__ import annotations

from dataclasses import dataclass

from rapidfuzz import fuzz, process

from ..extract.numbers import merchant_key

# Desde qué parecido (0–100) se acepta un comercio de la memoria
MIN_SCORE = 88.0


@dataclass(frozen=True)
class MemoryEntry:
    id: str
    merchant_text: str
    normalized: str
    category_id: str
    hits: int = 0


@dataclass(frozen=True)
class MemoryMatch:
    entry: MemoryEntry
    score: float  # 0–100
    exact: bool

    @property
    def confidence(self) -> float:
        """Exacto 0,96 (como el procesador simulado); parecido entre 0,84 y 0,93."""
        if self.exact:
            return 0.96
        return round(0.84 + (self.score - MIN_SCORE) / (100 - MIN_SCORE) * 0.09, 2)


def _parecido(a: str, b: str, **_: object) -> float:
    # ratio aguanta errores de letras; token_sort, palabras en otro orden. No se usa
    # partial_ratio: daría 100 entre «tienda» y «tienda don beto».
    return max(fuzz.ratio(a, b), fuzz.token_sort_ratio(a, b))


def match_memory(merchant: str | None, entries: list[MemoryEntry], min_score: float = MIN_SCORE) -> MemoryMatch | None:
    clave = merchant_key(merchant)
    if not clave or not entries:
        return None
    claves: dict[int, str] = {}
    for i, e in enumerate(entries):
        k = merchant_key(e.normalized) or merchant_key(e.merchant_text)
        if k:
            claves[i] = k

    exactos = [entries[i] for i, k in claves.items() if k == clave]
    if exactos:
        return MemoryMatch(max(exactos, key=lambda e: e.hits), 100.0, True)

    if len(clave) < 5:
        return None  # con tan pocas letras un parecido no dice nada
    candidatos = process.extract(clave, claves, scorer=_parecido, score_cutoff=min_score, limit=5)
    if not candidatos:
        return None
    # Entre los más parecidos, el que más se ha usado
    _, mejor_score, _ = max(candidatos, key=lambda c: c[1])
    empatados = [c for c in candidatos if c[1] >= mejor_score - 1]
    elegido = max(empatados, key=lambda c: entries[c[2]].hits)
    return MemoryMatch(entries[elegido[2]], float(elegido[1]), False)
