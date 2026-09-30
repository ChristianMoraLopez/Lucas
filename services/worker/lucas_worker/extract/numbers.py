"""Texto y plata a la colombiana.

`normalize_merchant` y `parse_cop_amount` son el mismo algoritmo que las
funciones de Postgres del mismo nombre (migración 40): la memoria de comercios
guarda lo que da `normalize_merchant` y ambos lados deben coincidir.
"""

from __future__ import annotations

import re

_TILDES = str.maketrans(
    "ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ",
    "AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun",
)
_NO_ALFANUM = re.compile(r"[^a-z0-9&]+")


def normalize_merchant(text: str | None) -> str | None:
    """«Panadería  La Espiga» → «panaderia la espiga» (igual que public.normalize_merchant)."""
    t = _NO_ALFANUM.sub(" ", (text or "").translate(_TILDES).lower()).strip()
    return t or None


def strip_accents(text: str) -> str:
    return text.translate(_TILDES)


# Sufijos legales que no ayudan a reconocer un comercio
_SUFIJOS = re.compile(r"\b(s ?a ?s|s ?a|ltda|e ?u|s ?en ?c|y ?cia|cia)\b\.?$")


def merchant_key(text: str | None) -> str | None:
    """Clave para comparar comercios: normalizado y sin «S.A.S.», «Ltda.»…"""
    t = normalize_merchant(text)
    if not t:
        return None
    anterior = None
    while anterior != t:
        anterior = t
        t = _SUFIJOS.sub("", t).strip()
    return t or None


# ---------------------------------------------------------------------------
# Montos como los escribe la gente (mensajes de WhatsApp)
# ---------------------------------------------------------------------------

_MILLONES = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:palos?|palitos?|millones|millon\b|mm\b)")
_MILES = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:lucas?|luquitas?|mil\b|k\b)")
_PUNTO_MILES = re.compile(r"(\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?")
_PEGADO = re.compile(r"(?:^|[^\d/])(\d{4,9})(?:[^\d/]|$)")
_SUELTO = re.compile(r"(?:^|[^\d/.,])(\d{1,3})(?:[^\d/.,]|$)")


def parse_cop_amount(text: str | None) -> int | None:
    """«100 lucas» 100.000 · «1,2 palos» 1.200.000 · «$84.300» 84.300 · «pagué 38 el taxi» 38.000."""
    t = strip_accents(text or "").lower()
    if m := _MILLONES.search(t):
        return round(float(m.group(1).replace(",", ".")) * 1_000_000)
    if m := _MILES.search(t):
        return round(float(m.group(1).replace(",", ".")) * 1_000)
    if m := _PUNTO_MILES.search(t):
        return int(m.group(1).replace(".", ""))
    if m := _PEGADO.search(t):
        return int(m.group(1))
    if (m := _SUELTO.search(t)) and int(m.group(1)) > 0:
        return int(m.group(1)) * 1_000
    return None


# ---------------------------------------------------------------------------
# Números de recibos: «$ 11.300», «11,300.00», «11.300,00», «11300.00», «1.785.000»
# ---------------------------------------------------------------------------

_NUMERO = re.compile(r"(?<![\d.,])\$?\s?(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d])")


def parse_number(token: str) -> int | None:
    """Un número de recibo a pesos enteros (los centavos se descartan)."""
    s = token.strip().lstrip("$").strip().replace(" ", "")
    if not s or not re.fullmatch(r"[\d.,]+", s):
        return None
    ultimo = max(s.rfind("."), s.rfind(","))
    if ultimo == -1:
        return int(s)
    decimales = s[ultimo + 1 :]
    entero = s[:ultimo]
    if len(decimales) == 3:
        # Separador de miles: «11.300», «1,785,000»
        return int(re.sub(r"[.,]", "", s))
    if len(decimales) in (1, 2):
        # Centavos: «11300.00», «11.300,00», «11,300.00»
        digits = re.sub(r"[.,]", "", entero)
        return int(digits) if digits else 0
    return None


def find_amounts(line: str) -> list[int]:
    """Todos los montos de una línea, en orden."""
    out: list[int] = []
    for m in _NUMERO.finditer(line):
        v = parse_number(m.group(1))
        if v is not None:
            out.append(v)
    return out
