"""Leer el chat que da «Exportar chat» de WhatsApp.

El archivo cambia según el teléfono y el idioma:

    Android, español   25/09/26, 10:11 a. m. - Vale: taxi 45 lucas
    Android, inglés    9/25/26, 10:11 AM - Vale: taxi $45
    iPhone, español    [25/09/26, 10:11:12] Vale: taxi 45 lucas
    iPhone, inglés     [9/25/26, 10:11:12 AM] Vale: taxi $45

Un mensaje de varias líneas sigue en las líneas que no empiezan con fecha.
Los archivos adjuntos vienen como «IMG-20260925-WA0003.jpg (archivo adjunto)»
(Android) o «<adjunto: 00000012-PHOTO-2026-09-25-10-11-12.jpg>» (iPhone), y si
se exportó sin archivos, «<Multimedia omitido>» o «imagen omitida». Los
mensajes del sistema («Vale añadió a Santi», «Los mensajes están cifrados…»)
no traen «Nombre:» (en iPhone traen un «‎» invisible) y no se leen.

El orden día/mes se decide con todo el archivo: si algún primer número pasa de
12, es día/mes; si algún segundo número pasa de 12, mes/día; si no se puede
saber, día/mes salvo que la hora venga con AM/PM en inglés (Estados Unidos).
Las horas son de Bogotá, como el resto de Luks.
"""

from __future__ import annotations

import io
import re
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

BOGOTA = timezone(timedelta(hours=-5), "America/Bogota")

# Marcas invisibles de dirección del texto (iPhone las pone antes de lo del sistema y de los adjuntos)
_INVISIBLES = re.compile("[‎‏‪-‮⁦-⁩﻿]")
_ESPACIOS = re.compile("[   ]")

_FECHA = r"(?P<a>\d{1,2})[/.-](?P<b>\d{1,2})[/.-](?P<y>\d{2,4})"
_HORA = r"(?P<h>\d{1,2}):(?P<m>\d{2})(?::(?P<s>\d{2}))?(?:\s*(?P<ampm>[ap]\.?\s?m\.?))?"
_IPHONE = re.compile(rf"^\[{_FECHA},?\s+{_HORA}\]\s+(?P<resto>.*)$", re.IGNORECASE)
_ANDROID = re.compile(rf"^{_FECHA},?\s+{_HORA}\s+[-–]\s+(?P<resto>.*)$", re.IGNORECASE)
_QUIEN = re.compile(r"^(?P<quien>[^:]{1,80}?):\s(?P<texto>.*)$", re.DOTALL)

