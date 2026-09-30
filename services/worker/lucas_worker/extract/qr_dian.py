"""QR de la factura electrónica DIAN (y del documento equivalente POS).

El QR trae, según el anexo técnico, algo así (con «:» o «=», en líneas o
seguido):

    NumFac: SETP990000002
    FecFac: 2026-09-26
    HorFac: 08:14:00-05:00
    NitFac: 900123456
    DocAdq: 1020304050
    ValFac: 9495.80
    ValIva: 1804.20
    ValOtroIm: 0.00
    ValTolFac: 11300.00
    CUFE: 3f5a…(96 hex)
    QRCode: https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=3f5a…

Hay emisores que solo ponen la URL con el `documentkey`. El CUFE (o CUDE en
el POS) es un SHA-384: 96 caracteres hexadecimales, único por factura.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date

import numpy as np

from .numbers import parse_number

log = logging.getLogger(__name__)

_LLAVES = (
    "NumFac", "NumDS", "FecFac", "FecDS", "HorFac", "HorDS", "NitFac", "NitOFE", "NumAdq", "DocAdq",
    "ValFac", "ValDS", "ValIva", "ValOtroIm", "ValTolFac", "ValTotFac", "ValTolDS", "CUFE", "CUDE", "CUDS", "QRCode",
)  # fmt: skip
_PAR = re.compile(
    r"\b(" + "|".join(_LLAVES) + r")\s*[:=]\s*(.*?)(?=\s*\b(?:" + "|".join(_LLAVES) + r")\s*[:=]|$)", re.S
)
_DOCUMENTKEY = re.compile(r"documentkey=([0-9a-fA-F]{96})", re.IGNORECASE)
_HEX96 = re.compile(r"^[0-9a-fA-F]{96}$")


@dataclass
class DianQr:
    raw: str
    cufe: str | None = None
    number: str | None = None
    issued_on: date | None = None
    issued_at: str | None = None
    nit: str | None = None
    buyer_doc: str | None = None
    subtotal: int | None = None
    tax: int | None = None
    other_taxes: int | None = None
    total: int | None = None
    url: str | None = None

    @property
    def useful(self) -> bool:
        return bool(self.cufe or self.total)


def _monto(v: str | None) -> int | None:
    if not v:
        return None
    # En el QR los valores van con punto decimal y sin miles: «11300.00»
    v = v.strip().split()[0] if v.strip() else ""
    return parse_number(v)


def parse_dian_qr(text: str | None) -> DianQr | None:
    """Lee el contenido del QR. None si no parece de la DIAN."""
    if not text:
        return None
    raw = text.strip()
    campos: dict[str, str] = {}
    for m in _PAR.finditer(raw):
        campos.setdefault(m.group(1).lower(), m.group(2).strip())
    llave = _DOCUMENTKEY.search(raw)
    if not campos and not llave:
        return None

    cufe = campos.get("cufe") or campos.get("cude") or campos.get("cuds")
    if cufe:
        cufe = cufe.split()[0]
    if (not cufe or not _HEX96.match(cufe)) and llave:
        cufe = llave.group(1)
    if cufe and not _HEX96.match(cufe):
        cufe = None

    fecha = None
    if f := campos.get("fecfac") or campos.get("fecds"):
        try:
            fecha = date.fromisoformat(f.split()[0][:10])
        except ValueError:
            fecha = None

    url = campos.get("qrcode")
    if not url and (u := re.search(r"https?://\S+", raw)):
        url = u.group(0)

    numero = campos.get("numfac") or campos.get("numds")
    qr = DianQr(
        raw=raw[:2000],
        cufe=cufe.lower() if cufe else None,
        number=numero.split()[0] if numero else None,
        issued_on=fecha,
        issued_at=(campos.get("horfac") or campos.get("hords") or None),
        nit=re.sub(r"\D", "", campos.get("nitfac") or campos.get("nitofe") or "") or None,
        buyer_doc=(campos.get("docadq") or campos.get("numadq") or None),
        subtotal=_monto(campos.get("valfac") or campos.get("valds")),
        tax=_monto(campos.get("valiva")),
        other_taxes=_monto(campos.get("valotroim")),
        total=_monto(campos.get("valtolfac") or campos.get("valtotfac") or campos.get("valtolds")),
        url=url,
    )
    return qr if qr.useful else None


def read_qr_texts(images: list[np.ndarray]) -> list[str]:
    """Textos de todos los QR que zxing-cpp encuentre en las imágenes (sin repetir)."""
    import zxingcpp

    textos: list[str] = []
    for img in images:
        try:
            resultados = zxingcpp.read_barcodes(img, formats=zxingcpp.BarcodeFormat.QRCode)
        except Exception as e:  # imagen rara: no es motivo para tumbar el trabajo
            log.debug("zxing no pudo leer la imagen: %s", e)
            continue
        for r in resultados:
            if r.valid and r.text and r.text not in textos:
                textos.append(r.text)
        if textos:
            break  # con encontrarlo en una variante basta
    return textos


def find_dian_qr(images: list[np.ndarray]) -> DianQr | None:
    for texto in read_qr_texts(images):
        if qr := parse_dian_qr(texto):
            return qr
    return None
