"""Quién pagó y entre quiénes se divide, según el texto del mensaje.

- «La lancha la pagó Santi», «Vale pagó el almuerzo», «pagado por Laura»,
  «invitó Juanca» → esa persona.
- «pagué», o nada → quien mandó el mensaje (o subió la foto).
- «entre Vale y Santi» → la división solo entre esas personas.
- «entre los 4», «entre todos» → nota para la revisión; se divide entre todas.

Los nombres se comparan con las personas de la cuenta: prefijo («Vale» →
Valeria, «Juanca» → Juan Camilo) o parecido con RapidFuzz («Santy» → Santi).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from rapidfuzz import fuzz

from .extract.numbers import normalize_merchant

NO_NOMBRES = {
    "con", "por", "para", "todo", "todos", "todas", "que", "las", "los", "quien", "yo", "el", "la", "lo", "de", "del",
    "cuenta", "mitad", "uno", "una", "cada", "ustedes", "nosotros", "ellos", "mi", "mis", "su", "sus", "nadie",
}  # fmt: skip

_PATRONES_PAGADOR = [
    re.compile(r"\b(?:pago|invito|puso|pusieron)\s+(?:el|la|los|las|lo)?\s*([a-z]{3,})"),
    re.compile(r"\b([a-z]{3,})\s+(?:pago|invito|puso)\b"),
    re.compile(r"\bpagad[oa]s?\s+por\s+([a-z]{3,})"),
]
_ENTRE_NUM = re.compile(r"\bentre\s+(?:los|las)\s+(\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b")
_ENTRE_TODOS = re.compile(r"\bentre\s+todos\b|\bentre\s+todas\b")
# Ya normalizado (sin comas): «entre vale santi y caro», «entre juan camilo y laura»
_ENTRE_NOMBRES = re.compile(r"\bentre\s+((?:[a-z]+\s+)+y\s+[a-z]+)")


@dataclass
class Person:
    id: str
    display_name: str


@dataclass
class PayerResult:
    person_id: str | None
    confidence: float
    source: str  # mensaje | llm | remitente | ninguno
    name: str | None = None


@dataclass
class SplitResult:
    person_ids: list[str] = field(default_factory=list)
    note: str | None = None


def match_person(token: str, people: list[Person]) -> tuple[Person, float] | None:
    """Una palabra del mensaje contra las personas de la cuenta. Devuelve (persona, 0–100)."""
    tok = normalize_merchant(token) or ""
    if len(tok) < 3 or tok in NO_NOMBRES:
        return None
    mejor: tuple[Person, float] | None = None
    for p in people:
        nombre = normalize_merchant(p.display_name) or ""
        pegado = nombre.replace(" ", "")
        primero = nombre.split(" ")[0] if nombre else ""
        if nombre.startswith(tok) or pegado.startswith(tok):
            score = 100.0 - (len(pegado) - len(tok)) * 0.1  # entre prefijos, el más completo
        else:
            score = max(fuzz.ratio(tok, primero), fuzz.ratio(tok, pegado)) if len(tok) >= 4 else 0.0
        if score >= 80 and (mejor is None or score > mejor[1]):
            mejor = (p, score)
    return mejor


def payer_from_text(text: str | None, people: list[Person]) -> tuple[Person, float] | None:
    t = normalize_merchant(text)
    if not t:
        return None
    for patron in _PATRONES_PAGADOR:
        for m in patron.finditer(t):
            if encontrado := match_person(m.group(1), people):
                return encontrado
    return None


def resolve_payer(
    text: str | None,
    people: list[Person],
    sender_person_id: str | None,
    llm_payer_name: str | None = None,
) -> PayerResult:
    if encontrado := payer_from_text(text, people):
        persona, score = encontrado
        return PayerResult(persona.id, 0.97 if score >= 99 else 0.9, "mensaje", persona.display_name)
    if llm_payer_name and (encontrado := match_person(llm_payer_name.split()[0], people)):
        persona, score = encontrado
        return PayerResult(persona.id, 0.85 if score >= 99 else 0.78, "llm", persona.display_name)
    if sender_person_id and any(p.id == sender_person_id for p in people):
        return PayerResult(sender_person_id, 0.97, "remitente")
    return PayerResult(None, 0.3, "ninguno")


def resolve_split(text: str | None, people: list[Person]) -> SplitResult:
    t = normalize_merchant(text)
    if not t:
        return SplitResult()
    if m := _ENTRE_NOMBRES.search(t):
        nota = f"Leído del mensaje: «{m.group(0).strip()}»"
        elegidas: list[Person] = []
        for palabra in m.group(1).split():
            if palabra == "y":
                continue
            if encontrado := match_person(palabra, people):
                if encontrado[0] not in elegidas:
                    elegidas.append(encontrado[0])
            elif not any(palabra in (normalize_merchant(p.display_name) or "").split() for p in elegidas):
                return SplitResult(note=nota)  # alguien que no está en la cuenta: se divide entre todos
        if len(elegidas) >= 2:
            return SplitResult([p.id for p in elegidas], nota)
        return SplitResult(note=nota)
    if m := _ENTRE_NUM.search(t):
        return SplitResult(note=f"Leído del mensaje: «{m.group(0)}»")
    if m := _ENTRE_TODOS.search(t):
        return SplitResult(note=f"Leído del mensaje: «{m.group(0)}»")
    return SplitResult()