_ADJUNTO_IPHONE = re.compile(r"<(?:attached|adjunto|archivo adjunto):\s*(?P<archivo>[^>]+?)\s*>", re.IGNORECASE)
_ADJUNTO_ANDROID = re.compile(
    r"^(?P<archivo>[^\n<>]+?\.[A-Za-z0-9]{2,5})\s+\((?:file attached|archivo adjunto)\)", re.IGNORECASE
)
_OMITIDO = re.compile(
    r"^\s*(?:<\s*(?:media omitted|multimedia omitido|archivo omitido|adjunto omitido)\s*>"
    r"|(?:image|imagen|video|vídeo|audio|sticker|document|documento|gif|contact card|tarjeta de contacto)"
    r"\s+(?:omitted|omitid[oa]))\s*$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class MensajeDelChat:
    sent_at: datetime
    sender: str
    text: str
    #  Nombre del archivo adjunto, si trae (y si se exportó con archivos)
    attachment: str | None = None


@dataclass
class _Linea:
    a: int
    b: int
    y: int
    h: int
    m: int
    s: int
    ampm: str | None
    resto: str


def _cabecera(linea: str) -> _Linea | None:
    m = _IPHONE.match(linea) or _ANDROID.match(linea)
    if not m:
        return None
    y = int(m["y"])
    return _Linea(
        a=int(m["a"]),
        b=int(m["b"]),
        y=y + 2000 if y < 100 else y,
        h=int(m["h"]),
        m=int(m["m"]),
        s=int(m["s"] or 0),
        ampm=m["ampm"],
        resto=m["resto"],
    )


def _dia_primero(cabeceras: list[_Linea]) -> bool:
    if any(c.a > 12 for c in cabeceras):
        return True
    if any(c.b > 12 for c in cabeceras):
        return False
    # Sin cómo saberlo: «10:11 AM» (sin puntos) es inglés de Estados Unidos; lo demás, día/mes
    return not any(c.ampm and "." not in c.ampm and " " not in c.ampm for c in cabeceras)


def _hora_24(h: int, ampm: str | None) -> int:
    if not ampm:
        return h
    tarde = ampm.lower().startswith("p")
    if h == 12:
        return 12 if tarde else 0
    return h + 12 if tarde else h


def leer_chat(texto: str) -> list[MensajeDelChat]:
    """Los mensajes de personas del chat exportado, en orden (sin los del sistema)."""
    lineas = _ESPACIOS.sub(" ", texto.replace("\r\n", "\n").replace("\r", "\n")).split("\n")
    crudos: list[tuple[_Linea, list[str]]] = []
    for linea in lineas:
        c = _cabecera(_INVISIBLES.sub("", linea).strip()) if linea.strip() else None
        if c:
            # Lo del sistema en iPhone: «Nombre: ‎Vale añadió a Santi» (la marca invisible va antes del texto)
            sin_marcas_al_inicio = re.sub(r"^\s*[‎‏]+", "", linea)
            c.resto = _ESPACIOS.sub(" ", _cabecera_cruda(sin_marcas_al_inicio) or c.resto)
            crudos.append((c, []))
        elif crudos:
            crudos[-1][1].append(linea)
    if not crudos:
        return []

    dia_primero = _dia_primero([c for c, _ in crudos])
    mensajes: list[MensajeDelChat] = []
    for c, siguientes in crudos:
        quien = _QUIEN.match(c.resto)
        if not quien:
            continue  # del sistema: «Vale creó el grupo»
        cuerpo = quien["texto"]
        sistema = cuerpo.startswith(("‎", "‏"))
        cuerpo = _INVISIBLES.sub("", "\n".join([cuerpo, *siguientes])).strip()
        adjunto = _ADJUNTO_IPHONE.search(cuerpo) or _ADJUNTO_ANDROID.match(cuerpo)
        if sistema and not adjunto and not _OMITIDO.match(cuerpo.split("\n")[0]):
            continue
        archivo = adjunto["archivo"].strip() if adjunto else None
        if adjunto:
            cuerpo = (cuerpo[: adjunto.start()] + cuerpo[adjunto.end() :]).strip()
        lineas_texto = [x for x in cuerpo.split("\n") if not _OMITIDO.match(x)]
        dia, mes = (c.a, c.b) if dia_primero else (c.b, c.a)
        try:
            cuando = datetime(c.y, mes, dia, _hora_24(c.h, c.ampm), c.m, c.s, tzinfo=BOGOTA)
        except ValueError:
            continue
        mensajes.append(
            MensajeDelChat(
                sent_at=cuando,
                sender=_INVISIBLES.sub("", quien["quien"]).strip(),
                text="\n".join(lineas_texto).strip(),
                attachment=archivo,
            )
        )
    return mensajes


def _cabecera_cruda(linea: str) -> str | None:
    """El «resto» de una cabecera sin quitar las marcas invisibles (para reconocer lo del sistema)."""
    limpia = _ESPACIOS.sub(" ", linea.strip())
    m = _IPHONE.match(limpia) or _ANDROID.match(limpia)
    return m["resto"] if m else None


# ----------------------------------------------------------------------------
# El archivo: un .zip (con o sin fotos) o el .txt solo
# ----------------------------------------------------------------------------


class ArchivoNoSirve(ValueError):
    """El archivo no es un chat exportado que Luks sepa leer (el mensaje es para la persona)."""


@dataclass
class ChatExportado:
    texto: str
    #  Nombre del archivo → sus bytes (se leen cuando hacen falta)
    archivos: dict[str, Callable[[], bytes]]


def _decodificar(data: bytes) -> str:
    for codificacion in ("utf-8-sig", "utf-16"):
        try:
            texto = data.decode(codificacion)
        except UnicodeDecodeError:
            continue
        if _cabecera_en(texto):
            return texto
    return data.decode("latin-1")


def _cabecera_en(texto: str) -> bool:
    return any(_cabecera(_INVISIBLES.sub("", x).strip()) for x in texto.splitlines()[:50] if x.strip())


def abrir_chat(data: bytes, nombre: str | None) -> ChatExportado:
    """Del .zip, el .txt del chat y sus archivos; o el .txt tal cual."""
    if not zipfile.is_zipfile(io.BytesIO(data)):
        texto = _decodificar(data)
        if not _cabecera_en(texto):
            raise ArchivoNoSirve("El archivo no es un chat de WhatsApp: expórtenlo con «Exportar chat»")
        return ChatExportado(texto=texto, archivos={})
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        nombres = [n for n in z.namelist() if not n.endswith("/") and not n.startswith("__MACOSX/")]
    except zipfile.BadZipFile as e:
        raise ArchivoNoSirve("El archivo está dañado o no es un .zip") from e
    txts = [n for n in nombres if n.lower().endswith(".txt")]
    # iPhone: «_chat.txt»; Android: «Chat de WhatsApp con Paseo.txt»
    preferidos = [n for n in txts if re.search(r"(_chat|whatsapp|chat)", n.rsplit("/", 1)[-1], re.IGNORECASE)] or txts
    for n in preferidos:
        texto = _decodificar(z.read(n))
        if _cabecera_en(texto):
            archivos = {x.rsplit("/", 1)[-1]: (lambda x=x: z.read(x)) for x in nombres if x not in txts}
            return ChatExportado(texto=texto, archivos=archivos)
    raise ArchivoNoSirve("No encontré el chat en el archivo: expórtenlo con «Exportar chat»")


# ----------------------------------------------------------------------------
# Qué parece gasto (como looksLikeExpense del connector, services/connector/src/text.ts)
# ----------------------------------------------------------------------------

_MONTO = [
    re.compile(r"\$\s*\d"),
    re.compile(
        r"\d[\d.,]*\s*(?:lucas?|luquitas?|mil|k|palos?|millones?|mill[oó]n|barras?|pesos|cop)(?![a-z])", re.IGNORECASE
    ),
    re.compile(r"(?<![\d.,])\d{1,3}(?:[.,]\d{3})+(?!\d)"),
    re.compile(r"(?<![\d+])\d{4,9}(?!\d)"),
]
_SOLO_TELEFONO = re.compile(r"^\s*\+?\d[\d\s-]{8,}\d\s*$")


def parece_gasto(texto: str | None) -> bool:
    """Trae un monto: «taxi 45 lucas», «almuerzo 25.000», «$80.000 el hotel», «15k la cerveza»."""
    if not texto or not texto.strip() or len(texto) > 2000 or _SOLO_TELEFONO.match(texto):
        return False
    return any(r.search(texto) for r in _MONTO)


FOTOS = (".jpg", ".jpeg", ".png", ".webp")


def tipo_de_adjunto(nombre: str) -> str | None:
    """'photo', 'pdf' o None (audios, videos, stickers, contactos: no son recibos)."""
    n = nombre.lower()
    if n.startswith("stk-") or "sticker" in n:
        return None
    if n.endswith(FOTOS):
        return "photo"
    if n.endswith(".pdf"):
        return "pdf"
    return None
