"""El ciclo del worker: tomar trabajos, procesarlos y reportar.

- `worker_claim_jobs` los toma con FOR UPDATE SKIP LOCKED (pueden correr varios
  workers) y rescata los que un worker dejó a medias.
- Bien → `worker_complete_job`. Mal → `worker_fail_job`, que registra el error
  en `job_errors` y decide: otra vez con espera (30 s, 1, 2, 4… min) o se rinde
  al llegar a `max_attempts`. `PermanentError` no se reintenta.
- Cada trabajo va con su scope de Sentry; SIGTERM termina el trabajo en curso
  y sale (docker stop).
"""

from __future__ import annotations

import contextlib
import logging
import signal
import time
import traceback
from collections.abc import Callable
from pathlib import Path

from .config import Settings
from .errors import PermanentError
from .observability import capture, job_scope
from .pipeline import Job, MessageProcessor
from .supabase import Database

log = logging.getLogger(__name__)


class Worker:
    def __init__(
        self,
        db: Database,
        processor: MessageProcessor,
        settings: Settings,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.db = db
        self.processor = processor
        self.settings = settings
        self.sleep = sleep
        self.stopping = False

    # -- señales y latido ------------------------------------------------------

    def install_signal_handlers(self) -> None:
        def parar(signum: int, _frame: object) -> None:
            log.info("Señal %s: termino el trabajo en curso y salgo", signal.Signals(signum).name)
            self.stopping = True

        signal.signal(signal.SIGTERM, parar)
        signal.signal(signal.SIGINT, parar)

    def heartbeat(self) -> None:
        with contextlib.suppress(OSError):
            Path(self.settings.heartbeat_file).write_text(str(int(time.time())))

    # -- cola ------------------------------------------------------------------

    def take_over(self) -> bool:
        """Apaga el procesador simulado de la base (si seguía prendido): desde ya la cola es del worker."""
        try:
            apagado = bool(self.db.rpc("worker_take_over"))
        except Exception as e:
            log.warning("No se pudo apagar el procesador simulado: %s", e)
            return False
        if apagado:
            log.info("Procesador simulado apagado: desde ahora la cola es del worker")
        return apagado

    def claim(self) -> list[Job]:
        filas = self.db.rpc(
            "worker_claim_jobs",
            {
                "p_worker": self.settings.worker_id,
                "p_limit": self.settings.batch_size,
                "p_stale_after": f"{self.settings.stale_after_minutes} minutes",
            },
        )
        return [Job.from_row(f) for f in filas or []]

    def handle(self, job: Job) -> bool:
        """Procesa un trabajo. True si salió bien."""
        base = {"job_id": job.id, "message_id": job.message_id, "attempt": job.attempts}
        inicio = time.perf_counter()
        with job_scope(job.id, job.message_id, job.attempts):
            try:
                resultado = self.processor.process(job)
            except Exception as e:
                retryable = not isinstance(e, PermanentError) and getattr(e, "retryable", True)
                detalle = "".join(traceback.format_exception(e))[-8000:]
                try:
                    params = {
                        "p_job_id": job.id,
                        "p_error": str(e)[:1000] or type(e).__name__,
                        "p_detail": detalle,
                        "p_retryable": retryable,
                    }
                    estado = self.db.rpc("worker_fail_job", params)
                except Exception:
                    log.exception("Tampoco se pudo registrar el error; el rescate de la cola lo retoma", extra=base)
                    estado = "sin registrar"
                final = estado != "queued"
                log.log(
                    logging.ERROR if final else logging.WARNING,
                    "Trabajo con error: %s",
                    e,
                    extra={**base, "outcome": estado, "detail": type(e).__name__},
                )
                capture(e, level="error" if final else "warning", final=final, retryable=retryable)
                return False
            try:
                self.db.rpc("worker_complete_job", {"p_job_id": job.id})
            except Exception as e:
                # El gasto ya quedó guardado; si el trabajo se rescata, verá el mensaje procesado y listo
                log.warning("No se pudo cerrar el trabajo: %s", e, extra=base)
            ms = round((time.perf_counter() - inicio) * 1000)
            log.info("Trabajo listo: %s", resultado, extra={**base, "elapsed_ms": ms, "outcome": "done"})
            return True

    def run_once(self) -> int:
        """Procesa lo que haya en la cola y devuelve cuántos trabajos tomó."""
        total = 0
        while not self.stopping:
            jobs = self.claim()
            if not jobs:
                break
            for job in jobs:
                self.handle(job)
                total += 1
            self.heartbeat()
        return total

    def run_forever(self) -> None:
        log.info("Worker listo", extra={"detail": self.settings.worker_id})
        errores_seguidos = 0
        while not self.stopping:
            self.heartbeat()
            try:
                jobs = self.claim()
                errores_seguidos = 0
            except Exception as e:
                errores_seguidos += 1
                espera = min(60.0, self.settings.poll_interval_s * 2**errores_seguidos)
                log.warning("No se pudo leer la cola (%s); reintento en %.0f s", e, espera)
                if errores_seguidos in (3, 10, 50):
                    capture(e, level="error", stage="claim")
                self.sleep(espera)
                continue
            if not jobs:
                self.sleep(self.settings.poll_interval_s)
                continue
            for job in jobs:
                self.handle(job)
                if self.stopping:
                    break
        log.info("Worker detenido")
