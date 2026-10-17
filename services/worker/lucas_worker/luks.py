"""Lo que hace Luks no es un gasto.

Las cuentas y los cobros que se mandan desde Liquidar llevan la firma «Esto se
hizo en mrluks.com» y el link /r/TOKEN; la imagen de ese link (o un pantallazo
de Liquidar) dice «¿Quién le paga a quién?». Las respuestas de Luks en el grupo
son «✅ Anotado: Hielo · $8.000», y Mister Luks saluda con «Soy Mister Luks…».
Sus respuestas a las preguntas firman «Más detalle en mrluks.com». La base y el
connector revisan lo mismo (public.es_mensaje_de_luks, migraciones 180, 290, 340,
350 y 370, y services/connector/src/text.ts).
"""

from __future__ import annotations

import re

_FIRMA = re.compile(
    r"esto se hizo en mrluks\.com|made with mrluks\.com|cuentas hechas con luks|hecho con luks"
    r"|(?:mrluks\.com|\.vercel\.app)/r/[A-Za-z0-9_-]{20,64}",
    re.IGNORECASE,
)
_RESPUESTA = re.compile(
    r"^\s*\W{0,4}\s*(?:anotad[oa]s?|recibido|ya estaba anotado|logged|received|already logged)"
    r"[\s:].*·\s*(?:\$|bs\s?)\d",
    re.IGNORECASE | re.DOTALL,
)
# Los saludos de Mister Luks y el «Listo: este grupo quedó conectado…» traen montos de ejemplo
_SALUDO = re.compile(
    r"(?:soy|i[’']m) \*?mister luks"
    r"|(?:listo[:!]?|done[:!]?)\s*(?:este grupo quedó conectado|this group is now connected)"
    # Los avisos de la fase 6: quién decidió desde cuándo anotar y el chat importado
    r"|dijo que (?:anote|lea)\b|said to (?:log|read)\b|le[ií] el chat exportado|i read the exported chat"
    # Las respuestas a las preguntas (fase 7) firman así
    r"|m[aá]s detalle en mrluks\.com|more detail at mrluks\.com"
    # El aviso de la cuenta siguiente: la anterior ya estaba liquidada (migración 370)
    r"|ya estaba liquidada|was already settled",
    re.IGNORECASE,
)
# En una imagen el OCR no siempre lee bien la firma: basta la marca con algo de las cuentas
_MARCA = re.compile(r"mr\s*luks", re.IGNORECASE)
_CUENTAS = re.compile(r"qui[eé]n le paga a qui[eé]n|gastaron|te toca|le paga a", re.IGNORECASE)


def es_mensaje_de_luks(texto: str | None) -> bool:
    """Un mensaje escrito por Luks o mandado desde Luks (las cuentas, un cobro, una respuesta)."""
    if not texto:
        return False
    return bool(_FIRMA.search(texto) or _RESPUESTA.search(texto) or _SALUDO.search(texto))


def es_imagen_de_luks(texto: str | None) -> bool:
    """Lo que leyó el OCR de una foto o un PDF: ¿es la imagen de las cuentas de Luks?"""
    if not texto:
        return False
    return es_mensaje_de_luks(texto) or bool(_MARCA.search(texto) and _CUENTAS.search(texto))
