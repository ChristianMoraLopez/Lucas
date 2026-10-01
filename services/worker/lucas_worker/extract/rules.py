"""Reglas: lo que se puede sacar con certeza sin IA.

Para mensajes («taxis al aeropuerto 100 lucas, la pagó Santi») y para el texto
de recibos (OCR o PDF): montos, líneas de TOTAL, fechas colombianas, NIT, CUFE
y un primer intento de comercio. El LLM recibe esto como pistas y la
validación lo usa para medir la confianza de lo que el LLM respondió.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from .numbers import find_amounts, normalize_merchant, parse_cop_amount, strip_accents

MESES = {
    "ene": 1, "enero": 1, "feb": 2, "febrero": 2, "mar": 3, "marzo": 3, "abr": 4, "abril": 4,
    "may": 5, "mayo": 5, "jun": 6, "junio": 6, "jul": 7, "julio": 7, "ago": 8, "agosto": 8,
    "sep": 9, "sept": 9, "set": 9, "septiembre": 9, "setiembre": 9, "oct": 10, "octubre": 10,
    "nov": 11, "noviembre": 11, "dic": 12, "diciembre": 12,
}  # fmt: skip
DIAS = {"lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3, "viernes": 4, "sabado": 5, "domingo": 6}

# El año de 4 cifras puede venir pegado a la hora («26/09/202608:14», el OCR se come el espacio)
_FECHA_NUM = re.compile(r"(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2}(?!\d))")
_FECHA_ISO = re.compile(r"(?<!\d)(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?!\d)")
_FECHA_CORTA = re.compile(r"(?<![\d/.-])(\d{1,2})/(\d{1,2})(?![\d/.-])")
_FECHA_TEXTO = re.compile(r"(?<!\d)(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})\.?(?:\s*(?:de|del)?\s*(\d{4}))?(?!\d)")

_CUFE = re.compile(r"\b(?:CUFE|CUDE|CUDS)\s*[:=]?\s*([0-9a-fA-F]{96})\b")
_HEX96 = re.compile(r"\b([0-9a-f]{96})\b")
_NIT = re.compile(r"\bN\.?\s?I\.?\s?T\.?\s*[:.]?\s*(\d{1,3}(?:[.\s]?\d{3}){2,3})(?:\s*-\s*(\d))?", re.IGNORECASE)

# Líneas que dicen el total a pagar (y las que se parecen pero no lo son)
_TOTAL = re.compile(
    r"\b(total\s+a\s+pagar|valor\s+a\s+pagar|neto\s+a\s+pagar|total\s+factura|valor\s+total|gran\s+total|total\s+neto|total)\b"
)
_NO_TOTAL = re.compile(
    r"\b(subtotal|sub\s+total|base\s+gravable|total\s+(iva|impuestos?|items?|articulos?|unidades|descuentos?|base"
    r"|bruto|propina|pagado|recibido|efectivo|cambio))\b"
)
_SUBTOTAL = re.compile(r"\b(subtotal|sub\s+total|total\s+bruto)\b")
_IMPUESTO = re.compile(r"\b(iva|impoconsumo|inc|impuesto)\b")
_PROPINA = re.compile(r"\b(propina|servicio voluntario)\b")
_PAGO = re.compile(r"\b(efectivo|cambio|vueltas|recibido|tarjeta|datafono)\b")

_RUIDO_COMERCIO = re.compile(
    r"\b(nit|fecha|hora|factura|tel|telefono|cel|direccion|cra|carrera|calle|cl|av|avenida|regimen|resolucion|"
    r"autoriza|caja|cajero|mesa|pos|www|http|documento|cliente|cc|pedido|orden|ticket)\b"
)


@dataclass
class DateHit:
    value: date
    source: str  # "texto", "relativa", "semana"


@dataclass
class Hints:
    """Pistas de las reglas para el LLM y la validación."""

    amount: int | None = None  # el monto del mensaje (reglas de lucas, palos, mil)
    total_candidates: list[int] = field(default_factory=list)  # montos en líneas de TOTAL
    subtotal: int | None = None
    tax: int | None = None
    tip: int | None = None
    all_amounts: list[int] = field(default_factory=list)
    dates: list[DateHit] = field(default_factory=list)
    nit: str | None = None
    cufe: str | None = None
    merchant_guess: str | None = None
    category_guess: str | None = None


# ---------------------------------------------------------------------------
# Fechas
# ---------------------------------------------------------------------------


def _fecha(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _anio(y: int) -> int:
    return y + 2000 if y < 100 else y


def _sin_anio(d: int, m: int, today: date) -> date | None:
    f = _fecha(today.year, m, d)
    if f and f > today + timedelta(days=1):
        f = _fecha(today.year - 1, m, d)
    return f


def find_dates(text: str, today: date) -> list[DateHit]:
    """Fechas escritas: 26/09/2026, 26-09-26, 2026-09-26, 26 de septiembre, 26 sep 2026, 26/09."""
    t = strip_accents(text).lower()
    hits: list[DateHit] = []
    usados: list[tuple[int, int]] = []

    def agregar(f: date | None, span: tuple[int, int]) -> None:
        if f and not any(a <= span[0] < b for a, b in usados):
            hits.append(DateHit(f, "texto"))
            usados.append(span)

    for m in _FECHA_ISO.finditer(t):
        agregar(_fecha(int(m.group(1)), int(m.group(2)), int(m.group(3))), m.span())
    for m in _FECHA_NUM.finditer(t):
        d, mo, y = int(m.group(1)), int(m.group(2)), _anio(int(m.group(3)))
        # En Colombia es día/mes; si el mes no puede ser, era mes/día (datáfonos gringos)
        f = _fecha(y, mo, d) if mo <= 12 else _fecha(y, d, mo)
        agregar(f, m.span())
    for m in _FECHA_TEXTO.finditer(t):
        mes = MESES.get(m.group(2))
        if not mes:
            continue
        d = int(m.group(1))
        f = _fecha(int(m.group(3)), mes, d) if m.group(3) else _sin_anio(d, mes, today)
        agregar(f, m.span())
    for m in _FECHA_CORTA.finditer(t):
        d, mo = int(m.group(1)), int(m.group(2))
        if 1 <= mo <= 12:
            agregar(_sin_anio(d, mo, today), m.span())
    return hits


def relative_date(text: str, today: date) -> DateHit | None:
    """«ayer», «antier», «anoche», «el sábado»: lo que se dice en un chat."""
    t = normalize_merchant(text) or ""
    if re.search(r"\b(antier|anteayer|antenoche)\b", t):
        return DateHit(today - timedelta(days=2), "relativa")
    if re.search(r"\b(ayer|anoche)\b", t):
        return DateHit(today - timedelta(days=1), "relativa")
    if re.search(r"\bhoy\b", t):
        return DateHit(today, "relativa")
    if m := re.search(r"\b(?:el|este|del)\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b", t):
        dia = DIAS[m.group(1)]
        atras = (today.weekday() - dia) % 7 or 7
        return DateHit(today - timedelta(days=atras), "semana")
    return None


# ---------------------------------------------------------------------------
# Mensajes de chat
# ---------------------------------------------------------------------------

_MONTO_EN_TEXTO = re.compile(
    r"\$?\s*\d[\d.,]*\s*(lucas?|luquitas?|mil|palos?|palitos?|millones|millon|k)?\b", re.IGNORECASE
)


# Lo que no es el «en qué» de un mensaje escrito: fechas, verbos de pagar y relleno
_MESES_TXT = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre"
_FECHA_TXT = re.compile(
    r"(?<!\w)(?:el\s+)?(?:d[ií]a\s+de\s+)?(?:hoy|ayer|anoche|antier|anteayer|antenoche)(?!\w)"
    r"|(?<!\w)(?:el\s+)?\d{1,2}\s+de\s+(?:" + _MESES_TXT + r")(?:\s+de\s+\d{4})?(?!\w)",
    re.IGNORECASE,
)
_RELLENO = re.compile(r"(?<!\w)(?:otr[oa]s?\s+vez|otr[oa]s?|tambi[eé]n|nuevamente|de\s+nuevo)(?!\w)", re.IGNORECASE)
# «para Valentina»: a quién beneficia, no en qué (con mayúscula: es un nombre)
_PARA_ALGUIEN = re.compile(r"(?<!\w)para\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]*(?:\s+y\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]*)?")
_INICIO = re.compile(
    r"^[\s,.;:-]*(?:(?:yo|nosotros|hoy|ayer|de|del|el|la|los|las|en|un|una|unos|unas|para|por|que|se|nos|me|le|les|y"
    r"|gast\w*|pagu[eé]|pagamos|pagaron|compr\w*|cost\w*|sali[oó]|valieron|vali[oó]|cobr\w*|invert\w*)[\s,.;:]+)+",
    re.IGNORECASE,
)


def merchant_from_text(text: str | None) -> str:
    """El «en qué» de un mensaje: «Ayer gastamos 47,500 en un vale de salud para
    Valentina» → «Vale de salud». (Más completo que public.merchant_from_text.)"""
    t = text or ""
    t = _FECHA_TXT.sub(" ", t)  # antes que los montos: el «1» de «1 de octubre» no es plata
    t = _MONTO_EN_TEXTO.sub(" ", t)
    t = re.sub(r"\s*(la|lo|los|las)?\s*pag[oó]\s+[^\W\d_]+", " ", t, flags=re.IGNORECASE)
    t = _RELLENO.sub(" ", t)
    t = _PARA_ALGUIEN.sub(" ", t)
    t = _INICIO.sub("", t)
    # Lo que no es el comercio: «entre Vale y Santi», «pagado por Laura», «ayer»
    t = re.sub(r"\b(entre|pagad[oa]s?\s+por)\b.*$", " ", t, flags=re.IGNORECASE)
    t = re.sub(r"\b(ayer|hoy|anoche|antier|anteayer|antenoche)\b", " ", t, flags=re.IGNORECASE)
    t = re.sub(r"\s+([,.;:])", r"\1", re.sub(r"\s+", " ", t))
    t = _INICIO.sub("", t).strip(" :;,.-·")
    if not t:
        return "Gasto sin nombre"
    if len(t) > 40:  # se corta en una palabra completa
        t = t[:41].rsplit(" ", 1)[0].rstrip(" ,.;:-")
    return t[0].upper() + t[1:]


def guess_category(text: str | None) -> str | None:
    from ..classify.categories import keyword_category

    return keyword_category(text)


def analyze_message(text: str | None, today: date) -> Hints:
    h = Hints()
    if not text:
        return h
    h.amount = parse_cop_amount(text)
    rel = relative_date(text, today)
    h.dates = find_dates(text, today) + ([rel] if rel else [])
    h.merchant_guess = merchant_from_text(text)
    h.category_guess = guess_category(text)
    return h


# ---------------------------------------------------------------------------
# Recibos (texto de OCR o del PDF)
# ---------------------------------------------------------------------------


def _linea_norm(line: str) -> str:
    return re.sub(r"\s+", " ", strip_accents(line).lower()).strip()


def _montos_de_linea(lines: list[str], i: int) -> list[int]:
    """Montos de la línea i; si no tiene, los de la siguiente (el OCR a veces parte la línea)."""
    montos = [v for v in find_amounts(lines[i]) if v > 0]
    if not montos and i + 1 < len(lines):
        montos = [v for v in find_amounts(lines[i + 1]) if v > 0]
    return montos


def find_cufe(text: str) -> str | None:
    if m := _CUFE.search(text):
        return m.group(1).lower()
    if m := _HEX96.search(text.lower()):
        return m.group(1)
    return None


def analyze_document(text: str | None, today: date) -> Hints:
    h = Hints()
    if not text:
        return h
    lines = [ln for ln in (x.strip() for x in text.splitlines()) if ln]
    normas = [_linea_norm(ln) for ln in lines]

    for i, n in enumerate(normas):
        if _SUBTOTAL.search(n):
            if montos := _montos_de_linea(lines, i):
                h.subtotal = montos[-1]
            continue
        if _TOTAL.search(n) and not _NO_TOTAL.search(n):
            for v in _montos_de_linea(lines, i)[-1:]:
                if v not in h.total_candidates:
                    h.total_candidates.append(v)
            continue
        if _PROPINA.search(n):
            if montos := _montos_de_linea(lines, i):
                h.tip = montos[-1]
        elif _IMPUESTO.search(n) and not _PAGO.search(n) and (montos := _montos_de_linea(lines, i)):
            h.tax = (h.tax or 0) + montos[-1]

    for ln in lines:
        h.all_amounts.extend(v for v in find_amounts(ln) if v >= 50)
    h.dates = find_dates(text, today)
    h.cufe = find_cufe(text)
    if m := _NIT.search(text):
        h.nit = re.sub(r"\D", "", m.group(1)) + (f"-{m.group(2)}" if m.group(2) else "")
    h.merchant_guess = _comercio_de_recibo(lines)
    h.category_guess = guess_category(text[:600])
    return h


def _comercio_de_recibo(lines: list[str]) -> str | None:
    """La primera línea con letras que no sea NIT, dirección, fecha ni «factura»."""
    for ln in lines[:8]:
        n = _linea_norm(ln)
        letras = sum(c.isalpha() for c in n)
        if letras < 4 or _RUIDO_COMERCIO.search(n) or _TOTAL.search(n) or _SUBTOTAL.search(n) or _PAGO.search(n):
            continue
        if find_amounts(ln) and letras < 8:
            continue
        limpio = re.sub(r"\s+", " ", ln).strip(" *-=#·:")
        if limpio:
            return limpio[:60]
    return None


def best_date(hits: list[DateHit], today: date, *, earliest: date | None = None) -> date | None:
    """La fecha más probable del gasto: la primera razonable (no futura, no muy vieja)."""
    piso = earliest or today - timedelta(days=400)
    for hit in hits:
        if piso <= hit.value <= today + timedelta(days=1):
            return hit.value
    return None
