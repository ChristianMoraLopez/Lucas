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

    Coca Cola Zero 3 2.990 8970         (boletas chilenas: nombre, cantidad,
                                         unitario y total, a veces sin puntos)

    CANT ARTICULO                       (la cantidad primero; el precio a
    6 2X PISCO SOURCATEDR47,700          veces pegado al nombre)

    PRODUCTO CANT TOTAL                 (la cantidad después del nombre y el
    LIMONADA GEN/MENT 3 17.100           total del renglón: 3 limonadas)

    1 UN PIZZA PEPERONI 34,000 36,000   (# CANT UN DESCRIPCION VALOR, con las
    2 1 UN PIZZA GUANCIALE 2 UN COCA…    filas revueltas por el OCR: cada «1 UN»
                                         abre un ítem y los valores van en orden)

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

from .numbers import con_centavos, parse_number, strip_accents

# Plata: con separador de miles (y centavos opcionales), con «$» adelante o
# con centavos («18000.00»)
_PLATA = re.compile(
    r"(?<![\w.,])(\$\s?\d[\d.,]*\d|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{1,3}\s\d{3}[.,]\d{2}|\d{3,7}[.,]\d{2})(?![\d:]|[.,]\d|-\d(?!\d))"
)
# En dólares o bolivianos los precios chicos también llevan centavos: «BURGER 12.50»
_PLATA_CENTAVOS = re.compile(
    r"(?<![\w.,])(\$\s?\d[\d.,]*\d|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{1,3}\s\d{3}[.,]\d{2}|\d{1,7}[.,]\d{2})(?![\d:]|[.,]\d|-\d(?!\d))"
)
# «2 x», «2 ×», «1 X», «1@» al empezar la línea de valores
_POR = re.compile(r"^\s*(\d{1,3})\s*[x×X*@]\s*")
# Nombre, cantidad, unitario y total en la misma línea: «Coca Cola Zero 3 2.990 8970»
# (el total puede venir sin puntos; vale si cantidad × unitario da el total)
_FILA = re.compile(r"\s(\d{1,3})\s+(\$?\s?\d[\d.,]*\d)\s+(\$?\s?\d[\d.,]*\d)\s*$")
# Cantidad con tres decimales al empezar el nombre: «2.000/ PAN…», «1.000 SALSA…»
_CANTIDAD_DECIMAL = re.compile(r"^\s*(\d{1,3})[.,]000\b")
# En tablas que empiezan por la cantidad («CANT ARTICULO»): «2 MISTRAL NOBEL 15,000»
_CANTIDAD_PRIMERO = re.compile(r"^\s*(\d{1,3})\s+(?=\S*[A-Za-zÁÉÍÓÚÑáéíóúñ])")
# El precio pegado al nombre al final de la línea: «PISCO SOURCATEDR47,700»
_PRECIO_PEGADO = re.compile(r"(?<=[A-Za-zÁÉÍÓÚÑáéíóúñ])(?=\d{1,3}(?:[.,]\d{3})+\s*$)")
# En tablas con la cantidad después del nombre («PRODUCTO CANT TOTAL»): «LIMONADA GEN/MENT 3»
_CANTIDAD_AL_FINAL = re.compile(r"(?<=\S)\s+(\d{1,3})\s*$")
# Las palabras que nombran la columna del producto en la fila de títulos
_COLUMNA_NOMBRE = {"producto", "productos", "descripcion", "detalle", "articulo", "nombre", "item"}
_COLUMNA_CANTIDAD = {"cant", "cantidad", "cnt", "ctd", "qty"}
# El NIT del comercio («N.I.T. 830.081.427-9») no es plata
_NIT = re.compile(r"\bN\.?\s?I\.?\s?T\.?\s*[:.]?\s*\d{1,3}(?:[.\s]?\d{3}){2,3}(?:\s*-\s*\d)?", re.IGNORECASE)
# «1 UN», «2 UND», «3 UNID»: la cantidad y la unidad abren un ítem (# CANT UN DESCRIPCION VALOR)
_UNIDAD = re.compile(
    r"(?<![\d.,])(\d{1,3})\s+(?:UN|UND|UNID|UNIDAD|UNIDADES)\.?\s+(?=\S*[A-Za-zÁÉÍÓÚÑáéíóúñ])", re.IGNORECASE
)
# Promociones al empezar el nombre: «2X PISCO SOUR», «2x1 HAMBURGUESA»
_PROMO = re.compile(r"^\d+[xX]\d*\s+")
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
    if con_centavos():
        return parse_number(s)
    # Centavos al final («,00», «.0»): fuera
    if re.search(r"[.,]\d{1,2}$", s):
        s = s[: max(s.rfind("."), s.rfind(","))]
    digitos = re.sub(r"[.,]", "", s)
    return int(digitos) if digitos.isdigit() else None


