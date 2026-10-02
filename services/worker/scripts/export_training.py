"""Exporta los ejemplos de entrenamiento en el formato que Laya necesita.

Laya se ajusta con filas «typed decisions» (el mismo esquema del dataset
LocalLLaMA/typed-decisions que usa el notebook oficial): cada fila trae el
`state` que lee el modelo, las `questions` y la respuesta `gold`, cada uno como
JSON en texto.

    {"id": "te:…", "workflow": "lucas-categoria", "variant": "multilingual",
     "state": "{\"comercio\": \"Tienda Don Beto\", \"items\": [\"Leche\"]}",
     "questions": "{\"category\": {\"type\": \"choice\", \"instructions\": …, \"criteria\": {…}}}",
     "gold": "{\"category\": {\"label\": \"Mercado\", \"probabilities\": {\"Mercado\": 0.95, …}}}"}

El `state` sale de la misma función que usa el worker al clasificar
(lucas_worker/classify/question.py), así que lo que el modelo aprende es lo
que después va a leer.

Uso (desde services/worker, con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY):

    uv run python scripts/export_training.py                      # ejemplos nuevos, variante multilingüe
    uv run python scripts/export_training.py --variante ambas --incluir-confirmados --todos
    uv run python scripts/export_training.py --marcar             # y los marca como exportados

Sale una carpeta por variante con train.jsonl, test.jsonl, lucas_question.json
y stats.json, más un .zip listo para subir a Colab o Kaggle.

Privacidad: antes de salir del servidor se quitan de los textos los nombres
que siguen a «pagó»/«entre», y los números largos (teléfonos, cédulas, NIT).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lucas_worker.classify.categories import BY_NAME
from lucas_worker.classify.question import QUESTION_ID, ClassifyInput, build_state, default_question
from lucas_worker.config import LayaVariant

WORKFLOW = "lucas-categoria"

_PAGO = re.compile(r"\b(pag[oó]|pagad[oa]s?\s+por|invit[oó]|puso)\s+(el|la|los|las|lo)?\s*[^\W\d_]+", re.IGNORECASE)
_ENTRE = re.compile(r"\bentre\s+[^\n.;:]*", re.IGNORECASE)
_NUMEROS_LARGOS = re.compile(r"\b\d[\d .-]{6,}\d\b")


def scrub(texto: str | None) -> str | None:
    """Sin nombres de quién pagó ni números que identifiquen a alguien."""
    if not texto:
        return texto
    t = _PAGO.sub(r"\1", texto)
    t = _ENTRE.sub(" ", t)
    t = _NUMEROS_LARGOS.sub("#", t)
    return re.sub(r"[ \t]+", " ", t).strip()


def gold(label: str, labels: list[str], smoothing: float) -> dict[str, Any]:
    # Las demás reparten el suavizado; la correcta se queda con el resto, para que
    # la suma dé 1 aunque el redondeo a 6 decimales no reparta exacto (17 opciones)
    resto = round(smoothing / max(len(labels) - 1, 1), 6)
    correcta = round(1 - resto * (len(labels) - 1), 6)
    return {"label": label, "probabilities": {k: correcta if k == label else resto for k in labels}}


def is_test(row_id: str, pct: float) -> bool:
    """Partición estable: el mismo ejemplo siempre cae del mismo lado."""
    return int(hashlib.sha1(row_id.encode()).hexdigest()[:8], 16) % 1000 < pct * 1000


def build_rows(
    ejemplos: list[dict[str, Any]], variant: LayaVariant, smoothing: float = 0.05
) -> tuple[list[dict[str, Any]], Counter[str]]:
    base = default_question(variant)
    saltados: Counter[str] = Counter()
    filas = []
    for e in ejemplos:
        categoria = e.get("category")
        # Las categorías propias de la cuenta entran como opciones de ese ejemplo
        # (con su descripción), igual que al clasificar (question.for_account)
        propias = {c["name"]: c.get("description") for c in e.get("account_categories") or []}
        pregunta = base.for_account([*BY_NAME, *propias], propias) if propias else base
        categoria_a_etiqueta = {v: k for k, v in pregunta.label_to_category.items()}
        if categoria not in categoria_a_etiqueta:
            saltados[f"categoria propia: {categoria}"] += 1
            continue
        state = build_state(
            variant,
            ClassifyInput(
                merchant=scrub(e.get("merchant")),
                description_en=e.get("description"),
                message_text=scrub(e.get("message_text")),
                items=[scrub(i) or "" for i in e.get("items") or []],
                document_text=scrub(e.get("extracted_text")),
            ),
        )
        if not state:
            saltados["sin texto"] += 1
            continue
        etiqueta = categoria_a_etiqueta[categoria]
        etiquetas = list(pregunta.definition["criteria"])
        preguntas = json.dumps({QUESTION_ID: pregunta.definition}, ensure_ascii=False)
        filas.append(
            {
                "id": e["id"],
                "workflow": WORKFLOW,
                "variant": str(variant),
                "source": e.get("source"),
                "state": json.dumps(state, ensure_ascii=False),
                "questions": preguntas,
                "gold": json.dumps({QUESTION_ID: gold(etiqueta, etiquetas, smoothing)}, ensure_ascii=False),
            }
        )
    return filas, saltados


def write_variant(
    filas: list[dict[str, Any]], saltados: Counter[str], variant: LayaVariant, salida: Path, test_pct: float
) -> dict[str, Any]:
    d = salida / str(variant)
    d.mkdir(parents=True, exist_ok=True)
    train = [f for f in filas if not is_test(f["id"], test_pct)]
    test = [f for f in filas if is_test(f["id"], test_pct)]
    for nombre, parte in (("train.jsonl", train), ("test.jsonl", test)):
        with (d / nombre).open("w", encoding="utf-8") as fh:
            for f in parte:
                fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    pregunta = default_question(variant)
    (d / "lucas_question.json").write_text(
        json.dumps(
            {"variant": str(variant), "question": pregunta.definition, "label_to_category": pregunta.label_to_category},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    etiquetas = Counter(json.loads(f["gold"])[QUESTION_ID]["label"] for f in filas)
    stats = {
        "variant": str(variant),
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "train": len(train),
        "test": len(test),
        "labels": dict(etiquetas.most_common()),
        "skipped": dict(saltados),
    }
    (d / "stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    return stats


def fetch(args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.desde_json:
        return json.loads(Path(args.desde_json).read_text(encoding="utf-8"))
    from lucas_worker.config import get_settings
    from lucas_worker.supabase import Supabase

    s = get_settings()
    db = Supabase(s.supabase_url, s.supabase_service_role_key.get_secret_value())
    return db.rpc(
        "worker_training_export",
        {
            "p_since": args.desde,
            "p_include_confirmed": args.incluir_confirmados,
            "p_only_new": not args.todos,
            "p_limit": args.limite,
        },
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Ejemplos de entrenamiento de Lucas → formato de Laya")
    p.add_argument("--variante", choices=["multilingual", "english", "ambas"], default="multilingual")
    p.add_argument("--salida", type=Path, default=Path("laya-data"))
    p.add_argument("--incluir-confirmados", action="store_true", help="también los gastos confirmados sin corrección")
    p.add_argument("--todos", action="store_true", help="también los que ya se exportaron antes")
    p.add_argument("--desde", help="solo desde esta fecha (AAAA-MM-DD)")
    p.add_argument("--limite", type=int, default=20_000)
    p.add_argument("--prueba", type=float, default=0.15, help="fracción para evaluar (test.jsonl)")
    p.add_argument("--suavizado", type=float, default=0.05, help="probabilidad repartida entre las otras categorías")
    p.add_argument("--marcar", action="store_true", help="marca las correcciones como exportadas")
    p.add_argument("--desde-json", help="usar un JSON ya descargado en vez de Supabase")
    args = p.parse_args(argv)

    ejemplos = fetch(args)
    if not ejemplos:
        print("No hay ejemplos nuevos. Prueba con --todos o --incluir-confirmados.")
        return 0

    variantes = list(LayaVariant) if args.variante == "ambas" else [LayaVariant(args.variante)]
    for v in variantes:
        filas, saltados = build_rows(ejemplos, v, args.suavizado)
        stats = write_variant(filas, saltados, v, args.salida, args.prueba)
        print(f"{v}: {stats['train']} para entrenar, {stats['test']} para evaluar · {stats['labels']}")
        if saltados:
            print(f"  saltados: {dict(saltados)}")

    zip_path = shutil.make_archive(str(args.salida), "zip", root_dir=args.salida)
    print(f"Listo: {args.salida}/ y {zip_path} (súbelo al notebook de Colab o Kaggle)")

    if args.marcar and not args.desde_json:
        from lucas_worker.config import get_settings
        from lucas_worker.supabase import Supabase

        s = get_settings()
        db = Supabase(s.supabase_url, s.supabase_service_role_key.get_secret_value())
        ids = [e["training_id"] for e in ejemplos if e.get("training_id")]
        n = db.rpc("worker_mark_exported", {"p_training_ids": ids})
        print(f"{n} correcciones marcadas como exportadas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
