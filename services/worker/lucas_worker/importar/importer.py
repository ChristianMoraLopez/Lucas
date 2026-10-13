"""El trabajo 'import_chat': del chat exportado a mensajes en la cola.

worker_import_context (la importación; queda «leyéndose») → bajar el .zip o el
.txt del bucket «importaciones» → leer el chat → lo de antes de ingest_from que
parece gasto (mensajes con monto, fotos y PDFs) → fotos a JPEG de 1600 px y
PDFs al bucket de evidencias → worker_import_messages en tandas (cada mensaje
queda en la cola con prioridad baja, y el pipeline de siempre lo vuelve gasto)
→ worker_finish_import con las cuentas, o con el error para la persona.

Importar dos veces el mismo chat no repite nada: cada mensaje lleva una clave
que sale de su fecha, quién lo mandó, el texto y el archivo.
"""

from __future__ import annotations

import hashlib
import io
import logging
from datetime import datetime, timedelta
from typing import Any

from PIL import Image, ImageOps

from ..config import Settings
from ..errors import PermanentError
from ..luks import es_mensaje_de_luks
from ..pipeline import Job
from ..supabase import Database
from .chat import ArchivoNoSirve, MensajeDelChat, abrir_chat, leer_chat, parece_gasto, tipo_de_adjunto

log = logging.getLogger(__name__)

TANDA = 100
MAX_PDF = 6 * 1024 * 1024  # el límite del bucket de evidencias
ERROR_GENERAL = "No pude leer el chat. Expórtenlo otra vez y vuelvan a mandarlo"


def _clave(m: MensajeDelChat) -> str:
    base = f"{m.sent_at.isoformat()}|{m.sender}|{m.text}|{m.attachment or ''}"
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:24]


def _jpeg(data: bytes, lado: int = 1600) -> bytes:
    with Image.open(io.BytesIO(data)) as original:
        img = ImageOps.exif_transpose(original).convert("RGB")
        img.thumbnail((lado, lado))
        out = io.BytesIO()
        img.save(out, "JPEG", quality=80, optimize=True)
        return out.getvalue()


class ChatImporter:
    def __init__(self, db: Database, settings: Settings):
        self.db = db
        self.settings = settings

    def _terminar(self, import_id: str, stats: dict[str, Any], error: str | None) -> None:
        self.db.rpc("worker_finish_import", {"p_import_id": import_id, "p_stats": stats, "p_error": error})

    def process(self, job: Job) -> str:
        import_id = job.payload.get("import_id")
        if not import_id:
            raise PermanentError("El trabajo no trae import_id")
        ctx = self.db.rpc("worker_import_context", {"p_import_id": import_id})
        if not ctx:
            return "la importación ya no está pendiente"
        imp = ctx["import"]
        stats: dict[str, Any] = {}
        try:
            stats = self._leer(import_id, imp)
        except ArchivoNoSirve as e:
            self._terminar(import_id, stats, str(e))
            raise PermanentError(str(e)) from e
        except Exception as e:
            # Lo pasajero (Supabase caído) se reintenta; si ya no hay más intentos, se avisa
            if isinstance(e, PermanentError) or job.last_attempt:
                self._terminar(import_id, stats, ERROR_GENERAL)
            raise
        self._terminar(import_id, stats, None)
        return f"chat importado: {stats['inserted']} mensajes a la cola"

    def _leer(self, import_id: str, imp: dict[str, Any]) -> dict[str, Any]:
        cuenta = imp["account_id"]
        antes = datetime.fromisoformat(str(imp["before"]).replace("Z", "+00:00")) - timedelta(minutes=2)
        chat = abrir_chat(self.db.download(self.settings.imports_bucket, imp["file_path"]), imp.get("file_name"))
        mensajes = leer_chat(chat.texto)
        if not mensajes:
            raise ArchivoNoSirve("No encontré mensajes en el chat: expórtenlo con «Exportar chat»")
        previos = [m for m in mensajes if m.sent_at < antes]

        candidatos: list[tuple[MensajeDelChat, str]] = []
        for m in previos:
            tipo = tipo_de_adjunto(m.attachment) if m.attachment else None
            if tipo and m.attachment in chat.archivos:
                candidatos.append((m, tipo))
            elif parece_gasto(m.text) and not es_mensaje_de_luks(m.text):
                # También una foto que no vino en el .zip (exportado sin archivos) pero con monto en el texto
                candidatos.append((m, "text"))
        recortados = max(0, len(candidatos) - self.settings.import_max_items)
        if recortados:
            candidatos = candidatos[-self.settings.import_max_items :]  # los más recientes

        items: list[dict[str, Any]] = []
        fotos = pdfs = sin_archivo = 0
        for m, tipo in candidatos:
            clave = _clave(m)
            item: dict[str, Any] = {
                "key": clave,
                "sender": m.sender,
                "kind": tipo,
                "text": m.text or None,
                "sent_at": m.sent_at.isoformat(),
            }
            if tipo != "text":
                try:
                    data = chat.archivos[m.attachment or ""]()
                    if tipo == "photo":
                        data, mime, ext = _jpeg(data), "image/jpeg", "jpg"
                    else:
                        if len(data) > MAX_PDF:
                            raise ValueError("PDF de más de 6 MB")
                        mime, ext = "application/pdf", "pdf"
                except Exception as e:  # una foto dañada o un PDF enorme no tumban el resto
                    log.info("Archivo del chat que no se pudo usar: %s", e)
                    sin_archivo += 1
                    continue
                ruta = f"{cuenta}/import/{import_id}/{clave}.{ext}"
                self.db.upload(self.settings.evidence_bucket, ruta, data, mime)
                item.update({"media_path": ruta, "file_name": m.attachment, "mime_type": mime})
                fotos += tipo == "photo"
                pdfs += tipo == "pdf"
            items.append(item)

        totales = {"inserted": 0, "known_sender": 0, "after": 0, "luks": 0}
        for i in range(0, len(items), TANDA):
            r = self.db.rpc("worker_import_messages", {"p_import_id": import_id, "p_items": items[i : i + TANDA]}) or {}
            for k in totales:
                totales[k] += int(r.get(k) or 0)
        return {
            "messages": len(mensajes),
            "before": len(previos),
            "after": len(mensajes) - len(previos),
            "candidates": len(candidatos),
            "photos": fotos,
            "pdfs": pdfs,
            "skipped_files": sin_archivo,
            "truncated": recortados,
            "inserted": totales["inserted"],
            "known_sender": totales["known_sender"],
        }
