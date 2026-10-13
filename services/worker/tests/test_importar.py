"""Importar el chat exportado: los formatos de Android y iPhone, el .zip y el trabajo 'import_chat'."""

from __future__ import annotations

import io
import zipfile
from datetime import datetime
from typing import Any

import pytest
from PIL import Image

from lucas_worker.errors import PermanentError
from lucas_worker.importar.chat import BOGOTA, ArchivoNoSirve, abrir_chat, leer_chat, parece_gasto, tipo_de_adjunto
from lucas_worker.importar.importer import ChatImporter
from lucas_worker.pipeline import Job
from lucas_worker.queue import PorTipo

from .conftest import CUENTA, make_settings

LRM = "‎"
NNBSP = " "


def _en(y: int, mes: int, dia: int, h: int, m: int, s: int = 0) -> datetime:
    return datetime(y, mes, dia, h, m, s, tzinfo=BOGOTA)


# ---------------------------------------------------------------------------
# Los formatos
# ---------------------------------------------------------------------------


def test_android_en_espanol_con_varias_lineas_adjuntos_y_mensajes_del_sistema():
    chat = (
        "25/09/26, 10:11 a. m. - Los mensajes y las llamadas están cifrados de extremo a extremo.\n"
        "25/09/26, 10:12 a. m. - Vale: taxi al aeropuerto 45 lucas\n"
        "y la propina\n"
        "25/09/26, 1:05 p. m. - Santi: IMG-20260925-WA0003.jpg (archivo adjunto)\n"
        "Mercado del finde\n"
        "25/09/26, 1:06 p. m. - Santi: <Multimedia omitido>\n"
        "26/09/26, 12:30 a. m. - Vale añadió a Toño\n"
    )
    assert leer_chat(chat) == [
        _msg(_en(2026, 9, 25, 10, 12), "Vale", "taxi al aeropuerto 45 lucas\ny la propina"),
        _msg(_en(2026, 9, 25, 13, 5), "Santi", "Mercado del finde", "IMG-20260925-WA0003.jpg"),
        _msg(_en(2026, 9, 25, 13, 6), "Santi", ""),
    ]


def test_android_en_ingles_de_estados_unidos_mes_primero_y_am_pm_con_espacio_angosto():
    chat = (
        f"9/25/26, 10:11{NNBSP}AM - Sam: airport taxi $45\n"
        f"9/25/26, 12:05{NNBSP}PM - Alex: IMG-20260925-WA0007.jpg (file attached)\n"
        f"9/25/26, 12:06{NNBSP}AM - Alex: <Media omitted>\n"
    )
    mensajes = leer_chat(chat)
    assert [(m.sent_at, m.sender, m.attachment) for m in mensajes] == [
        (_en(2026, 9, 25, 10, 11), "Sam", None),
        (_en(2026, 9, 25, 12, 5), "Alex", "IMG-20260925-WA0007.jpg"),
        (_en(2026, 9, 25, 0, 6), "Alex", None),
    ]


def test_iphone_en_espanol_salta_lo_del_sistema_y_lee_los_adjuntos():
    chat = (
        f"[25/09/26, 10:11:12] Paseo: {LRM}Los mensajes y las llamadas están cifrados de extremo a extremo.\n"
        f"[25/09/26, 10:11:30] Paseo: {LRM}Vale creó el grupo «Paseo»\n"
        f"{LRM}[25/09/26, 10:12:01] Vale 🌻: {LRM}<adjunto: 00000012-PHOTO-2026-09-25-10-12-01.jpg>\n"
        "[25/09/26, 10:13:00] Santi: almuerzo 120.000\n"
        f"[25/09/26, 10:14:00] Santi: {LRM}imagen omitida\n"
    )
    mensajes = leer_chat(chat)
    assert [(m.sender, m.text, m.attachment) for m in mensajes] == [
        ("Vale 🌻", "", "00000012-PHOTO-2026-09-25-10-12-01.jpg"),
        ("Santi", "almuerzo 120.000", None),
        ("Santi", "", None),
    ]
    assert mensajes[0].sent_at == _en(2026, 9, 25, 10, 12, 1)


def test_iphone_en_ingles_con_segundos_y_am_pm():
    chat = f"[9/25/26, 10:11:12{NNBSP}PM] Sam: groceries $84.30\n[9/26/26, 1:02:03{NNBSP}AM] Sam: {LRM}<attached: 00000013-PHOTO-2026-09-26-01-02-03.jpg>\n"
    mensajes = leer_chat(chat)
    assert [(m.sent_at, m.attachment) for m in mensajes] == [
        (_en(2026, 9, 25, 22, 11, 12), None),
        (_en(2026, 9, 26, 1, 2, 3), "00000013-PHOTO-2026-09-26-01-02-03.jpg"),
    ]


