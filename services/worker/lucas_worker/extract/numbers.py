"""Texto y plata a la colombiana.

`normalize_merchant` y `parse_cop_amount` son el mismo algoritmo que las
funciones de Postgres del mismo nombre (migración 40): la memoria de comercios
guarda lo que da `normalize_merchant` y ambos lados deben coincidir.
"""

from __future__ import annotations

import re
from contextvars import ContextVar

# ---------------------------------------------------------------------------
# La moneda de la cuenta. En pesos (COP, CLP) los montos son pesos enteros; en
# dólares y bolivianos (USD, BOB) son centavos: «$12.50» → 1250. La fija el
# pipeline al empezar cada mensaje (worker_message_context trae la cuenta).
# ---------------------------------------------------------------------------

_CENTAVOS: ContextVar[bool] = ContextVar("centavos", default=False)
MONEDAS_CON_CENTAVOS = frozenset({"USD", "BOB"})


def fijar_moneda(currency: str | None) -> None:
    """Desde aquí, los montos se leen en la moneda de esta cuenta."""
    _CENTAVOS.set((currency or "COP").upper() in MONEDAS_CON_CENTAVOS)


def con_centavos() -> bool:
    """¿La cuenta guarda centavos (dólares, bolivianos)?"""
    return _CENTAVOS.get()


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


_K = re.compile(r"(\d+(?:[.,]\d+)?)\s*k\b")


def _monto_con_centavos(t: str) -> int | None:
    """En dólares o bolivianos: «uber 23.40» 2340 · «dinner $85» 8500 · «1.2k rent» 120000 (centavos)."""
    if m := _K.search(t):
        return round(float(m.group(1).replace(",", ".")) * 1_000 * 100)
    candidatos = []
    for m in _NUMERO.finditer(t):
        crudo = m.group(1).replace(" ", "")
        if len(re.sub(r"\D", "", crudo)) > 8:  # un teléfono, una cuenta
            continue
        v = parse_number(crudo)
        if v is not None and v > 0:
            # Lo que tiene «$» adelante gana; si no, el monto más grande («2 tacos 15» → 15)
            candidatos.append(("$" in m.group(0) or "$" in t[max(0, m.start() - 2) : m.start()], v))
    if not candidatos:
        return None
    return max(candidatos)[1]


def parse_cop_amount(text: str | None) -> int | None:
    """«100 lucas» 100.000 · «1,2 palos» 1.200.000 · «$84.300» 84.300 · «pagué 38 el taxi» 38.000.

    En una cuenta en dólares o bolivianos, en centavos: «taxi 45» 4500 · «uber 23.40» 2340.
    """
    t = strip_accents(text or "").lower()
    if con_centavos():
        return _monto_con_centavos(t)
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
    """Un número de recibo a pesos enteros (los centavos se descartan); en dólares o bolivianos, a centavos."""
    s = token.strip().lstrip("$").strip().replace(" ", "")
    if not s or not re.fullmatch(r"[\d.,]+", s):
        return None
    por = 100 if con_centavos() else 1
    ultimo = max(s.rfind("."), s.rfind(","))
    if ultimo == -1:
        return int(s) * por
    decimales = s[ultimo + 1 :]
    entero = s[:ultimo]
    if len(decimales) == 3:
        # Separador de miles: «11.300», «1,785,000»
        return int(re.sub(r"[.,]", "", s)) * por
    if len(decimales) in (1, 2):
        # Centavos: «11300.00», «11.300,00», «11,300.00» (en pesos se descartan)
        digits = re.sub(r"[.,]", "", entero)
        base = int(digits) if digits else 0
        return base * 100 + int(decimales.ljust(2, "0")) if por == 100 else base
    return None


def find_amounts(line: str) -> list[int]:
    """Todos los montos de una línea, en orden."""
    out: list[int] = []
    for m in _NUMERO.finditer(line):
        v = parse_number(m.group(1))
        if v is not None:
            out.append(v)
    return out
