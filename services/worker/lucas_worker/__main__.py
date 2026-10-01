"""Línea de comandos del worker.

python -m lucas_worker            # corre para siempre (lo que hace Docker)
python -m lucas_worker once       # procesa lo que haya en la cola y sale
python -m lucas_worker check      # revisa Supabase, Ollama, OCR y Laya antes de desplegar
python -m lucas_worker warmup     # baja/carga los modelos (en el build de Docker: --ocr-only)
python -m lucas_worker health     # para el HEALTHCHECK de Docker (latido reciente)
"""

from __future__ import annotations

import argparse
import logging
import sys
import time

from . import __version__

log = logging.getLogger("lucas_worker")


def _componentes(settings):
    from .classify.classifier import CategoryClassifier
    from .classify.laya import load_laya
    from .extract.cascade import Extractor
    from .extract.ocr import OcrEngine
    from .llm.ollama import OllamaClient
    from .pipeline import MessageProcessor
    from .queue import Worker
    from .supabase import Supabase

    db = Supabase(settings.supabase_url, settings.supabase_service_role_key.get_secret_value())
    ocr = OcrEngine(threads=settings.ocr_threads, max_side=settings.ocr_max_side)
    extractor = Extractor(ocr, pdf_max_pages=settings.pdf_max_pages, max_side=settings.ocr_max_side)
    llm = (
        OllamaClient(
            settings.ollama_base_url,
            settings.ollama_model,
            timeout=settings.ollama_timeout_s,
            num_ctx=settings.ollama_num_ctx,
            keep_alive=settings.ollama_keep_alive,
        )
        if settings.llm_enabled
        else None
    )
    classifier = CategoryClassifier(load_laya(settings))
    processor = MessageProcessor(db, extractor, classifier, settings, llm)
    return Worker(db, processor, settings), ocr, llm, classifier


def cmd_run(once: bool) -> int:
    from .config import get_settings
    from .observability import init_sentry, setup_logging

    settings = get_settings()
    setup_logging(settings)
    init_sentry(settings)
    log.info("Luks worker %s", __version__, extra={"detail": f"modelo {settings.ollama_model}"})
    worker, ocr, _llm, _cls = _componentes(settings)
    ocr.warmup()
    worker.install_signal_handlers()
    worker.take_over()
    if once:
        n = worker.run_once()
        log.info("Cola vacía: %d trabajos", n)
    else:
        worker.run_forever()
    return 0


def cmd_check() -> int:
    """Todo lo que el worker necesita, uno por uno, con un mensaje claro si algo falta."""
    from .config import get_settings
    from .observability import setup_logging

    settings = get_settings()
    setup_logging(settings)
    worker, ocr, llm, classifier = _componentes(settings)
    ok = True

    def paso(nombre: str, fn) -> None:
        nonlocal ok
        t = time.perf_counter()
        try:
            detalle = fn()
            print(f"  ✓ {nombre}: {detalle} ({(time.perf_counter() - t) * 1000:.0f} ms)")
        except Exception as e:
            ok = False
            print(f"  ✗ {nombre}: {e}")

    print(f"Luks worker {__version__}")
    paso("Supabase (RPC del worker)", lambda: _probar_supabase(worker.db))
    paso("OCR (RapidOCR)", lambda: (ocr.warmup(), "modelos cargados")[1])
    if llm is not None:
        paso(f"Ollama ({settings.ollama_base_url})", llm.ping)
    else:
        print("  - Ollama: apagado (LLM_ENABLED=false)")
    modelo = classifier.model
    print(f"  {'✓' if modelo else '-'} Laya: {modelo.name if modelo else 'sin modelo: memoria y palabras clave'}")
    print("  ✓ Sentry: configurado" if settings.sentry_dsn else "  - Sentry: sin DSN")
    return 0 if ok else 1


def _probar_supabase(db) -> str:
    # Una llamada inofensiva: una cuenta que no existe no devuelve duplicados
    db.rpc(
        "worker_find_duplicate",
        {"p_account_id": "00000000-0000-0000-0000-000000000000", "p_cufe": None, "p_image_hash": None},
    )
    return "conectado"


def cmd_warmup(ocr_only: bool) -> int:
    from .extract.ocr import OcrEngine

    OcrEngine().warmup()
    print("OCR listo")
    if ocr_only:
        return 0
    from .classify.laya import load_laya
    from .config import get_settings

    modelo = load_laya(get_settings())
    print(f"Laya: {modelo.name if modelo else 'no configurado'}")
    return 0


def cmd_health(max_age: int) -> int:
    import os
    from pathlib import Path

    archivo = Path(os.environ.get("HEARTBEAT_FILE", "/tmp/lucas-worker-heartbeat"))
    try:
        edad = time.time() - int(archivo.read_text())
    except (OSError, ValueError):
        print("sin latido")
        return 1
    print(f"latido hace {edad:.0f} s")
    return 0 if edad <= max_age else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lucas-worker", description="Worker de Luks: recibos → gastos")
    sub = parser.add_subparsers(dest="cmd")
    sub.add_parser("run", help="procesa la cola para siempre (por defecto)")
    sub.add_parser("once", help="procesa lo que haya y sale")
    sub.add_parser("check", help="revisa conexiones y modelos")
    w = sub.add_parser("warmup", help="carga (y baja) los modelos")
    w.add_argument("--ocr-only", action="store_true")
    h = sub.add_parser("health", help="latido reciente (HEALTHCHECK)")
    h.add_argument("--max-age", type=int, default=600)
    args = parser.parse_args(argv)

    if args.cmd in (None, "run"):
        return cmd_run(once=False)
    if args.cmd == "once":
        return cmd_run(once=True)
    if args.cmd == "check":
        return cmd_check()
    if args.cmd == "warmup":
        return cmd_warmup(args.ocr_only)
    if args.cmd == "health":
        return cmd_health(args.max_age)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
