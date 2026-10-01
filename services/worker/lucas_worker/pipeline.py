"""De mensaje a gasto: el trabajo `process_message` de principio a fin.

contexto (cuenta, personas, categorías, memoria)
→ evidencia de Storage → huella de la foto → ¿duplicada?
→ extracción en cascada → ¿CUFE repetido?
→ Ollama (JSON validado) → validación y confianza por campo
→ pagador y división según el mensaje
→ categoría: memoria → Laya → palabras clave
→ worker_save_expense (vuelve a revisar duplicados con candado por cuenta)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

from . import __version__
from .classify.categories import fallback_description
from .classify.classifier import Category, CategoryClassifier
from .classify.memory import MemoryEntry, match_memory
from .classify.question import ClassifyInput
from .config import Settings
from .errors import LlmUnavailable, PermanentError
from .extract.cascade import Extraction, Extractor
from .llm.ollama import LlmError, ReceiptLlm
from .llm.schema import ReceiptExtraction
from .observability import stage
from .payer import Person, resolve_payer, resolve_split
from .supabase import Database
from .validate import AccountWindow, reconcile

log = logging.getLogger(__name__)

BOGOTA = timezone(timedelta(hours=-5), "America/Bogota")  # sin horario de verano desde 1993


@dataclass
class Job:
    id: str
    attempts: int = 1
    max_attempts: int = 5
    payload: dict[str, Any] = field(default_factory=dict)
    type: str = "process_message"

    @property
    def message_id(self) -> str | None:
        return self.payload.get("message_id")

    @property
    def last_attempt(self) -> bool:
        return self.attempts >= self.max_attempts

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> Job:
        return cls(
            id=row["id"],
            attempts=int(row.get("attempts") or 1),
            max_attempts=int(row.get("max_attempts") or 5),
            payload=row.get("payload") or {},
            type=row.get("type") or "process_message",
        )


def _dia_bogota(ts: str | None, fallback: date) -> date:
    if not ts:
        return fallback
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return fallback
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(BOGOTA).date()


class MessageProcessor:
    def __init__(
        self,
        db: Database,
        extractor: Extractor,
        classifier: CategoryClassifier,
        settings: Settings,
        llm: ReceiptLlm | None = None,
    ):
        self.db = db
        self.extractor = extractor
        self.classifier = classifier
        self.settings = settings
        self.llm = llm

    # -- duplicados ------------------------------------------------------------

    def _duplicado(self, account_id: str, cufe: str | None, image_hash: str | None) -> str | None:
        return self.db.rpc(
            "worker_find_duplicate",
            {
                "p_account_id": account_id,
                "p_cufe": cufe,
                "p_image_hash": image_hash,
                "p_max_distance": self.settings.dedup_hash_max_distance,
            },
        )

    def _marcar(self, message_id: str, status: str, duplicate_of: str | None = None, text: str | None = None) -> None:
        self.db.rpc(
            "worker_mark_message",
            {"p_message_id": message_id, "p_status": status, "p_duplicate_of": duplicate_of, "p_extracted_text": text},
        )

    # -- LLM -------------------------------------------------------------------

    def _llm(self, ex: Extraction, today: date, people: list[Person], job: Job) -> ReceiptExtraction | None:
        if self.llm is None:
            return None
        try:
            with stage("llm"):
                return self.llm.extract(
                    kind={"photo": "receipt photo (OCR)", "pdf": "PDF invoice", "text": "WhatsApp message"}[ex.kind],
                    today=today,
                    document_text=ex.text if ex.kind != "text" else None,
                    message_text=ex.text if ex.kind == "text" else ex.caption,
                    qr=ex.qr,
                    total_candidates=ex.hints.total_candidates,
                    message_amount=ex.hints.amount if ex.kind == "text" else ex.caption_hints.amount,
                    people=[p.display_name for p in people],
                )
        except LlmUnavailable:
            if not job.last_attempt:
                raise  # se reintenta más tarde, con backoff
            log.warning(
                "Ollama sigue sin responder: último intento, se guarda solo con reglas", extra={"job_id": job.id}
            )
            return None
        except LlmError as e:
            log.warning("El LLM no dio un JSON válido; se sigue con reglas: %s", e, extra={"job_id": job.id})
            return None

    # -- el trabajo ------------------------------------------------------------

    def process(self, job: Job) -> str:
        if not job.message_id:
            raise PermanentError("El trabajo no trae message_id")
        ctx = self.db.rpc("worker_message_context", {"p_message_id": job.message_id})
        if not ctx:
            raise PermanentError("El mensaje ya no existe")
        msg = ctx["message"]
        if msg["status"] in ("done", "not_expense", "duplicate"):
            return "ya estaba procesado"

        account_id: str = msg["account_id"]
        today = date.fromisoformat(ctx["today"])
        received = _dia_bogota(msg.get("received_at"), today)
        people = [Person(p["id"], p["display_name"]) for p in ctx.get("people") or []]
        categories = [Category(c["id"], c["name"], c.get("description")) for c in ctx.get("categories") or []]
        memory = [
            MemoryEntry(m["id"], m["merchant_text"], m["normalized"], m["category_id"], int(m.get("hits") or 0))
            for m in ctx.get("memory") or []
        ]
        acc = ctx.get("account") or {}
        window = AccountWindow(
            type=acc.get("type") or "hogar",
            starts_on=date.fromisoformat(acc["starts_on"]) if acc.get("starts_on") else None,
            ends_on=date.fromisoformat(acc["ends_on"]) if acc.get("ends_on") else None,
        )
        kind = msg["kind"]
        caption = msg.get("text_body") if kind != "text" else None

        # 1. Evidencia y extracción
        if kind == "photo":
            with stage("descarga"):
                data = self.db.download(self.settings.evidence_bucket, msg["media_path"])
            with stage("huella"):
                img, image_hash = self.extractor.load_photo(data)
            if dup := self._duplicado(account_id, None, image_hash):
                self._marcar(job.message_id, "duplicate", dup)
                return f"duplicado (foto) de {dup}"
            with stage("ocr"):
                ex = self.extractor.photo(img, image_hash, caption, today)
        elif kind == "pdf":
            with stage("descarga"):
                data = self.db.download(self.settings.evidence_bucket, msg["media_path"])
            with stage("pdf"):
                ex = self.extractor.pdf(data, caption, today)
        elif kind == "text":
            ex = self.extractor.text(msg.get("text_body"), today)
        else:
            raise PermanentError(f"Tipo de mensaje desconocido: {kind}")

        if ex.cufe and (dup := self._duplicado(account_id, ex.cufe, None)):
            self._marcar(job.message_id, "duplicate", dup, ex.stored_text)
            return f"duplicado (CUFE) de {dup}"

        # 2. LLM y validación
        llm = self._llm(ex, today, people, job)
        draft = reconcile(ex, llm, today=today, received=received, account=window, explicit=msg.get("source") == "web")
        if draft.not_expense:
            self._marcar(job.message_id, "not_expense", text=ex.stored_text)
            return "no es un gasto"

        # 3. Pagador y división
        texto_persona = ex.text if kind == "text" else caption
        payer = resolve_payer(texto_persona, people, ctx.get("sender_person_id"), llm.payer_name if llm else None)
        split = resolve_split(texto_persona, people)

        # 4. Categoría
        with stage("clasificacion"):
            decision = self.classifier.classify(
                ClassifyInput(
                    merchant=draft.merchant,
                    description_en=draft.description_en,
                    message_text=msg.get("text_body"),
                    items=[i.name for i in draft.items],
                    document_text=ex.text if kind != "text" else None,
                ),
                categories,
                memory,
                keyword_text=ex.text[:600],
            )
        if decision.source == "memory" and (m := match_memory(draft.merchant, memory)) and m.exact:
            draft.confidence["merchant"] = max(draft.confidence["merchant"], 0.95)  # un comercio conocido

        confianza = {**draft.confidence, "category": round(decision.confidence, 2), "payer": round(payer.confidence, 2)}
        minima = min(confianza.values())
        confirmar = (
            decision.source == "memory"
            and minima >= self.settings.auto_confirm_min
            and payer.person_id is not None
            and draft.total_cop > 0
        )

        items = [
            {"name": i.name, "quantity": i.quantity or 1, "unit_price_cop": i.unit_price_cop, "total_cop": i.total_cop}
            for i in draft.items
        ]
        snapshot = {
            # Lo que la bandeja compara contra lo corregido (review-screen.tsx)
            "merchant": draft.merchant,
            "expense_date": draft.expense_date.isoformat(),
            "total_cop": draft.total_cop,
            "category_id": decision.category_id,
            "payer_person_id": payer.person_id,
            # Cómo se leyó (para depurar y para mejorar el modelo)
            "description_en": draft.description_en,
            "method": ex.method,
            "steps": ex.steps,
            "ocr_quality": ex.quality if kind == "photo" or ex.method == "pdf_ocr" else None,
            "sources": {**draft.sources, "category": decision.source, "payer": payer.source},
            "category_model": decision.model,
            "category_probabilities": decision.probabilities or None,
            "memory_score": decision.memory_score,
            "subtotal_cop": draft.subtotal_cop,
            "tax_cop": draft.tax_cop,
            "tip_cop": draft.tip_cop,
            "nit": draft.nit,
            "qr": {
                "number": ex.qr.number,
                "total": ex.qr.total,
                "issued_on": ex.qr.issued_on.isoformat() if ex.qr.issued_on else None,
            }
            if ex.qr
            else None,
            "llm_model": getattr(self.llm, "model", None) if llm else None,
            "notes": draft.notes or None,
            "worker": __version__,
        }
        data = {
            "merchant": draft.merchant,
            "description": draft.description_en or fallback_description(decision.category_name),
            "expense_date": draft.expense_date.isoformat(),
            "total_cop": draft.total_cop,
            "category_id": decision.category_id,
            "payer_person_id": payer.person_id,
            "status": "confirmed" if confirmar else "pending_review",
            "confidence": round(minima, 2),
            "field_confidence": confianza,
            "ai_snapshot": {k: v for k, v in snapshot.items() if v is not None},
            "split_note": split.note,
            "split_person_ids": split.person_ids,
            "items": items,
            "cufe": ex.cufe,
            "image_hash": ex.image_hash,
            "memory_id": decision.memory_id,
            "extracted_text": ex.stored_text,
        }
        with stage("guardar"):
            res = self.db.rpc(
                "worker_save_expense",
                {
                    "p_message_id": job.message_id,
                    "p_data": data,
                    "p_max_distance": self.settings.dedup_hash_max_distance,
                },
            )
        if res.get("duplicate_of"):
            return f"duplicado de {res['duplicate_of']}"
        if res.get("skipped"):
            return f"ya estaba {res.get('status')}"
        return f"gasto {res.get('expense_id')} ({res.get('status')}, {decision.source}, confianza {minima:.2f})"
