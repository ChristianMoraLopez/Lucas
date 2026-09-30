"""La cola: completar, reintentar, rendirse; y el cliente de Supabase."""

from __future__ import annotations

import httpx
import pytest

from lucas_worker.errors import PermanentError, RetryableError
from lucas_worker.pipeline import Job
from lucas_worker.queue import Worker
from lucas_worker.supabase import Supabase, SupabaseError

from .conftest import FakeDb, make_settings


class Procesador:
    def __init__(self, efecto):
        self.efecto = efecto
        self.vistos: list[Job] = []

    def process(self, job: Job) -> str:
        self.vistos.append(job)
        if isinstance(self.efecto, Exception):
            raise self.efecto
        return "gasto listo"


def worker(db: FakeDb, efecto) -> tuple[Worker, Procesador]:
    p = Procesador(efecto)
    return Worker(db, p, make_settings(), sleep=lambda _: None), p  # type: ignore[arg-type]


def test_bien_se_completa(db):
    job = db.add_job("m1")
    w, p = worker(db, None)
    assert w.run_once() == 1
    assert db.jobs[job["id"]]["status"] == "done"
    assert p.vistos[0].message_id == "m1" and p.vistos[0].attempts == 1


def test_error_pasajero_se_reintenta_y_queda_registrado(db):
    job = db.add_job("m1")
    w, _ = worker(db, RetryableError("Ollama no respondió"))
    w.run_once()
    assert db.jobs[job["id"]]["status"] == "queued_later"
    assert db.errors == [{"job_id": job["id"], "error": "Ollama no respondió", "retryable": True}]


def test_error_definitivo_no_se_reintenta(db):
    job = db.add_job("m1")
    w, _ = worker(db, PermanentError("PDF con clave"))
    w.run_once()
    assert db.jobs[job["id"]]["status"] == "failed"
    assert db.errors[0]["retryable"] is False


def test_error_de_supabase_4xx_no_se_reintenta(db):
    job = db.add_job("m1")
    w, _ = worker(db, SupabaseError("worker_save_expense: violates check", 400, retryable=False))
    w.run_once()
    assert db.jobs[job["id"]]["status"] == "failed"


def test_se_rinde_en_el_ultimo_intento(db):
    job = db.add_job("m1", attempts=5, max_attempts=5)
    w, _ = worker(db, ValueError("bug"))
    w.run_once()
    assert db.jobs[job["id"]]["status"] == "failed"


def test_si_no_puede_ni_registrar_el_error_sigue_vivo(db):
    db.add_job("m1")
    w, _ = worker(db, ValueError("bug"))

    def falla(**_):
        raise SupabaseError("sin red")

    db._worker_fail_job = falla  # type: ignore[method-assign]
    assert w.run_once() == 1  # no explota: el rescate de trabajos abandonados lo retoma


def test_run_forever_para_con_la_senal(db):
    db.add_job("m1")
    w, _ = worker(db, None)
    esperas: list[float] = []

    def dormir(s: float) -> None:
        esperas.append(s)
        w.stopping = True

    w.sleep = dormir
    w.run_forever()
    assert esperas == [w.settings.poll_interval_s]


def test_run_forever_aguanta_que_supabase_no_responda(db):
    w, _ = worker(db, None)
    llamadas = {"n": 0}

    def claim_roto(**_):
        llamadas["n"] += 1
        if llamadas["n"] >= 3:
            w.stopping = True
        raise SupabaseError("503")

    db._worker_claim_jobs = claim_roto  # type: ignore[method-assign]
    esperas: list[float] = []
    w.sleep = esperas.append
    w.run_forever()
    assert len(esperas) == 3 and esperas[0] < esperas[1] < esperas[2]


# ---------------------------------------------------------------------------
# Cliente de Supabase
# ---------------------------------------------------------------------------


def _supabase(key: str, manejar) -> Supabase:
    return Supabase("https://x.supabase.co/", key, client=httpx.Client(transport=httpx.MockTransport(manejar)))


def test_llave_nueva_va_solo_en_apikey():
    vistos: list[httpx.Request] = []

    def manejar(r: httpx.Request) -> httpx.Response:
        vistos.append(r)
        return httpx.Response(200, json=[{"id": "j1"}])

    assert _supabase("sb_secret_abc", manejar).rpc("worker_claim_jobs", {"p_worker": "w"}) == [{"id": "j1"}]
    assert vistos[0].url.path == "/rest/v1/rpc/worker_claim_jobs"
    assert vistos[0].headers["apikey"] == "sb_secret_abc" and "authorization" not in vistos[0].headers
    _supabase("eyJhbGciOi.jwt.firma", manejar).rpc("x")
    assert vistos[1].headers["authorization"] == "Bearer eyJhbGciOi.jwt.firma"


def test_reintenta_5xx_y_luego_se_rinde(monkeypatch):
    monkeypatch.setattr("lucas_worker.supabase.time.sleep", lambda _: None)
    respuestas = [httpx.Response(503), httpx.Response(200, json=None)]
    assert _supabase("k", lambda r: respuestas.pop(0)).rpc("x") is None
    with pytest.raises(SupabaseError):
        _supabase("k", lambda r: httpx.Response(502)).rpc("x")


def test_error_de_la_funcion_no_se_reintenta():
    s = _supabase("k", lambda r: httpx.Response(400, json={"message": "El mensaje no existe"}))
    with pytest.raises(SupabaseError, match="El mensaje no existe") as e:
        s.rpc("worker_save_expense")
    assert e.value.retryable is False


def test_descarga_de_storage():
    def manejar(r: httpx.Request) -> httpx.Response:
        if r.url.raw_path == b"/storage/v1/object/evidencias/cuenta/foto%20uno.webp":
            return httpx.Response(200, content=b"img")
        return httpx.Response(404)

    s = _supabase("k", manejar)
    assert s.download("evidencias", "cuenta/foto uno.webp") == b"img"
    with pytest.raises(PermanentError):
        s.download("evidencias", "cuenta/no.webp")
