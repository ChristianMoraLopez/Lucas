"""PDFs: texto directo con pdfplumber; si no tiene texto (escaneado), imágenes para OCR."""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field

import cv2
import numpy as np

from ..errors import PermanentError

log = logging.getLogger(__name__)

# Menos de esto por página y se trata como escaneado
MIN_CHARS_PER_PAGE = 40


@dataclass
class PdfContent:
    pages_text: list[str] = field(default_factory=list)
    page_count: int = 0

    @property
    def text(self) -> str:
        return "\n".join(t for t in self.pages_text if t).strip()

    @property
    def is_scanned(self) -> bool:
        leidas = max(len(self.pages_text), 1)
        return len(self.text) < MIN_CHARS_PER_PAGE * min(leidas, 2)


def _abrir(data: bytes):
    import pdfplumber

    try:
        return pdfplumber.open(io.BytesIO(data))
    except Exception as e:  # pdfminer lanza de todo: PDFSyntaxError, PDFPasswordIncorrect…
        raise PermanentError(f"No pudimos abrir el PDF (¿tiene clave o está dañado?): {type(e).__name__}") from e


def read_pdf(data: bytes, max_pages: int = 4) -> PdfContent:
    with _abrir(data) as pdf:
        out = PdfContent(page_count=len(pdf.pages))
        for page in pdf.pages[:max_pages]:
            try:
                out.pages_text.append(page.extract_text(x_tolerance=1.5, y_tolerance=3) or "")
            except Exception as e:
                log.warning("pdfplumber no pudo leer una página: %s", type(e).__name__)
                out.pages_text.append("")
        return out


def render_pages(data: bytes, pages: int = 2, resolution: int = 200) -> list[np.ndarray]:
    """Primeras páginas como imágenes BGR (para OCR y para buscar el QR)."""
    imgs = []
    with _abrir(data) as pdf:
        for page in pdf.pages[:pages]:
            pil = page.to_image(resolution=resolution).original.convert("RGB")
            imgs.append(cv2.cvtColor(np.asarray(pil), cv2.COLOR_RGB2BGR))
    return imgs