def test_el_orden_dia_mes_se_decide_con_todo_el_archivo():
    # «3/10/26» solo no dice nada; «13/10/26» más abajo dice que es día/mes
    dia_mes = "3/10/26, 14:00 - Vale: hielo 12 lucas\n13/10/26, 9:00 - Vale: pan 8 mil\n"
    assert [m.sent_at.date().isoformat() for m in leer_chat(dia_mes)] == ["2026-10-03", "2026-10-13"]
    mes_dia = "3/10/26, 2:00 PM - Sam: ice $12\n3/25/26, 9:00 AM - Sam: bread $8\n"
    assert [m.sent_at.date().isoformat() for m in leer_chat(mes_dia)] == ["2026-03-10", "2026-03-25"]
    # Sin cómo saberlo: con 24 horas, día/mes; con «AM» en inglés, mes/día
    assert leer_chat("3/10/26, 14:00 - Vale: hielo 12 lucas\n")[0].sent_at.date().isoformat() == "2026-10-03"
    assert leer_chat("3/10/26, 2:00 PM - Sam: ice $12\n")[0].sent_at.date().isoformat() == "2026-03-10"


def test_lo_que_parece_gasto_es_lo_mismo_que_en_el_connector():
    for si in [
        "taxi 45 lucas",
        "almuerzo 25.000",
        "$80.000 el hotel",
        "pagué 120000",
        "2 palos el arriendo",
        "15k la cerveza",
    ]:
        assert parece_gasto(si), si
    for no in ["hola parce", "300 123 4567", "+57 300 123 4567", "nos vemos a las 5", None, ""]:
        assert not parece_gasto(no), no


def test_que_adjuntos_son_recibos():
    assert tipo_de_adjunto("IMG-20260925-WA0003.jpg") == "photo"
    assert tipo_de_adjunto("00000012-PHOTO-2026-09-25-10-12-01.JPEG") == "photo"
    assert tipo_de_adjunto("Factura.pdf") == "pdf"
    assert tipo_de_adjunto("STK-20260925-WA0001.webp") is None
    assert tipo_de_adjunto("PTT-20260925-WA0002.opus") is None
    assert tipo_de_adjunto("VID-20260925-WA0004.mp4") is None


# ---------------------------------------------------------------------------
# El archivo
# ---------------------------------------------------------------------------


def _foto(color: str = "red") -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (2400, 1800), color).save(out, "PNG")
    return out.getvalue()


