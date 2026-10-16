"""¿En qué moneda está el recibo?

Quien viaja manda recibos de otro país a una cuenta en pesos: una boleta de
Santiago dice «$15.990» igual que una factura de Bogotá. Lo que las separa es
lo que trae el papel alrededor del monto: el RUT y el SII en Chile; la DIAN, el
CUFE y el NIT en Colombia; «Bs» en Bolivia; «US$», «€», «R$», «S/»…

Primero manda el mensaje: si quien lo mandó escribió la moneda («25.990
CLP», «20 dólares», «pesos chilenos»), es esa. Si no, se suman las señales del
documento y gana la moneda que tenga una señal fuerte y le saque ventaja a la
segunda. Si nada es claro, es la moneda de la cuenta, como siempre (y en la
app se cambia con un toque).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .numbers import strip_accents


@dataclass(frozen=True)
class Deteccion:
    moneda: str
    razon: str  # «el mensaje dice CLP», «RUT chileno · SII»


# Lo que alguien escribe en el mensaje (en minúsculas y sin tildes)
_EN_EL_MENSAJE: dict[str, re.Pattern[str]] = {
    moneda: re.compile(patron)
    for moneda, patron in {
        "CLP": r"\bclp\b|\bpesos?\s+chilen[oa]s?\b|\bchilen[oa]s\b|\blucas?\s+chilenas?\b",
        "COP": r"\bcop\b|\bpesos?\s+colombian[oa]s?\b",
        "USD": r"\busd\b|\bus\s?\$|\bu\$s\b|\bdolar(?:es)?\b|\bdollars?\b|\bbucks\b",
        "BOB": r"\bbob\b|\bbolivian[oa]s\b|\bbs\.?\s?\d",
        "EUR": r"€|\beur\b|\beuros?\b",
        "PEN": r"\bsoles\b|\bs/\.?\s?\d",
        "MXN": r"\bmxn\b|\bpesos?\s+mexican[oa]s?\b",
        "ARS": r"\bars\b|\bpesos?\s+argentin[oa]s?\b",
        "BRL": r"\bbrl\b|\br\$|\breais\b|\breales\b",
    }.items()
}

# Las señales del documento (en mayúsculas y sin tildes): moneda, puntos y qué es.
# 3 = basta sola (un documento tributario, un código de moneda); 2 = necesita
# otra (el nombre de un país también es una avenida o un plato: «chile relleno»).
_EN_EL_DOCUMENTO: list[tuple[str, int, re.Pattern[str], str]] = [
    (moneda, puntos, re.compile(patron), razon)
    for moneda, puntos, patron, razon in [
        # Chile
        ("CLP", 3, r"\bR\.?\s?U\.?\s?T\.?\s*:?\s*\d{1,2}\.?\d{3}\.?\d{3}\s?-\s?[\dK]\b", "RUT chileno"),
        ("CLP", 3, r"\bS\.\s?I\.\s?I\.?|\bSII\b", "SII"),
        ("CLP", 3, r"\bBOLETA\s+ELECTRONICA\b|\bTIMBRE\s+ELECTRONICO\b", "boleta electrónica"),
        ("CLP", 3, r"\bTRANSBANK\b|\bWEBPAY\b|\bREDCOMPRA\b|\bBANCOESTADO\b|\bCUENTA\s?RUT\b", "pago en Chile"),
        ("CLP", 3, r"\bCLP\b", "dice CLP"),
        ("CLP", 2, r"\bCHILE\b|\bVALPARAISO\b|\bVINA\s+DEL\s+MAR\b|\bLAS\s+CONDES\b|\bPUNTA\s+ARENAS\b", "Chile"),
        # Colombia
        ("COP", 3, r"\bDIAN\b|\bCUFE\b|\bFACTURA\s+ELECTRONICA\s+DE\s+VENTA\b", "DIAN"),
        ("COP", 3, r"\bN\.?\s?I\.?\s?T\.?\s*:?\s*\d{3}\.?\d{3}\.?\d{3}\s?-\s?\d\b", "NIT colombiano"),
        ("COP", 3, r"\bNEQUI\b|\bBANCOLOMBIA\b|\bDAVIPLATA\b|\bDAVIVIENDA\b|\bBANCO\s+DE\s+BOGOTA\b", "banco"),
        ("COP", 3, r"\bCOP\b", "dice COP"),
        ("COP", 2, r"\bCOLOMBIA\b|\bBOGOTA\b|\bMEDELLIN\b|\bBARRANQUILLA\b|\bBUCARAMANGA\b", "Colombia"),
        # Bolivia
        ("BOB", 3, r"\bIMPUESTOS\s+NACIONALES\b|\bCODIGO\s+DE\s+CONTROL\b", "impuestos de Bolivia"),
        ("BOB", 3, r"\bBS\.?\s?\d|\bBOB\b|\bBOLIVIANOS\b", "Bs"),
        ("BOB", 2, r"\bBOLIVIA\b", "Bolivia"),
        # Perú
        ("PEN", 3, r"\bSUNAT\b|\bS/\.?\s?\d|\bSOLES\b", "S/ o SUNAT"),
        ("PEN", 2, r"\bPERU\b", "Perú"),
        # México
        ("MXN", 3, r"\bCFDI\b|\bMXN\b", "CFDI"),
        ("MXN", 2, r"\bR\.?\s?F\.?\s?C\.?\s*:|\bMEXICO\b", "México"),
        # Argentina
        ("ARS", 3, r"\bCUIT\b|\bAFIP\b|\bRESPONSABLE\s+INSCRIPTO\b|\bARS\b", "CUIT o AFIP"),
        ("ARS", 2, r"\bARGENTINA\b", "Argentina"),
        # Brasil
        ("BRL", 3, r"\bCNPJ\b|\bCPF\b|\bR\$|\bNFC-?E\b|\bSEFAZ\b|\bBRL\b", "CNPJ o R$"),
        ("BRL", 2, r"\bBRASIL\b", "Brasil"),
        # Dólares
        ("USD", 3, r"\bUS\s?\$|\bUSD\b|\bU\$S\b", "dice USD"),
        ("USD", 2, r"\bSALES\s+TAX\b|\bECUADOR\b", "Estados Unidos o Ecuador"),
        # Euros
        ("EUR", 3, r"€|\bEUR\b|\bEUROS?\b", "€"),
        ("EUR", 2, r"\bESPANA\b", "España"),
    ]
]

# Una señal fuerte, y dos puntos de ventaja sobre la segunda
_MINIMO = 3
_VENTAJA = 2


def _del_mensaje(texto: str | None) -> Deteccion | None:
    t = strip_accents(texto or "").lower()
    if not t:
        return None
    dichas = [moneda for moneda, patron in _EN_EL_MENSAJE.items() if patron.search(t)]
    return Deteccion(dichas[0], f"el mensaje dice {dichas[0]}") if len(dichas) == 1 else None


def _del_documento(texto: str | None, qr_dian: bool) -> Deteccion | None:
    t = strip_accents(texto or "").upper()
    puntos: dict[str, int] = {}
    razones: dict[str, list[str]] = {}
    if qr_dian:
        puntos["COP"] = 3
        razones["COP"] = ["QR de la DIAN"]
    for moneda, valor, patron, razon in _EN_EL_DOCUMENTO:
        if t and patron.search(t):
            puntos[moneda] = puntos.get(moneda, 0) + valor
            razones.setdefault(moneda, []).append(razon)
    if not puntos:
        return None
    orden = sorted(puntos.items(), key=lambda x: -x[1])
    primera, n = orden[0]
    segunda = orden[1][1] if len(orden) > 1 else 0
    if n < _MINIMO or n - segunda < _VENTAJA:
        return None
    return Deteccion(primera, " · ".join(razones[primera]))


def detectar_moneda(
    *,
    documento: str | None,
    mensaje: str | None,
    cuenta: str,
    qr_dian: bool = False,
) -> Deteccion | None:
    """
    La moneda del recibo si es otra que la de la cuenta (y hay cómo saberlo);
    None si es la de la cuenta o no se sabe.
    """
    d = _del_mensaje(mensaje) or _del_documento(documento, qr_dian)
    if d is None or d.moneda == (cuenta or "COP").upper():
        return None
    return d
