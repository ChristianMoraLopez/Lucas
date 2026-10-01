"""OCR con RapidOCR (modelos PP-OCR sobre ONNX Runtime, en CPU).

RapidOCR devuelve cajas sueltas; aquí se arman renglones (misma altura, de
izquierda a derecha) para que «TOTAL» y «$11.300» queden en la misma línea,
que es lo que buscan las reglas y lo que entiende mejor el LLM.

Los modelos vienen dentro del paquete `rapidocr`: no se descarga nada.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field

import numpy as np

log = logging.getLogger(__name__)


@dataclass
class OcrLine:
    text: str
    score: float
    top: float
    bottom: float
    left: float


@dataclass
class OcrResult:
    lines: list[OcrLine] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n".join(ln.text for ln in self.lines)

    @property
    def quality(self) -> float:
        """Confianza media del OCR, pesada por largo del texto (0 si no leyó nada)."""
        total = sum(len(ln.text) for ln in self.lines)
        if not total:
            return 0.0
        return sum(ln.score * len(ln.text) for ln in self.lines) / total

    @property
    def chars(self) -> int:
        return sum(len(ln.text.strip()) for ln in self.lines)

    def score(self) -> float:
        """Para elegir entre dos lecturas de la misma foto: cuánto texto y qué tan seguro."""
        return self.chars * self.quality**2


def group_lines(boxes: list[np.ndarray], texts: list[str], scores: list[float]) -> list[OcrLine]:
    """Cajas de RapidOCR → renglones ordenados de arriba abajo."""
    piezas = []
    for box, txt, sc in zip(boxes, texts, scores, strict=False):
        b = np.asarray(box, dtype=float).reshape(-1, 2)
        piezas.append((b[:, 1].min(), b[:, 1].max(), b[:, 0].min(), txt.strip(), float(sc)))
    piezas = [p for p in piezas if p[3]]
    piezas.sort(key=lambda p: ((p[0] + p[1]) / 2, p[2]))

    renglones: list[list[tuple[float, float, float, str, float]]] = []
    for p in piezas:
        centro = (p[0] + p[1]) / 2
        alto = p[1] - p[0]
        for r in renglones:
            r_top = sum(x[0] for x in r) / len(r)
            r_bot = sum(x[1] for x in r) / len(r)
            if abs(centro - (r_top + r_bot) / 2) <= 0.5 * min(alto, r_bot - r_top):
                r.append(p)
                break
        else:
            renglones.append([p])

    out = []
    for r in renglones:
        r.sort(key=lambda x: x[2])
        largo = sum(len(x[3]) for x in r)
        out.append(
            OcrLine(
                text=" ".join(x[3] for x in r),
                score=sum(x[4] * len(x[3]) for x in r) / max(largo, 1),
                top=min(x[0] for x in r),
                bottom=max(x[1] for x in r),
                left=min(x[2] for x in r),
            )
        )
    out.sort(key=lambda ln: ln.top)
    return out


class OcrEngine:
    """RapidOCR perezoso y compartido (cargar los modelos toma un momento)."""

    def __init__(self, threads: int = 0, max_side: int = 2000):
        self.threads = threads
        self.max_side = max_side
        self._engine = None
        self._lock = threading.Lock()

    def _get(self):
        with self._lock:
            if self._engine is None:
                from rapidocr import RapidOCR

                params: dict[str, object] = {"Global.log_level": "error", "Global.max_side_len": self.max_side}
                if self.threads > 0:
                    params["EngineConfig.onnxruntime.intra_op_num_threads"] = self.threads
                self._engine = RapidOCR(params=params)
            return self._engine

    def warmup(self) -> None:
        self.read(np.full((64, 256, 3), 255, dtype=np.uint8))

    def read(self, img: np.ndarray) -> OcrResult:
        r = self._get()(img)
        if r is None or r.boxes is None or r.txts is None:
            return OcrResult()
        return OcrResult(group_lines(list(r.boxes), list(r.txts), list(r.scores)))