def _zip(archivos: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for nombre, data in archivos.items():
            z.writestr(nombre, data)
    return out.getvalue()


def test_abre_el_zip_de_iphone_y_el_de_android_y_el_txt_solo():
    chat = b"[25/09/26, 10:13:00] Santi: almuerzo 120.000\n"
    iphone = abrir_chat(_zip({"_chat.txt": chat, "00000012-PHOTO.jpg": b"x"}), "WhatsApp Chat - Paseo.zip")
    assert "almuerzo" in iphone.texto and list(iphone.archivos) == ["00000012-PHOTO.jpg"]
    android = abrir_chat(_zip({"Chat de WhatsApp con Paseo.txt": b"25/09/26, 10:12 - Vale: taxi 45 lucas\n"}), None)
    assert "taxi" in android.texto and android.archivos == {}
    solo = abrir_chat("﻿25/09/26, 10:12 - Vale: taxi 45 lucas\n".encode(), "chat.txt")
    assert solo.texto.startswith("25/09/26")


def test_un_archivo_que_no_es_un_chat_se_explica():
    with pytest.raises(ArchivoNoSirve, match="no es un chat"):
        abrir_chat(b"hola, esto no es un chat", "notas.txt")
    with pytest.raises(ArchivoNoSirve, match="No encontré el chat"):
        abrir_chat(_zip({"foto.jpg": b"x", "notas.txt": b"nada que ver"}), "cosas.zip")


# ---------------------------------------------------------------------------
# El trabajo 'import_chat'
# ---------------------------------------------------------------------------

IMPORTACION = "70000000-0000-4000-8000-000000000001"


class FakeImportDb:
    def __init__(self, archivo: bytes, before: str = "2026-10-01T00:00:00-05:00"):
        self.archivo = archivo
        self.before = before
        self.subidos: dict[str, tuple[bytes, str]] = {}
        self.tandas: list[list[dict[str, Any]]] = []
        self.fin: dict[str, Any] | None = None
        self.descargas: list[tuple[str, str]] = []

    def download(self, bucket: str, path: str) -> bytes:
        self.descargas.append((bucket, path))
        return self.archivo

    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> None:
        self.subidos[f"{bucket}/{path}"] = (data, content_type)

    def rpc(self, fn: str, params: dict[str, Any] | None = None) -> Any:
        p = params or {}
        if fn == "worker_import_context":
            return {
                "import": {
                    "id": p["p_import_id"],
                    "account_id": CUENTA,
                    "file_path": f"{CUENTA}/chat.zip",
                    "file_name": "chat.zip",
                    "before": self.before,
                },
                "account": {"id": CUENTA, "currency": "COP", "language": "es"},
            }
        if fn == "worker_import_messages":
            self.tandas.append(p["p_items"])
            return {"inserted": len(p["p_items"]), "known_sender": 1, "after": 0, "luks": 0}
        if fn == "worker_finish_import":
            self.fin = {"stats": p["p_stats"], "error": p["p_error"]}
            return None
        raise AssertionError(f"RPC inesperada: {fn}")


def _job(**kw: Any) -> Job:
    return Job(id="j1", type="import_chat", payload={"import_id": IMPORTACION}, **kw)


def test_importa_lo_de_antes_que_parece_gasto_con_sus_fotos():
    chat = (
        "25/09/26, 10:12 - Vale: taxi al aeropuerto 45 lucas\n"
        "25/09/26, 10:13 - Vale: jajaja\n"
        "25/09/26, 13:05 - Santi: IMG-20260925-WA0003.jpg (archivo adjunto)\n"
        "25/09/26, 13:06 - Santi: STK-20260925-WA0004.webp (archivo adjunto)\n"
        "25/09/26, 13:07 - Mister Luks: ✅ Anotado: Hielo · $12.000\n"
        # Después de que Luks empezó a anotar: ya entró en vivo
        "02/10/26, 9:00 - Vale: hielo 12 lucas\n"
    )
    db = FakeImportDb(
        _zip(
            {
                "Chat de WhatsApp con Paseo.txt": chat.encode(),
                "IMG-20260925-WA0003.jpg": _foto(),
                "STK-20260925-WA0004.webp": b"x",
            }
        )
    )
    resultado = ChatImporter(db, make_settings()).process(_job())  # type: ignore[arg-type]
    assert resultado == "chat importado: 2 mensajes a la cola"
    assert db.descargas == [("importaciones", f"{CUENTA}/chat.zip")]

    items = db.tandas[0]
    assert [(i["sender"], i["kind"], i["text"]) for i in items] == [
        ("Vale", "text", "taxi al aeropuerto 45 lucas"),
        ("Santi", "photo", None),
    ]
    assert items[0]["sent_at"] == "2026-09-25T10:12:00-05:00"
    # La foto, a JPEG de 1600 px en la carpeta de la cuenta
    foto = items[1]
    assert foto["media_path"] == f"{CUENTA}/import/{IMPORTACION}/{foto['key']}.jpg"
    data, mime = db.subidos[f"evidencias/{foto['media_path']}"]
    assert mime == "image/jpeg"
    with Image.open(io.BytesIO(data)) as img:
        assert max(img.size) == 1600
    assert db.fin == {
        "error": None,
        "stats": {
            "messages": 6,
            "before": 5,
            "after": 1,
            "candidates": 2,
            "photos": 1,
            "pdfs": 0,
            "skipped_files": 0,
            "truncated": 0,
            "inserted": 2,
            "known_sender": 1,
        },
    }


def test_el_mismo_chat_da_las_mismas_claves():
    chat = _zip({"_chat.txt": b"[25/09/26, 10:13:00] Santi: almuerzo 120.000\n"})
    claves = []
    for _ in range(2):
        db = FakeImportDb(chat)
        ChatImporter(db, make_settings()).process(_job())  # type: ignore[arg-type]
        claves.append(db.tandas[0][0]["key"])
    assert claves[0] == claves[1]


def test_con_demasiados_se_quedan_los_mas_recientes():
    chat = "".join(f"0{d}/09/26, 10:00 - Vale: almuerzo {d}0 mil\n" for d in range(1, 6))
    db = FakeImportDb(chat.encode())
    ChatImporter(db, make_settings(import_max_items=2)).process(_job())  # type: ignore[arg-type]
    assert [i["text"] for i in db.tandas[0]] == ["almuerzo 40 mil", "almuerzo 50 mil"]
    assert db.fin and db.fin["stats"]["truncated"] == 3


def test_un_archivo_que_no_sirve_termina_la_importacion_con_el_error_y_no_se_reintenta():
    db = FakeImportDb(b"esto no es un chat")
    with pytest.raises(PermanentError, match="no es un chat"):
        ChatImporter(db, make_settings()).process(_job())  # type: ignore[arg-type]
    assert db.fin and db.fin["error"].startswith("El archivo no es un chat de WhatsApp")


def test_cada_trabajo_va_a_su_procesador():
    class Uno:
        def process(self, job: Job) -> str:
            return f"uno {job.type}"

    por_tipo = PorTipo({"import_chat": Uno()})
    assert por_tipo.process(_job()) == "uno import_chat"
    with pytest.raises(PermanentError, match="desconocido"):
        por_tipo.process(Job(id="j2", type="otra_cosa"))


def _msg(cuando: datetime, quien: str, texto: str, adjunto: str | None = None):
    from lucas_worker.importar.chat import MensajeDelChat

    return MensajeDelChat(sent_at=cuando, sender=quien, text=texto, attachment=adjunto)
