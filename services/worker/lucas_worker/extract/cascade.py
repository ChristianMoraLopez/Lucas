"""La cascada de extracción: de lo más barato y seguro a lo más caro.

    texto  → reglas (montos colombianos, fechas, «la pagó X»)
    PDF    → pdfplumber (texto digital, exacto) → si no hay texto: página a imagen → OCR
             + CUFE del texto, o el QR de la primera página si el texto no lo trae
    foto   → QR DIAN con zxing-cpp (total, fecha, NIT y CUFE casi seguros)
             → OpenCV (papel, perspectiva, inclinación, contraste) → RapidOCR
             → si la versión mejorada lee peor que la original, se queda la original

Todo lo que sale de aquí son datos crudos más pistas; el LLM los estructura y
`validate.py` decide qué tan confiable es cada campo.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date

import numpy as np

from ..errors import PermanentError
from . import image as im
from .ocr import OcrEngine, OcrResult
from .pdf import read_pdf, render_pages
from .qr_dian import DianQr, find_dian_qr
from .rules import Hints, analyze_document, analyze_message

log = logging.getLogger(__name__)

# Por debajo de esto el OCR se intenta también sobre la foto original
OCR_BUENO = 0.85


@dataclass
class Extraction:
    kind: str  # photo | pdf | text
    method: str  # text | pdf_text | pdf_ocr | photo_ocr
    text: str = ""  # lo que se leyó del documento (o el mensaje, si es texto)
    caption: str | None = None  # el mensaje que acompañaba la foto o el PDF
    quality: float = 1.0  # 1 para texto y PDF digital; confianza media del OCR si no
    qr: DianQr | None = None
    image_hash: str | None = None
    hints: Hints = field(default_factory=Hints)  # del documento (o del mensaje)
    caption_hints: Hints = field(default_factory=Hints)
    steps: list[str] = field(default_factory=list)

    @property
    def cufe(self) -> str | None:
        return (self.qr.cufe if self.qr else None) or self.hints.cufe

    @property
    def stored_text(self) -> str:
        """Lo que se guarda en messages.extracted_text."""
        partes = [self.text]
        if self.qr:
            partes.append(f"[QR DIAN]\n{self.qr.raw}")
        return "\n\n".join(p for p in partes if p).strip()[:20000]


class Extractor:
    def __init__(self, ocr: OcrEngine, *, pdf_max_pages: int = 4, max_side: int = 2000):
        self.ocr = ocr
        self.pdf_max_pages = pdf_max_pages
        self.max_side = max_side

    # -- fotos ---------------------------------------------------------------

    def load_photo(self, data: bytes) -> tuple[np.ndarray, str]:
        """La imagen y su huella: con la huella se buscan duplicados antes de gastar CPU en OCR."""
        img = im.load_image(data)
        return img, im.perceptual_hash(img)

    def _ocr_mejor(self, candidatos: list[tuple[str, np.ndarray]], steps: list[str]) -> OcrResult:
        mejor: OcrResult | None = None
        nombre = ""
        for etiqueta, variante in candidatos:
            r = self.ocr.read(variante)
            if mejor is None or r.score() > mejor.score():
                mejor, nombre = r, etiqueta
            if mejor.quality >= OCR_BUENO and mejor.chars >= 40:
                break
        steps.append(f"ocr:{nombre}")
        return mejor or OcrResult()

    def photo(self, img: np.ndarray, image_hash: str | None, caption: str | None, today: date) -> Extraction:
        steps: list[str] = []
        base = im.resize_long_side(img, self.max_side)
        derecha, pasos = im.straighten(base)
        steps += pasos

        qr = find_dian_qr(im.qr_variants(base)) or (find_dian_qr(im.qr_variants(derecha)) if pasos else None)
        if qr:
            steps.append("qr")

        ocr = self._ocr_mejor([("mejorada", im.enhance(derecha)), ("original", base)], steps)
        ex = Extraction(
            kind="photo",
            method="photo_ocr",
            text=ocr.text,
            caption=caption,
            quality=round(ocr.quality, 3),
            qr=qr,
            image_hash=image_hash,
            hints=analyze_document(ocr.text, today),
            caption_hints=analyze_message(caption, today),
            steps=steps,
        )
        if not ocr.chars and not qr:
            raise PermanentError("No encontramos texto ni QR en la foto")
        return ex

    # -- PDFs ----------------------------------------------------------------

    def pdf(self, data: bytes, caption: str | None, today: date) -> Extraction:
        contenido = read_pdf(data, self.pdf_max_pages)
        steps = [f"pdf:{contenido.page_count}p"]
        if not contenido.is_scanned:
            texto = contenido.text
            hints = analyze_document(texto, today)
            qr = None
            if not hints.cufe:
                # Sin CUFE en el texto: se busca el QR en la primera página
                qr = find_dian_qr(im.qr_variants(render_pages(data, pages=1)[0]))
                if qr:
                    steps.append("qr")
            steps.append("pdfplumber")
            return Extraction(
                kind="pdf",
                method="pdf_text",
                text=texto,
                caption=caption,
                quality=1.0,
                qr=qr,
                hints=hints,
                caption_hints=analyze_message(caption, today),
                steps=steps,
            )

        # Escaneado: cada página a imagen, QR en la primera y OCR
        paginas = render_pages(data, pages=min(2, self.pdf_max_pages))
        if not paginas:
            raise PermanentError("El PDF no tiene páginas")
        qr = find_dian_qr(im.qr_variants(paginas[0]))
        if qr:
            steps.append("qr")
        textos, calidades = [], []
        for pagina in paginas:
            derecha, _ = im.straighten(im.resize_long_side(pagina, self.max_side))
            r = self._ocr_mejor([("mejorada", im.enhance(derecha)), ("original", pagina)], steps)
            textos.append(r.text)
            calidades.append(r.quality)
        texto = "\n".join(t for t in textos if t)
        if not texto and not qr:
            raise PermanentError("El PDF no tiene texto que se pueda leer")
        return Extraction(
            kind="pdf",
            method="pdf_ocr",
            text=texto,
            caption=caption,
            quality=round(float(np.mean(calidades)) if calidades else 0.0, 3),
            qr=qr,
            hints=analyze_document(texto, today),
            caption_hints=analyze_message(caption, today),
            steps=steps,
        )

    # -- mensajes ------------------------------------------------------------

    def text(self, body: str | None, today: date) -> Extraction:
        texto = (body or "").strip()
        return Extraction(
            kind="text",
            method="text",
            text=texto,
            quality=1.0,
            hints=analyze_message(texto, today),
            steps=["reglas"],
        )
