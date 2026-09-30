"""Validación y confianza por campo.

Se cruzan tres fuentes: el QR de la DIAN (casi seguro), las reglas (montos en
líneas de TOTAL, fechas escritas) y lo que respondió el LLM. Cuando coinciden,
la confianza sube; cuando el LLM dice algo que no aparece en el documento,
baja y el gasto va a revisión. Las claves son las que muestra la bandeja:
merchant, date, total, category, payer (Seguro ≥ 0,9 · Casi seguro ≥ 0,75 ·
Revísalo < 0,75).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from rapidfuzz import fuzz

from .extract.cascade import Extraction
from .extract.numbers import normalize_merchant
from .extract.rules import best_date
from .llm.schema import ReceiptExtraction, ReceiptItem

MAX_DIAS_ATRAS = 400


@dataclass
class AccountWindow:
    type: str = "hogar"
    starts_on: date | None = None
    ends_on: date | None = None


@dataclass
class Draft:
    merchant: str
    expense_date: date
    total_cop: int
    description_en: str | None
    items: list[ReceiptItem] = field(default_factory=list)
    subtotal_cop: int | None = None
    tax_cop: int | None = None
    tip_cop: int | None = None
    nit: str | None = None
    not_expense: bool = False
    confidence: dict[str, float] = field(default_factory=dict)
    sources: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


_SUFIJO_LEGAL = re.compile(
    r"[\s,.-]+(S\.?\s?A\.?\s?S\.?|LTDA\.?|S\.?\s?A\.?|E\.?\s?U\.?|S\.?\s?EN\s?C\.?|E\.?\s?S\.?\s?P\.?)\s*$",
    re.IGNORECASE,
)


def _bonito(nombre: str) -> str:
    """«PANADERIA LA ESPIGA S.A.S.» → «Panaderia La Espiga» (el OCR suele leer todo en mayúsculas)."""
    nombre = " ".join(nombre.split()).strip(" ,:;-*")
    anterior = None
    while anterior != nombre:  # «ENERGÍA DEL CARIBE S.A. E.S.P.» tiene dos
        anterior = nombre
        nombre = _SUFIJO_LEGAL.sub("", nombre).strip(" ,.-")
    if nombre.isupper() and len(nombre) > 3:
        palabras = nombre.lower().split()
        out = []
        for i, p in enumerate(palabras):
            previa = palabras[i - 1] if i else ""
            # Como en el kit: «Café de la Esquina», «Panadería La Espiga», «Tienda Don Beto»
            if i and (p in {"de", "del", "y", "en"} or (p in {"la", "las", "el", "los"} and previa in {"de", "del"})):
                out.append(p)
            else:
                out.append(p[:1].upper() + p[1:])
        nombre = " ".join(out)
    return nombre or "Gasto sin nombre"


def _clamp(v: float) -> float:
    return round(max(0.0, min(0.99, v)), 2)


# ---------------------------------------------------------------------------
# Total
# ---------------------------------------------------------------------------


def _total_mensaje(ex: Extraction, llm: ReceiptExtraction | None) -> tuple[int, float, str]:
    regla = ex.hints.amount
    del_llm = llm.total_cop if llm else None
    if regla and del_llm == regla:
        return regla, 0.95, "reglas+llm"
    if regla:
        return regla, 0.84 if llm is None else 0.8, "reglas"
    if del_llm:
        return del_llm, 0.6, "llm"
    return 0, 0.2, "ninguno"


def _total_documento(ex: Extraction, llm: ReceiptExtraction | None, notes: list[str]) -> tuple[int, float, str]:
    q = ex.quality
    h = ex.hints
    del_llm = llm.total_cop if llm else None
    candidatos = h.total_candidates

    if ex.qr and ex.qr.total:
        if del_llm and del_llm != ex.qr.total:
            notes.append(f"El LLM leyó {del_llm}; se usó el total del QR de la DIAN")
        return ex.qr.total, 0.99, "qr"
    cuadra = {v for v in (_suma_partes(h.subtotal, h.tax, h.tip), _suma_items(llm)) if v}
    if len(candidatos) > 1 and del_llm not in cuadra and (cuadran := [v for v in candidatos if v in cuadra]):
        # Varias líneas de TOTAL: la que es subtotal + impuestos (o la suma de los ítems)
        notes.append(f"El recibo tiene varios totales ({', '.join(map(str, candidatos))}); se usó el que cuadra")
        return cuadran[0], 0.7 * q + 0.1, "aritmetica"
    if del_llm and del_llm in candidatos:
        return del_llm, 0.75 + 0.22 * q, "llm+reglas"
    if del_llm and candidatos:
        # No coinciden: gana el que cuadre con subtotal + impuestos o con los ítems
        for v in [*candidatos, del_llm]:
            if v in cuadra:
                return v, 0.7 * q + 0.1, "aritmetica"
        notes.append(f"El total del recibo no es claro: {candidatos[0]} o {del_llm}")
        return candidatos[0], 0.55 * q, "reglas"
    if del_llm:
        return del_llm, (0.72 if del_llm in h.all_amounts else 0.5) * max(q, 0.5), "llm"
    if candidatos:
        return candidatos[0], 0.75 * q, "reglas"
    if ex.caption_hints.amount:
        return ex.caption_hints.amount, 0.8, "mensaje"
    return 0, 0.2, "ninguno"


def _suma_partes(subtotal: int | None, tax: int | None, tip: int | None) -> int | None:
    if not subtotal:
        return None
    return subtotal + (tax or 0) + (tip or 0)


def _suma_items(llm: ReceiptExtraction | None) -> int | None:
    if not llm or not llm.items:
        return None
    totales = [i.total_cop for i in llm.items]
    if any(t is None for t in totales):
        return None
    return sum(t for t in totales if t is not None) or None


# ---------------------------------------------------------------------------
# Fecha
# ---------------------------------------------------------------------------


def _fecha(ex: Extraction, llm: ReceiptExtraction | None, today: date, received: date) -> tuple[date, float, str]:
    if ex.qr and ex.qr.issued_on and ex.qr.issued_on <= today + timedelta(days=1):
        return ex.qr.issued_on, 0.99, "qr"
    piso = today - timedelta(days=MAX_DIAS_ATRAS)
    por_reglas = best_date(ex.hints.dates + ex.caption_hints.dates, today)
    del_llm = llm.parsed_date if llm else None
    if del_llm and not (piso <= del_llm <= today + timedelta(days=1)):
        del_llm = None
    if por_reglas and del_llm == por_reglas:
        return por_reglas, 0.95, "reglas+llm"
    if por_reglas:
        return por_reglas, 0.9, "reglas"
    if del_llm:
        return del_llm, 0.7, "llm"
    # Nadie dijo la fecha: la del mensaje. En un chat casi siempre es del mismo día.
    return received, 0.88 if ex.kind == "text" else 0.6, "recibido"


# ---------------------------------------------------------------------------
# Comercio
# ---------------------------------------------------------------------------


def _comercio(ex: Extraction, llm: ReceiptExtraction | None) -> tuple[str, float, str]:
    del_llm = llm.merchant if llm else None
    por_reglas = ex.hints.merchant_guess
    if ex.kind == "text":
        if (
            del_llm
            and por_reglas
            and fuzz.token_set_ratio(normalize_merchant(del_llm), normalize_merchant(por_reglas)) >= 85
        ):
            return _bonito(del_llm), 0.75, "reglas+llm"
        return _bonito(del_llm or por_reglas or "Gasto sin nombre"), 0.62, "llm" if del_llm else "reglas"

    cabeza = normalize_merchant("\n".join(ex.text.splitlines()[:12])) or ""
    if del_llm:
        visto = fuzz.partial_ratio(normalize_merchant(del_llm) or "", cabeza) if cabeza else 0
        if visto >= 90:
            return _bonito(del_llm), 0.7 + 0.22 * ex.quality, "llm+documento"
        return _bonito(del_llm), 0.65, "llm"
    if por_reglas:
        return _bonito(por_reglas), 0.6, "reglas"
    return "Gasto sin nombre", 0.3, "ninguno"


# ---------------------------------------------------------------------------
# Todo junto
# ---------------------------------------------------------------------------


def reconcile(
    ex: Extraction,
    llm: ReceiptExtraction | None,
    *,
    today: date,
    received: date,
    account: AccountWindow,
    explicit: bool = False,
) -> Draft:
    """Arma el borrador del gasto. `explicit` = alguien lo subió a propósito desde la web."""
    notes: list[str] = []
    if ex.kind == "text":
        total, c_total, s_total = _total_mensaje(ex, llm)
    else:
        total, c_total, s_total = _total_documento(ex, llm, notes)

    # Sumas que cuadran suben la confianza
    if total and c_total < 0.99:
        if total in {_suma_partes(ex.hints.subtotal, ex.hints.tax, ex.hints.tip), _suma_items(llm)}:
            c_total += 0.03
        if ex.kind != "text" and ex.caption_hints.amount == total:
            c_total += 0.03

    fecha, c_fecha, s_fecha = _fecha(ex, llm, today, received)
    if account.type == "evento" and account.starts_on:
        fin = account.ends_on or today
        if not (account.starts_on - timedelta(days=7) <= fecha <= fin + timedelta(days=7)):
            c_fecha = min(c_fecha, 0.6)
            notes.append("La fecha queda fuera de las fechas del evento")

    comercio, c_comercio, s_comercio = _comercio(ex, llm)

    no_es_gasto = not explicit and total == 0 and not (ex.qr and ex.qr.useful) and (llm is None or not llm.is_expense)

    items = [i for i in (llm.items if llm else []) if i.name and i.name != "?"]
    return Draft(
        merchant=comercio[:80],
        expense_date=fecha,
        total_cop=total,
        description_en=(llm.description_en or None) if llm else None,
        items=items,
        subtotal_cop=(llm.subtotal_cop if llm else None) or ex.hints.subtotal or (ex.qr.subtotal if ex.qr else None),
        tax_cop=(llm.tax_cop if llm else None) or ex.hints.tax or (ex.qr.tax if ex.qr else None),
        tip_cop=(llm.tip_cop if llm else None) or ex.hints.tip,
        nit=(ex.qr.nit if ex.qr else None) or ex.hints.nit or (llm.merchant_nit if llm else None),
        not_expense=no_es_gasto,
        confidence={"merchant": _clamp(c_comercio), "date": _clamp(c_fecha), "total": _clamp(c_total)},
        sources={"merchant": s_comercio, "date": s_fecha, "total": s_total},
        notes=notes,
    )