def _montos(linea: str) -> list[tuple[int, int, int]]:
    """(valor, inicio, fin) de cada monto de la línea."""
    out = []
    nits = [(n.start(), n.end()) for n in _NIT.finditer(linea)]
    for m in (_PLATA_CENTAVOS if con_centavos() else _PLATA).finditer(linea):
        if any(a <= m.start() < b for a, b in nits):
            continue
        v = _plata(m.group(1))
        if v is not None and v >= 50:
            out.append((v, m.start(), m.end()))
    return out


def _fila(linea: str) -> ItemLeido | None:
    """«Coca Cola Zero 3 2.990 8970»: el ítem completo si la cuenta da."""
    m = _FILA.search(linea)
    if not m:
        return None
    cantidad, unitario, total = int(m.group(1)), _plata(m.group(2)), _plata(m.group(3))
    nombre = _letras(linea[: m.start()])
    if not cantidad or not unitario or not total or total < 50 or not re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}", nombre):
        return None
    # Con centavos el unitario puede venir redondeado
    if abs(cantidad * unitario - total) > cantidad:
        return None
    return ItemLeido(_bonito(nombre), float(cantidad), unitario, total)


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
    cantidad_primero = False
    cantidad_al_final = False
    for cruda in (texto or "").splitlines():
        linea = cruda.strip()
        if not linea:
            continue
        if _es_titulo(linea):
            con_titulos = True
            # «CANT ARTICULO …»: cada fila empieza por la cantidad; «PRODUCTO CANT TOTAL»: va después del nombre
            palabras = re.findall(r"[a-z]+", strip_accents(linea).lower())
            cantidad_primero = palabras[0] in _COLUMNA_CANTIDAD
            col_nombre = next((k for k, p in enumerate(palabras) if p in _COLUMNA_NOMBRE), None)
            col_cantidad = next((k for k, p in enumerate(palabras) if p in _COLUMNA_CANTIDAD), None)
            cantidad_al_final = col_nombre is not None and col_cantidad is not None and col_cantidad > col_nombre
            nombre = []
            items = []  # lo de antes de los títulos era el encabezado
            continue
        if _FIN.search(strip_accents(linea)):
            if items:
                break
            nombre = []
            continue
        # «Coca Cola Zero 3 2.990 8970»: todo en la línea. Lo de arriba sin
        # plata eran notas de cocina («12 Spaguetti»), no parte del nombre
        fila = _fila(linea)
        if fila:
            items.append(fila)
            nombre = []
            continue
        # «1.000/ ACEITE…»: ese 1.000 es la cantidad, no plata
        cantidad_inicio = _CANTIDAD_DECIMAL.match(linea)
        resto = linea[cantidad_inicio.end() :] if cantidad_inicio else linea
        montos = _montos(resto)
        if not montos and con_titulos and _PRECIO_PEGADO.search(resto):
            resto = _PRECIO_PEGADO.sub(" ", resto, count=1)
            montos = _montos(resto)
        if not montos:
            nombre = [*nombre[-1:], linea]  # un nombre ocupa a lo sumo dos renglones
            continue

        # Una línea con plata: cierra un ítem. Su nombre es lo que va antes del
        # primer monto («CAMISETA 23.800 47.600»; lo de después es el código del IVA)
        por = _POR.match(resto)
        cantidad_fila = None if por or cantidad_inicio or not cantidad_primero else _CANTIDAD_PRIMERO.match(resto)
        desde = por.end() if por else cantidad_fila.end() if cantidad_fila else 0
        antes_del_monto = resto[desde : montos[0][1]].strip()
        # «LIMONADA GEN/MENT 3 17.100» con la cantidad después del nombre: ese 3 es la cantidad
        cantidad_final = (
            None
            if por or cantidad_fila or cantidad_inicio or not cantidad_al_final
            else _CANTIDAD_AL_FINAL.search(antes_del_monto)
        )
        if cantidad_final:
            antes_del_monto = antes_del_monto[: cantidad_final.start()]
        texto_linea = _letras(_PROMO.sub("", antes_del_monto))
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
        elif cantidad_fila and int(cantidad_fila.group(1)) > 0:
            cantidad = float(cantidad_fila.group(1))
        elif cantidad_final and int(cantidad_final.group(1)) > 0:
            cantidad = float(cantidad_final.group(1))
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


