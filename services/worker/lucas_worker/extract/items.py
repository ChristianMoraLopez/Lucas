"""Los ítems de un recibo leídos del texto del OCR, sin el LLM.

Los recibos colombianos imprimen los ítems de muchas formas:

    PAPA BACON                          (nombre arriba,
    2 × 5.000,00 € 10.000,00 €           cantidad × unitario y total abajo)

    Vend Sc Cnt Producto Vr Uni Vr Total
    92 5 2 CAMISETA 23.800 47.600       (códigos, nombre, unitario y total)

    548029-REPELENTE STAY OFF AMAZONIC  (nombre en dos renglones y los
    AEROSOL 160 ML(PF)                   valores en el siguiente; el último
    24,110 1 0 6,028 24,110              es el total del renglón)

    2.000/ PAN SUPER HAMBURGUESA        (cantidad con tres decimales)
    X6UND $17,400.0

Se recorre de arriba hacia abajo hasta la primera línea de TOTAL: cada línea
con plata cierra un ítem con el nombre que venía en las líneas anteriores (o
en la misma). Solo cuentan como plata los números con forma de plata
(«4.500», «$608.0», «22,400,00»): «HIT PET 500» o «160 ML» son parte del nombre.

Si los ítems no cuadran con el total del recibo, no se usan (mejor ninguno
que ítems inventados): el gasto se divide igual y se pueden poner a mano.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .numbers import strip_accents

# Plata: con separador de miles (y centavos opcionales), con «$» adelante o
# con centavos («18000.00»)
_PLATA = re.compile(
    r"(?<![\w.,])(\$\s?\d[\d.,]*\d|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{1,3}\s\d{3}[.,]\d{2}|\d{3,7}[.,]\d{2})(?![\d:]|[.,]\d)"
)
# «2 x», «2 ×», «1 X», «1@» al empezar la línea de valores
_POR = re.compile(r"^\s*(\d{1,3})\s*[x×X*@]\s*")
# Cantidad con tres decimales al empezar el nombre: «2.000/ PAN…», «1.000 SALSA…»
_CANTIDAD_DECIMAL = re.compile(r"^\s*(\d{1,3})[.,]000\b")
# Donde terminan los ítems
_FIN = re.compile(
    r"\b(sub\s*-?\s*total|total|valor\s+bruto|cantidad\s+de\s+art|art[ií]culos\s+vendidos|detalle\s+de\s+valores|"
    r"formas?\s+de\s+pago|medio\s+de\s+pago|efectivo|cambio|recibido|propina|descuento|i\.?\s?v\.?\s?a\.?\s*:)",
    re.IGNORECASE,
)
# Comprobantes de pago o de transferencia (Nu, Nequi, Bre-B, bancos): no traen productos
_COMPROBANTE = re.compile(
    r"comprobante\s+de\s+(transacci|pago)|transferencia\s+exitosa|pago\s+exitoso|env[ií]o\s+realizado|pagaste\s+en",
    re.IGNORECASE,
)
# Palabras de la fila de títulos de la tabla de ítems
_TITULOS = {
    "cant", "cnt", "cantidad", "producto", "productos", "descripcion", "detalle", "codigo", "nombre", "valor", "vr",
    "v", "uni", "unit", "unitario", "precio", "parcial", "total", "dto", "desc", "iva", "item", "articulo", "ref",
    "und", "vend", "sc", "ent", "fra", "subtotal", "importe",
}  # fmt: skip


@dataclass
class ItemLeido:
    name: str
    quantity: float
    unit_price_cop: int | None
    total_cop: int


def _plata(token: str) -> int | None:
    s = token.replace("$", "").replace(" ", "")
    if not s:
        return None
    # Centavos al final («,00», «.0»): fuera
    if re.search(r"[.,]\d{1,2}$", s):
        s = s[: max(s.rfind("."), s.rfind(","))]
    digitos = re.sub(r"[.,]", "", s)
    return int(digitos) if digitos.isdigit() else None


def _montos(linea: str) -> list[tuple[int, int, int]]:
    """(valor, inicio, fin) de cada monto de la línea."""
    out = []
    for m in _PLATA.finditer(linea):
        v = _plata(m.group(1))
        if v is not None and v >= 50:
            out.append((v, m.start(), m.end()))
    return out


def _es_titulo(linea: str) -> bool:
    palabras = re.findall(r"[a-z]+", strip_accents(linea).lower())
    return len(palabras) >= 2 and sum(p in _TITULOS for p in palabras) >= 2 and not _montos(linea)


def _letras(texto: str) -> str:
    """El nombre sin códigos ni símbolos sueltos al principio y sin la moneda al final."""
    t = re.sub(r"^[\W\d_]+(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])", "", texto.strip())
    t = re.sub(r"[\s€$*]+$", "", t)
    return " ".join(t.split())


def _bonito(nombre: str) -> str:
    if nombre.isupper():
        nombre = " ".join(p[:1].upper() + p[1:].lower() for p in nombre.split())
    return nombre[:80]


def leer_items(texto: str | None) -> tuple[list[ItemLeido], bool]:
    """Los ítems del texto y si apareció la fila de títulos de la tabla."""
    items: list[ItemLeido] = []
    nombre: list[str] = []
    con_titulos = False
    for cruda in (texto or "").splitlines():
        linea = cruda.strip()
        if not linea:
            continue
        if _es_titulo(linea):
            con_titulos = True
            nombre = []
            items = []  # lo de antes de los títulos era el encabezado
            continue
        if _FIN.search(strip_accents(linea)):
            if items:
                break
            nombre = []
            continue
        # «1.000/ ACEITE…»: ese 1.000 es la cantidad, no plata
        cantidad_inicio = _CANTIDAD_DECIMAL.match(linea)
        resto = linea[cantidad_inicio.end() :] if cantidad_inicio else linea
        montos = _montos(resto)
        if not montos:
            nombre = [*nombre[-1:], linea]  # un nombre ocupa a lo sumo dos renglones
            continue

        # Una línea con plata: cierra un ítem. Su nombre es lo que va antes del
        # primer monto («CAMISETA 23.800 47.600»; lo de después es el código del IVA)
        por = _POR.match(resto)
        desde = por.end() if por else 0
        texto_linea = _letras(resto[desde : montos[0][1]])
        # «2 × 5.000 10.000» es solo del último renglón con letras de arriba (puede haber un código de barras en medio)
        con_letras = [p for p in nombre if re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}", p)]
        partes = con_letras[-1:] if por else [*nombre]
        cantidad_txt = cantidad_inicio or next((m for p in partes if (m := _CANTIDAD_DECIMAL.match(p))), None)
        if texto_linea and re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}", texto_linea):
            partes.append(texto_linea)
        nombre_item = _bonito(_letras(" ".join(partes)))
        nombre = []
        if not nombre_item or not re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}", nombre_item):
            continue

        total = montos[-1][0]
        unitario = montos[0][0] if len(montos) > 1 else None
        if por:
            cantidad = float(por.group(1))
        elif cantidad_txt:
            cantidad = float(cantidad_txt.group(1))
        elif unitario and total > unitario and total % unitario == 0 and total // unitario <= 50:
            cantidad = float(total // unitario)
        else:
            cantidad = 1.0
        if unitario is None:
            unitario = round(total / cantidad)
        items.append(ItemLeido(nombre_item, cantidad, unitario, total))
    return items, con_titulos


def items_del_recibo(texto: str | None, total: int) -> list[ItemLeido]:
    """Los ítems si cuadran con el total (o le falta poco: propina, servicio)."""
    if _COMPROBANTE.search(texto or ""):
        return []
    items, con_titulos = leer_items(texto)
    if not items or total <= 0:
        return []
    # Un solo «ítem» sin tabla suele ser el monto de un comprobante («Valor $9.806»)
    if len(items) == 1 and not con_titulos:
        return []
    if not items_cuadran([i.total_cop for i in items], total):
        return []
    return items[:60]


def items_cuadran(totales: list[int], total: int) -> bool:
    """Los ítems suman el total, o entre la mitad y el total (lo demás: propina, servicio, impuestos)."""
    suma = sum(totales)
    if total <= 0 or suma <= 0 or any(t > total * 1.02 + 100 for t in totales):
        return False
    return total * 0.5 <= suma <= total * 1.02 + 100
