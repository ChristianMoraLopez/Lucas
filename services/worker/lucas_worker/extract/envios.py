"""El pantallazo de una transferencia a una persona (Nu, Bre-B, Nequi, Daviplata,
Bancolombia): cuánto y a quién.

    X Bre-B|nu
    Listo! Enviaste tu dinero
    $48.750
    Para Chr****** Rey** Mor*** Lop**
    Más impuesto del gobierno 4x1000
    $195

Si quien recibe es de la cuenta, es un pago entre ellos («ya pagué mi amor
❤️»), no un gasto: lo decide worker_pago_con_comprobante. Del nombre solo se
ve el principio de cada palabra (el banco tapa el resto): «Chr****** Rey**» →
[«chr», «rey»]. Una compra con la tarjeta («Pagaste en Comercio Surticarnes»)
no es un envío.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .numbers import find_amounts, strip_accents

# «Enviaste tu dinero», «Envío realizado», «Transferencia exitosa», «Le transferiste»…
_ENVIO = re.compile(
    r"\benviaste\b|\benvio\s+(?:realizado|exitoso)\b|\btransferencia\s+(?:exitosa|realizada|enviada)\b|\btransferiste\b"
    r"|\bdinero\s+enviado\b|\bpago\s+enviado\b|\byou\s+sent\b|\bmoney\s+sent\b",
    re.IGNORECASE,
)
# A quién: «Para Chr****** Rey**», «Destinatario: …», «Enviado a …»
_PARA = re.compile(
    r"^\s*(?:para|destinatario|beneficiario|enviado\s+a|a\s+nombre\s+de|nombre\s+del\s+destinatario|to)\b\s*:?\s*(.*)$",
    re.IGNORECASE,
)
# Palabras que no son del nombre
_NO_NOMBRE = {"de", "del", "la", "las", "los", "el", "y", "cuenta", "llave", "numero", "celular", "nequi", "bre", "b"}


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


def envio_a_persona(texto: str | None) -> Envio | None:
    """El monto y a quién, si el pantallazo es de una transferencia; si no, None."""
    lineas = [ln.strip() for ln in (texto or "").splitlines() if ln.strip()]
    inicio = next((k for k, ln in enumerate(lineas) if _ENVIO.search(strip_accents(ln))), None)
    if inicio is None:
        return None

    # El monto: el primero con forma de plata desde «Enviaste…» (después viene el 4x1000 o el saldo)
    monto = None
    for ln in lineas[inicio:]:
        if re.search(r"4\s?x\s?1000|impuesto|costo|comision|saldo", strip_accents(ln), re.IGNORECASE):
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