def leer_por_unidades(texto: str | None) -> list[ItemLeido]:
    """
    «# CANT UN DESCRIPCION VALOR» con las filas revueltas por el OCR:

        1 UN PIZZA PEPEPRONI 34,000.00 36,000.00
        2 1 UN PIZZA GUANCIALE 2 UN COCA COLA ZERO 15,000.00
        3 1 UN COCA COLA NORMAL 7,500.00

    Cada «1 UN» abre un ítem (cantidad y nombre) y los valores, en orden, son
    los de cada uno: uno por ítem (el del renglón) o dos (unitario y total).
    Si no son tantos como los ítems, no hay ítems.
    """
    lineas = [ln.strip() for ln in (texto or "").splitlines() if ln.strip()]
    inicio = next((k for k, ln in enumerate(lineas) if _UNIDAD.search(ln)), None)
    if inicio is None:
        return []
    bloque: list[str] = []
    for ln in lineas[inicio:]:
        if _FIN.search(strip_accents(ln)):
            break
        bloque.append(ln)
    junto = " ".join(bloque)
    marcas = list(_UNIDAD.finditer(junto))
    if len(marcas) < 2:
        return []
    montos = [v for v, *_ in _montos(junto[marcas[0].end() :])]
    n = len(marcas)
    # El total del recibo impreso al final de la tabla («$92,500.00») no es un ítem
    if len(montos) in {n + 1, 2 * n + 1} and abs(montos[-1] - sum(montos[-1 - n : -1])) <= n:
        montos = montos[:-1]
    if len(montos) == n:
        totales: list[int] = montos
        unitarios: list[int | None] = [None] * n
    elif len(montos) == 2 * n:
        unitarios, totales = list(montos[0::2]), montos[1::2]
    else:
        return []

    items = []
    for k, marca in enumerate(marcas):
        fin = marcas[k + 1].start() if k + 1 < n else len(junto)
        pedazo = junto[marca.end() : fin]
        for _, a, b in reversed(_montos(pedazo)):
            pedazo = pedazo[:a] + " " + pedazo[b:]
        # El número de la fila que sigue («… COCA COLA ZERO 3»)
        pedazo = re.sub(r"(\s+\d{1,2})+\s*$", "", pedazo)
        nombre = _bonito(_letras(pedazo))
        if not re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}", nombre):
            return []
        cantidad = float(marca.group(1)) or 1.0
        unitario = unitarios[k] or round(totales[k] / cantidad)
        items.append(ItemLeido(nombre, cantidad, unitario, totales[k]))
    return items


def items_del_recibo(texto: str | None, total: int) -> list[ItemLeido]:
    """Los ítems si cuadran con el total (o le falta poco: propina, servicio)."""
    if _COMPROBANTE.search(texto or "") or total <= 0:
        return []
    candidatos = []
    items, con_titulos = leer_items(texto)
    # Un solo «ítem» sin tabla suele ser el monto de un comprobante («Valor $9.806»)
    if items and (len(items) > 1 or con_titulos):
        candidatos.append(items)
    if por_unidades := leer_por_unidades(texto):
        candidatos.append(por_unidades)
    candidatos = [c for c in candidatos if items_cuadran([i.total_cop for i in c], total)]
    if not candidatos:
        return []
    # Si las dos lecturas cuadran, la que más se acerca al total
    mejor = min(candidatos, key=lambda c: abs(total - sum(i.total_cop for i in c)))
    return mejor[:60]


def items_cuadran(totales: list[int], total: int) -> bool:
    """Los ítems suman el total, o entre la mitad y el total (lo demás: propina, servicio, impuestos)."""
    suma = sum(totales)
    if total <= 0 or suma <= 0 or any(t > total * 1.02 + 100 for t in totales):
        return False
    return total * 0.5 <= suma <= total * 1.02 + 100
