"""Dobles de Supabase y del LLM, y los recibos de ejemplo."""

from __future__ import annotations

import copy
import re
import uuid
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from lucas_worker.config import Settings
from lucas_worker.errors import LlmUnavailable, PermanentError
from lucas_worker.extract.cascade import Extractor
from lucas_worker.extract.image import hash_distance
from lucas_worker.extract.ocr import OcrEngine
from lucas_worker.llm.schema import ReceiptExtraction

FIXTURES = Path(__file__).parent / "fixtures"
HOY = date(2026, 9, 30)
CUENTA = "20000000-0000-4000-8000-000000000002"

PERSONAS = {
    "valeria": "30000000-0000-4000-8000-000000000003",
    "juancamilo": "30000000-0000-4000-8000-000000000004",
    "santi": "30000000-0000-4000-8000-000000000008",
    "caro": "30000000-0000-4000-8000-000000000009",
}
NOMBRES = {"valeria": "Valeria", "juancamilo": "Juan Camilo", "santi": "Santi", "caro": "Caro"}
CATEGORIAS = {
    n: f"40000000-0000-4000-8000-0000000000{i}"
    for i, n in enumerate(
        ["Café", "Licor", "Mercado", "Transporte", "Hospedaje", "Restaurante", "Servicios", "Otros"], start=11
    )
}
MEMORIA = [
    {
        "id": "mem-espiga",
        "merchant_text": "PANADERIA LA ESPIGA",
        "normalized": "panaderia la espiga",
        "category_id": CATEGORIAS["Café"],
        "hits": 9,
    },
    {
        "id": "mem-rosa",
        "merchant_text": "TIENDA DOÑA ROSA",
        "normalized": "tienda dona rosa",
        "category_id": CATEGORIAS["Mercado"],
        "hits": 1,
    },
]


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def make_settings(**kw: Any) -> Settings:
    base: dict[str, Any] = {
        "supabase_url": "https://ejemplo.supabase.co",
        "supabase_service_role_key": "sb_secret_prueba",
        "laya_enabled": False,
        "sentry_dsn": None,
        "heartbeat_file": Path("/tmp/lucas-worker-heartbeat-pruebas"),
    }
    base.update(kw)
    return Settings(_env_file=None, **base)  # type: ignore[call-arg]


