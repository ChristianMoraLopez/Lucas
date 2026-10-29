"""Texto y plata a la colombiana.

`normalize_merchant` y `parse_cop_amount` son el mismo algoritmo que las
funciones de Postgres del mismo nombre (migración 40): la memoria de comercios
guarda lo que da `normalize_merchant` y ambos lados deben coincidir.
"""

from __future__ import annotations

import re
from contextvars import ContextVar
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# La moneda de la cuenta. En pesos (COP, CLP) los montos son pesos enteros; en
# dólares y bolivianos (USD, BOB) son centavos: «$12.50» → 1250. La fija el
# pipeline al empezar cada mensaje (worker_message_context trae la cuenta).
# ---------------------------------------------------------------------------

_CENTAVOS: ContextVar[bool] = ContextVar("centavos", default=False)
# Las de las cuentas (COP, CLP, BOB, USD) y las de recibos de viaje, que se convierten
MONEDAS = ("COP", "CLP", "BOB", "USD", "EUR", "PEN", "MXN", "ARS", "BRL")
MONEDAS_CON_CENTAVOS = frozenset(MONEDAS) - {"COP", "CLP"}


def decimales(currency: str) -> int:
    """Cuántos decimales guarda la base para esta moneda: 0 en pesos colombianos y chilenos, 2 en las demás."""
    return 2 if currency.upper() in MONEDAS_CON_CENTAVOS else 0


def fijar_moneda(currency: str | None) -> None:
    """Desde aquí, los montos se leen en esta moneda (la de la cuenta o la del recibo)."""
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


@dataclass(frozen=True)
class MontoEscrito:
    """Un monto dentro de un mensaje: cuánto es y dónde está en el texto."""

    valor: int
    inicio: int
    fin: int
    # Qué tan claro es que sea plata: 4 palos/millones · 3 lucas/mil/k · 2 con puntos de miles o «$»
    # · 1 cuatro o más cifras pegadas · 0 número suelto («38 el taxi», que se lee en miles)
    clase: int


# Un número con su unidad, si la trae: «5 k», «4.5k», «1,2 palos», «$84.300», «980»
_MONTO = re.compile(
    r"(?<![\w.,/:#])(?P<signo>\$\s?)?(?P<num>\d+(?:[.,]\d+)*)"
    r"(?:\s*(?P<unidad>palos?|palitos?|millones|millon|mm|lucas?|luquitas?|mil|k))?"
    r"(?![\w/%]|[.,]\d|:\d)"
)
_MILES_CON_PUNTOS = re.compile(r"\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{4,9}[.,]\d{1,2}")
# Un número suelto es plata si después viene el «en qué» («980 de tours», «38 el taxi») o nada;
# si viene una palabra cualquiera es una cantidad («2 cervezas», «3 noches»)
_DESPUES_DE_PLATA = re.compile(
    r"\s*(?:$|[\n,.;:!?)\-–+]|(?:de|del|en|el|la|los|las|por|para|y|e|con|mas|pesos|for|on|of|at|in|and|to)\b)"
)
# …y no es plata si es a cuántos se divide, una hora o un lugar («entre 3», «para 4», «a las 3», «mesa 12»)
_ANTES_DE_CANTIDAD = re.compile(
    r"(?:\b(?:entre|para|cada|x|por|a\s+las|de\s+las|mesa|piso|apto|apartamento|habitacion|cuarto|ruta"
    r"|calle|carrera|cra|cll|av|avenida)|[#xX*])\s*$"
)
_MESES_CORTOS = (
    r"enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre"
    r"|ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic"
)
_FECHA_EN_MENSAJE = re.compile(
    r"\b\d{1,2}\s+(?:de\s+)?(?:" + _MESES_CORTOS + r")\b\.?(?:\s+(?:de\s+)?\d{4})?|\b\d{1,2}/\d{1,2}(?:/\d{2,4})?"
)
# Señales de que los montos de un mensaje no son una lista para sumar
_POR_PERSONA = re.compile(r"\b(?:cada\s+un[oa]|a\s+cada\s+un[oa]|c/u|por\s+persona|por\s+cabeza|each|per\s+person)\b")
_NO_SE_SUMA = re.compile(
    r"\b(?:vuelto|cambio|devolvi\w*|descuento|abon\w*|anticipo|de\s+los\s+cuales|me\s+deb\w*|te\s+deb\w*|debe\w*|change|refund)\b"
)
_TOTAL_EN_MENSAJE = re.compile(r"\b(?:total|en\s+total|todo\s+fue|todo\s+salio)\b")


