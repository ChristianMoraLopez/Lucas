"""El pantallazo de una transferencia a una persona (Nu, Bre-B, Nequi, Daviplata,
Bancolombia): cuánto y a quién.

    X Bre-B|nu
    Listo! Enviaste tu dinero
    $48.750
    Para Chr****** Rey** Mor*** Lop**
    Más impuesto del gobierno 4x1000
    $195

    NU
    Comprobante de
    transferencia
    Monto total $9.800,00
    Para
    Nombre Christian Rey Mora Lopez

    Envío exitoso!
    Destino: Christian Rey Mora Lopez
    Valor: $ 9.800,00

Si quien recibe es de la cuenta, es un pago entre ellos («ya pagué mi amor
❤️»), no un gasto: lo decide worker_pago_con_comprobante. Del nombre solo se
ve el principio de cada palabra (el banco tapa el resto): «Chr****** Rey**» →
[«chr», «rey»]. Una compra con la tarjeta («Pagaste en Comercio Surticarnes»)
no es un envío.

parece_comprobante: lo que tiene cara de transferencia aunque no se sepa leer
del todo (otro banco, otro formato); montos_del_comprobante, los montos que
podría ser (para ver si es justo lo que debía quien lo mandó).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .numbers import find_amounts, strip_accents

# «Enviaste tu dinero», «Envío realizado», «Transferencia exitosa», «Le transferiste»,
# «Comprobante de transferencia» (Nu, que lo parte en dos líneas)…
_ENVIO = re.compile(
    r"\benviaste\b|\benvio\s+(?:realizado|exitoso)\b|\btransferencia\s+(?:exitosa|realizada|enviada|aprobada|completada)\b"
    r"|\btransferiste\b|\bcomprobante\s+de\s+(?:la\s+)?(?:transferencia|envio)\b"
    r"|\bdinero\s+enviado\b|\bpago\s+enviado\b|\byou\s+sent\b|\bmoney\s+sent\b",
    re.IGNORECASE,
)
# Una compra (con la tarjeta, el QR o el datáfono de un comercio) no es un envío a una persona
_COMPRA = re.compile(
    r"\bpagaste\s+en\b|\bcompra\s+(?:con|en)\b|\bcomercio\b|\bestablecimiento\b|\bdatafono\b|\btarjeta\s+(?:virtual|debito|credito)\b",
    re.IGNORECASE,
)
# Algo de transferencia, aunque no se sepa leer del todo
_PARECE = re.compile(
    r"\btransferencia\b|\btransferiste\b|\benvio\b|\benviaste\b|\bbre-?\s?b\b|\bllave\b|\bdestinatario\b"
    r"|\bcuenta\s+destino\b|\bnequi\b|\bdaviplata\b|\btransfiya\b",
    re.IGNORECASE,
)
# A quién: «Para Chr****** Rey**», «Destinatario: …», «Enviado a …», «Destino: Christian…»
_PARA = re.compile(
    r"^\s*(?:para|destinatario|beneficiario|destino|enviado\s+a|a\s+nombre\s+de|nombre\s+del\s+destinatario|to)\b\s*:?\s*(.*)$",
    re.IGNORECASE,
)
# Palabras que no son del nombre («Para / Nombre Christian…» de Nu)
_NO_NOMBRE = {
    "de", "del", "la", "las", "los", "el", "y", "cuenta", "llave", "numero", "celular", "nequi", "bre", "b",
    "nombre", "ahorros", "corriente", "producto",
}  # fmt: skip
# Lo que no es lo que se envió: el 4x1000, la comisión, el saldo, los códigos
_NO_MONTO = re.compile(
    r"4\s?x\s?1\.?000|impuesto|costo|comision|saldo|nit\b|\bid\b|numero|referencia|comprobante|confirmacion|cuenta",
    re.IGNORECASE,
)


@dataclass
class Envio:
    monto: int
    # Lo que se ve de cada palabra del nombre de quien recibe, en minúsculas y sin tildes
    para: list[str]


def _vistos(nombre: str) -> list[str]:
    """«Chr****** Rey** Mor*** Lop**» → ['chr', 'rey', 'mor', 'lop']"""
    out = []
    for palabra in nombre.split():
        visto = re.match(r"[^\W\d_]+", strip_accents(palabra).lower())
        if visto and len(visto.group(0)) >= 2 and visto.group(0) not in _NO_NOMBRE:
            out.append(visto.group(0))
    return out[:4]


def _lineas(texto: str | None) -> list[str]:
    return [ln.strip() for ln in (texto or "").splitlines() if ln.strip()]


def _es_compra(lineas: list[str]) -> bool:
    return any(_COMPRA.search(strip_accents(ln)) for ln in lineas)


def envio_a_persona(texto: str | None) -> Envio | None:
    """El monto y a quién, si el pantallazo es de una transferencia; si no, None."""
    lineas = _lineas(texto)
    if _es_compra(lineas):
        return None
    # Cada línea con la siguiente: «Comprobante de» / «transferencia»
    pares = (f"{ln} {lineas[k + 1] if k + 1 < len(lineas) else ''}" for k, ln in enumerate(lineas))
    inicio = next((k for k, par in enumerate(pares) if _ENVIO.search(strip_accents(par))), None)
    if inicio is None:
        return None

    # El monto: el primero con forma de plata desde «Enviaste…» (después viene el 4x1000 o el saldo)
    monto = None
    for ln in lineas[inicio:]:
        if re.search(r"4\s?x\s?1\.?000|impuesto|costo|comision|saldo", strip_accents(ln), re.IGNORECASE):
            continue
        valores = [v for v in find_amounts(ln) if v >= 100]
        if valores and ("$" in ln or not re.search(r"[^\W\d_]{3,}", ln)):
            monto = valores[0]
            break
    if not monto:
        return None

    para: list[str] = []
    for k, ln in enumerate(lineas):
        if m := _PARA.match(strip_accents(ln)):
            resto = ln[len(ln) - len(m.group(1)) :] if m.group(1) else ""
            # «Para» solo en su línea: el nombre va en la siguiente
            nombre = resto or (lineas[k + 1] if k + 1 < len(lineas) else "")
            if not find_amounts(nombre) or re.search(r"[^\W\d_]{2,}", nombre):
                para = _vistos(nombre)
            if para:
                break
    return Envio(monto, para)


def parece_comprobante(texto: str | None) -> bool:
    """¿Tiene cara de comprobante de transferencia (y no de una compra)?"""
    lineas = _lineas(texto)
    return bool(lineas) and not _es_compra(lineas) and any(_PARECE.search(strip_accents(ln)) for ln in lineas)


def montos_del_comprobante(texto: str | None, maximo: int = 4) -> list[int]:
    """Los montos que podría ser lo enviado, en orden y sin repetir (sin el 4x1000, el saldo ni los códigos)."""
    out: list[int] = []
    for ln in _lineas(texto):
        plano = strip_accents(ln)
        if _NO_MONTO.search(plano):
            continue
        # Con «$», o una línea que es solo el número (los códigos largos no son plata)
        if "$" not in ln and re.search(r"[^\W\d_]{3,}", ln):
            continue
        for v in find_amounts(ln):
            if 100 <= v <= 50_000_000 and v not in out:
                out.append(v)
    return out[:maximo]