class FakeDb:
    """Supabase en memoria: lo justo de las RPC del worker (las reales se prueban con PGlite)."""

    def __init__(self) -> None:
        self.messages: dict[str, dict[str, Any]] = {}
        self.files: dict[str, bytes] = {}
        self.expenses: list[dict[str, Any]] = []
        self.jobs: dict[str, dict[str, Any]] = {}
        self.errors: list[dict[str, Any]] = []
        self.calls: list[str] = []
        self.memory = copy.deepcopy(MEMORIA)

    # -- armar escenarios --------------------------------------------------------

    def add_message(
        self,
        kind: str,
        *,
        text: str | None = None,
        file: str | None = None,
        sender: str | None = "santi",
        source: str = "web",
    ) -> str:
        mid = str(uuid.uuid4())
        path = None
        if file:
            path = f"{CUENTA}/{mid}-{file}"
            self.files[path] = fixture_bytes(file)
        self.messages[mid] = {
            "id": mid,
            "account_id": CUENTA,
            "kind": kind,
            "source": source,
            "status": "processing",
            "text_body": text,
            "media_path": path,
            "received_at": "2026-09-30T14:00:00+00:00",
            "sender": PERSONAS.get(sender or ""),
        }
        return mid

    def add_job(self, message_id: str, attempts: int = 1, max_attempts: int = 5) -> dict[str, Any]:
        job = {
            "id": str(uuid.uuid4()),
            "type": "process_message",
            "payload": {"message_id": message_id, "account_id": CUENTA},
            "attempts": attempts,
            "max_attempts": max_attempts,
            "status": "queued",
        }
        self.jobs[job["id"]] = job
        return job

    # -- Database -------------------------------------------------------------------

    def download(self, bucket: str, path: str) -> bytes:
        self.calls.append(f"download:{path}")
        if path not in self.files:
            raise PermanentError("No encontramos el archivo en Storage (404)")
        return self.files[path]

    def rpc(self, fn: str, params: dict[str, Any] | None = None) -> Any:
        self.calls.append(fn)
        return getattr(self, f"_{fn}")(**(params or {}))

    def _worker_message_context(self, p_message_id: str) -> dict[str, Any] | None:
        m = self.messages.get(p_message_id)
        if not m:
            return None
        return {
            "message": {k: v for k, v in m.items() if k != "sender"},
            "sender_person_id": m["sender"],
            "account": {"id": CUENTA, "type": "evento", "status": "active", "starts_on": "2026-09-24", "ends_on": None},
            "today": HOY.isoformat(),
            "people": [{"id": PERSONAS[k], "display_name": NOMBRES[k]} for k in PERSONAS],
            "categories": [{"id": v, "name": k} for k, v in CATEGORIAS.items()],
            "memory": self.memory,
        }

    def _worker_find_duplicate(
        self,
        p_account_id: str,
        p_cufe: str | None,
        p_image_hash: str | None,
        p_max_distance: int = 12,
        p_total_cop: int | None = None,
        p_expense_date: str | None = None,
        p_text: str | None = None,
    ) -> str | None:
        """Como public.worker_find_duplicate (migración 240): la huella cuenta con el mismo total, día y códigos."""

        def codigos(texto: str | None) -> set[str]:
            return set(re.findall(r"\d{6,}", texto or ""))

        for e in self.expenses:
            if p_cufe and e.get("cufe") == p_cufe.lower():
                return e["id"]
            if (
                p_image_hash
                and e.get("image_hash")
                and (p_total_cop or 0) > 0
                and e.get("total_cop") == p_total_cop
                and (p_expense_date is None or e.get("expense_date") == p_expense_date)
                and hash_distance(e["image_hash"], p_image_hash) <= p_max_distance
            ):
                a, b = codigos(p_text), codigos(e.get("extracted_text"))
                if not a or not b or a & b:
                    return e["id"]
        return None

    def _worker_mark_message(
        self, p_message_id: str, p_status: str, p_duplicate_of: str | None = None, p_extracted_text: str | None = None
    ) -> None:
        m = self.messages[p_message_id]
        m.update(status=p_status, duplicate_of=p_duplicate_of, extracted_text=p_extracted_text)

    def _worker_save_expense(self, p_message_id: str, p_data: dict[str, Any], p_max_distance: int = 12) -> dict:
        m = self.messages[p_message_id]
        if m["status"] in ("done", "not_expense", "duplicate"):
            return {"skipped": True, "status": m["status"]}
        if dup := self._worker_find_duplicate(
            CUENTA,
            p_data.get("cufe"),
            p_data.get("image_hash"),
            p_max_distance,
            p_data.get("total_cop"),
            p_data.get("expense_date"),
            p_data.get("extracted_text"),
        ):
            m.update(status="duplicate", duplicate_of=dup)
            return {"duplicate_of": dup}
        status = p_data["status"] if p_data.get("payer_person_id") and p_data.get("total_cop") else "pending_review"
        gasto = {**p_data, "id": str(uuid.uuid4()), "message_id": p_message_id, "status": status}
        if gasto.get("cufe"):
            gasto["cufe"] = gasto["cufe"].lower()
        self.expenses.append(gasto)
        m.update(status="done", extracted_text=p_data.get("extracted_text"))
        return {"expense_id": gasto["id"], "status": status}

    # cola
    def _worker_claim_jobs(self, p_worker: str, p_limit: int = 1, p_stale_after: str = "") -> list[dict[str, Any]]:
        tomados = [j for j in self.jobs.values() if j["status"] == "queued"][:p_limit]
        for j in tomados:
            j["status"] = "running"
        return copy.deepcopy(tomados)

    def _worker_take_over(self) -> bool:
        self.simulator_on, estaba = False, getattr(self, "simulator_on", True)
        return estaba

    def _worker_complete_job(self, p_job_id: str) -> None:
        self.jobs[p_job_id]["status"] = "done"

    def _worker_fail_job(self, p_job_id: str, p_error: str, p_detail: str | None = None, p_retryable: bool = True):
        j = self.jobs[p_job_id]
        self.errors.append({"job_id": p_job_id, "error": p_error, "retryable": p_retryable})
        j["status"] = "queued_later" if p_retryable and j["attempts"] < j["max_attempts"] else "failed"
        return "queued" if j["status"] == "queued_later" else "failed"


class FakeLlm:
    """Responde con lo que diga `responder(prompt_parts)`; guarda las llamadas."""

    model = "qwen-falso"

    def __init__(self, responder: Callable[[dict[str, Any]], ReceiptExtraction | Exception]):
        self.responder = responder
        self.calls: list[dict[str, Any]] = []

    def extract(self, **parts: Any) -> ReceiptExtraction:
        self.calls.append(parts)
        r = self.responder(parts)
        if isinstance(r, Exception):
            raise r
        return r


def llm_caido(_: dict[str, Any]) -> Exception:
    return LlmUnavailable("Ollama no respondió: ConnectError")


@pytest.fixture(scope="session")
def ocr() -> OcrEngine:
    return OcrEngine()


@pytest.fixture(scope="session")
def extractor(ocr: OcrEngine) -> Extractor:
    return Extractor(ocr)


@pytest.fixture
def db() -> FakeDb:
    return FakeDb()
