"""Tasas de cambio para los recibos en otra moneda.

Un recibo de Chile en una cuenta en pesos colombianos se guarda en pesos
colombianos, con la tasa del día del recibo (no la de hoy: un chat importado
trae gastos de hace meses). El recibo original queda en el gasto (moneda,
monto y tasa) y en la app se ve y se corrige.

Las tasas salen de currency-api (github.com/fawazahmed0/exchange-api): gratis,
sin llave, una tabla por día desde marzo de 2024, con COP, CLP, BOB, USD y las
demás. Se piden por jsDelivr y, si falla, por su espejo en Cloudflare. Si el
día no está (muy viejo, o el de hoy todavía no sale), se usa la más reciente.
Si no responde ninguna, el trabajo se reintenta más tarde.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

import httpx

from .errors import RetryableError
from .extract.numbers import decimales

log = logging.getLogger(__name__)

FUENTES = (
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{dia}/v1/currencies/{de}.min.json",
    "https://{dia}.currency-api.pages.dev/v1/currencies/{de}.min.json",
)
FUENTE = "currency-api"
# La tabla «latest» cambia una vez al día: con unas horas en caché basta
_LATEST_DURA_S = 6 * 3600


class CambioNoDisponible(RetryableError):
    """No se pudo saber la tasa (la red o el servicio): se reintenta más tarde."""


@dataclass(frozen=True)
class Tasa:
    de: str
    a: str
    valor: Decimal  # cuántas unidades de `a` vale una de `de`
    dia: date  # el día de la tabla que se usó
    fuente: str


def convertir(monto: int, de: str, a: str, tasa: Decimal) -> int:
    """Un monto en la unidad chica de `de` (pesos o centavos) → la unidad chica de `a`."""
    exacto = Decimal(monto) / (10 ** decimales(de)) * tasa * (10 ** decimales(a))
    return int(exacto.quantize(Decimal(1), rounding=ROUND_HALF_UP))


class Cambio:
    def __init__(self, client: httpx.Client | None = None, *, timeout: float = 10.0):
        self.http = client or httpx.Client(timeout=timeout, follow_redirects=True)
        # (moneda, día o «latest») → (fecha de la tabla, tasas, cuándo se pidió)
        self._tablas: dict[tuple[str, str], tuple[date, dict[str, Any], float]] = {}

    def tasa(self, de: str, a: str, dia: date, hoy: date) -> Tasa:
        de, a = de.upper(), a.upper()
        if de == a:
            return Tasa(de, a, Decimal(1), dia, "igual")
        dia = min(dia, hoy)
        for etiqueta in (dia.isoformat(), "latest"):
            tabla = self._tabla(de, etiqueta)
            if tabla is None:
                continue
            fecha, tasas, _ = tabla
            valor = _decimal(tasas.get(a.lower()))
            if valor is not None:
                return Tasa(de, a, valor, fecha, FUENTE)
        raise CambioNoDisponible(f"No encontramos la tasa de {de} a {a}")

    def _tabla(self, de: str, etiqueta: str) -> tuple[date, dict[str, Any], float] | None:
        clave = (de, etiqueta)
        guardada = self._tablas.get(clave)
        if guardada and (etiqueta != "latest" or time.time() - guardada[2] < _LATEST_DURA_S):
            return guardada
        no_esta = False
        for plantilla in FUENTES:
            url = plantilla.format(dia=etiqueta, de=de.lower())
            try:
                r = self.http.get(url)
            except httpx.HTTPError as e:
                log.warning("Las tasas no respondieron (%s): %s", url.split("/")[2], e)
                continue
            if r.status_code == 404:
                no_esta = True
                continue
            if r.status_code != 200:
                log.warning("Las tasas respondieron %s (%s)", r.status_code, url.split("/")[2])
                continue
            try:
                cuerpo = r.json()
                fecha = date.fromisoformat(str(cuerpo["date"])[:10])
                tasas = cuerpo[de.lower()]
            except (ValueError, KeyError, TypeError):
                log.warning("Las tasas llegaron raras (%s)", url.split("/")[2])
                continue
            if not isinstance(tasas, dict):
                continue
            tabla = (fecha, tasas, time.time())
            self._tablas[clave] = tabla
            return tabla
        if no_esta:
            return None  # ese día no está: se prueba con la más reciente
        raise CambioNoDisponible(f"Las tasas de cambio no respondieron ({de}, {etiqueta})")


def _decimal(v: Any) -> Decimal | None:
    if isinstance(v, bool) or not isinstance(v, int | float | str):
        return None
    try:
        d = Decimal(str(v))
    except InvalidOperation:
        return None
    return d if d.is_finite() and d > 0 else None