def _valor_de(signo: str | None, num: str, unidad: str | None) -> tuple[int, int] | None:
    """(valor en la unidad de la cuenta, clase) de un número del mensaje, o None si no es plata."""
    por = 100 if con_centavos() else 1
    if unidad:
        if num.count(".") + num.count(",") > 1:
            return None
        x = float(num.replace(",", "."))
        if unidad.startswith(("palo", "palito", "millon", "mm")):
            return round(x * 1_000_000 * por), 4
        return round(x * 1_000 * por), 3
    if "." in num or "," in num:
        # «84.300», «1,250,000», «11300.00»; en dólares también «12.50». En pesos, «4.5» no se sabe qué es
        if not con_centavos() and not _MILES_CON_PUNTOS.fullmatch(num):
            return None
        v = parse_number(num)
        return (v, 2) if v else None
    if len(num) > 9:  # un teléfono, una cuenta
        return None
    if len(num) >= 4:
        return int(num) * por, 2 if signo else 1
    # Suelto («38 el taxi»): en pesos se lee en miles; en dólares, tal cual
    return int(num) * (100 if con_centavos() else 1_000), 2 if signo else 0


def montos_del_mensaje(text: str | None) -> list[MontoEscrito]:
    """Todos los montos de un mensaje, en orden. Las posiciones son las del texto original."""
    t = strip_accents(text or "").lower()
    if len(t) != len(text or ""):
        t = (text or "").lower()
    # Las fechas no son plata («1 de octubre», «26/09»): se tapan sin mover las posiciones
    t = _FECHA_EN_MENSAJE.sub(lambda m: " " * len(m.group(0)), t)
    out: list[MontoEscrito] = []
    for m in _MONTO.finditer(t):
        r = _valor_de(m.group("signo"), m.group("num"), m.group("unidad"))
        if not r or r[0] <= 0:
            continue
        valor, clase = r
        if clase == 0 and (not _DESPUES_DE_PLATA.match(t, m.end()) or _ANTES_DE_CANTIDAD.search(t, 0, m.start())):
            continue
        out.append(MontoEscrito(valor, m.start(), m.end(), clase))
    return out


def monto_del_mensaje(text: str | None) -> tuple[int | None, list[MontoEscrito]]:
    """
    Cuánto dice el mensaje y, si lo sumó, de qué montos sale. Un mensaje con
    varias cosas («5 k bloqueador 4.5 k de cerveza 980 de tours») es la suma;
    si dice «total», es ese; si es por persona o habla de vueltos o deudas,
    el monto más claro, como siempre.
    """
    montos = montos_del_mensaje(text)
    if not montos:
        return None, []
    t = strip_accents(text or "").lower()
    if len(montos) > 1:
        if m := _TOTAL_EN_MENSAJE.search(t):
            # «total 15k: …» (el de después) o «… 600 en total» (el de justo antes)
            despues = [x for x in montos if x.inicio >= m.end()]
            antes = [x for x in montos if x.fin <= m.start() and not t[x.fin : m.start()].strip(" :,")]
            if despues or antes:
                return (despues or antes)[0].valor, []
        if not _POR_PERSONA.search(t) and not _NO_SE_SUMA.search(t):
            return sum(x.valor for x in montos), montos
    # Uno solo (o no es una lista): el más claro y, entre iguales, el primero
    return max(montos, key=lambda x: (x.clase, -x.inicio)).valor, []


def parse_cop_amount(text: str | None) -> int | None:
    """«100 lucas» 100.000 · «1,2 palos» 1.200.000 · «$84.300» 84.300 · «pagué 38 el taxi» 38.000.
    Varias cosas en un mensaje se suman: «5 k bloqueador 4.5 k de cerveza» 9.500.

    En una cuenta en dólares o bolivianos, en centavos: «taxi 45» 4500 · «uber 23.40» 2340.
    """
    return monto_del_mensaje(text)[0]


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


def monto_sin_puntuacion(valor: int, text: str | None) -> int | None:
    """El LLM a veces copia «$28.644,53» sin puntos ni coma: 2864453 en vez de 28.644.
    Si un número del texto tiene esos mismos dígitos y se lee distinto, lo que dice el texto."""
    for m in _NUMERO.finditer(text or ""):
        if re.sub(r"\D", "", m.group(1)) == str(valor) and (v := parse_number(m.group(1))) is not None and v != valor:
            return v
    return None


def find_amounts(line: str) -> list[int]:
    """Todos los montos de una línea, en orden."""
    out: list[int] = []
    for m in _NUMERO.finditer(line):
        v = parse_number(m.group(1))
        if v is not None:
            out.append(v)
    return out
