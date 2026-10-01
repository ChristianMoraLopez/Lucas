"""QR DIAN, fotos, OCR y PDFs con los recibos de ejemplo (tests/fixtures)."""

from datetime import date

import numpy as np
import pytest

from lucas_worker.errors import PermanentError
from lucas_worker.extract import image as im
from lucas_worker.extract.ocr import group_lines
from lucas_worker.extract.qr_dian import parse_dian_qr

from .conftest import HOY, fixture_bytes

CUFE = "3a" * 48


def test_qr_dian_con_dos_puntos_o_igual():
    for sep in (": ", "="):
        texto = (
            f"NumFac{sep}SETP990004217\nFecFac{sep}2026-09-26\nNitFac{sep}900123456\n"
            f"ValFac{sep}9495.80\nValIva{sep}1804.20\nValTolFac{sep}11300.00\nCUFE{sep}{CUFE}"
        )
        qr = parse_dian_qr(texto)
        assert qr is not None
        assert (qr.number, qr.issued_on, qr.nit, qr.total, qr.tax, qr.cufe) == (
            "SETP990004217",
            date(2026, 9, 26),
            "900123456",
            11_300,
            1_804,
            CUFE,
        )


def test_qr_dian_en_una_sola_linea_y_solo_url():
    qr = parse_dian_qr(f"NumFac: FE77 FecFac: 2026-09-22 ValTolFac: 244912.00 CUFE: {CUFE}")
    assert (qr.number, qr.total, qr.cufe) == ("FE77", 244_912, CUFE)
    solo_url = parse_dian_qr(f"https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey={CUFE.upper()}")
    assert solo_url.cufe == CUFE and solo_url.total is None


def test_qr_que_no_es_de_la_dian():
    assert parse_dian_qr("https://instagram.com/panaderia") is None
    assert parse_dian_qr("") is None


def test_renglones_del_ocr():
    cajas = [
        np.array([[200, 100], [260, 100], [260, 120], [200, 120]]),  # 11.300 a la derecha
        np.array([[10, 102], [80, 102], [80, 122], [10, 122]]),  # TOTAL, un poco más abajo
        np.array([[10, 10], [150, 10], [150, 30], [10, 30]]),
    ]
    renglones = group_lines(cajas, ["11.300", "TOTAL", "PANADERIA"], [0.99, 0.98, 0.97])
    assert [r.text for r in renglones] == ["PANADERIA", "TOTAL 11.300"]


def test_foto_limpia_con_qr(extractor):
    img, h = extractor.load_photo(fixture_bytes("recibo_panaderia.png"))
    ex = extractor.photo(img, h, "la pagó Santi", HOY)
    assert ex.qr and ex.qr.total == 11_300 and ex.qr.issued_on == date(2026, 9, 26)
    assert ex.cufe and len(ex.cufe) == 96
    assert ex.hints.total_candidates == [11_300]
    assert "PANADERIA LA ESPIGA" in ex.text
    assert ex.quality > 0.9
    assert "[QR DIAN]" in ex.stored_text


def test_foto_de_celular_se_endereza_y_se_lee(extractor):
    img, h = extractor.load_photo(fixture_bytes("recibo_panaderia_foto.jpg"))
    ex = extractor.photo(img, h, None, HOY)
    assert "perspectiva" in ex.steps
    assert ex.qr and ex.qr.total == 11_300
    assert ex.hints.total_candidates == [11_300]
    assert ex.hints.subtotal == 9_496
    assert [d.value for d in ex.hints.dates] == [date(2026, 9, 26)]


def test_recibo_sin_qr(extractor):
    img, h = extractor.load_photo(fixture_bytes("recibo_tienda.jpg"))
    ex = extractor.photo(img, h, None, HOY)
    assert ex.qr is None and ex.cufe is None
    assert ex.hints.total_candidates == [45_600]
    assert ex.hints.merchant_guess == "TIENDA DON BETO"


def test_huella_igual_para_la_misma_foto_y_distinta_para_otra(extractor):
    _, original = extractor.load_photo(fixture_bytes("recibo_panaderia_foto.jpg"))
    _, recomprimida = extractor.load_photo(fixture_bytes("recibo_panaderia_otra.webp"))
    _, otra = extractor.load_photo(fixture_bytes("recibo_tienda.jpg"))
    assert len(original) == 64
    assert im.hash_distance(original, recomprimida) <= 12
    assert im.hash_distance(original, otra) > 40


def test_imagen_danada():
    with pytest.raises(PermanentError):
        im.load_image(b"no soy una imagen")


def test_pdf_digital(extractor):
    ex = extractor.pdf(fixture_bytes("factura_energia.pdf"), None, HOY)
    assert ex.method == "pdf_text" and ex.quality == 1.0
    assert ex.hints.total_candidates == [244_912]
    assert ex.cufe and len(ex.cufe) == 96
    assert ex.hints.nit == "802007670-6"
    assert ex.hints.dates[0].value == date(2026, 9, 22)


def test_pdf_escaneado_va_por_ocr(extractor):
    ex = extractor.pdf(fixture_bytes("factura_escaneada.pdf"), None, HOY)
    assert ex.method == "pdf_ocr"
    assert ex.hints.total_candidates == [45_600]


def test_pdf_danado(extractor):
    with pytest.raises(PermanentError):
        extractor.pdf(b"%PDF-1.4 roto", None, HOY)


def test_enderezar_no_rompe_una_imagen_en_blanco():
    blanca = np.full((400, 300, 3), 255, dtype=np.uint8)
    out, pasos = im.straighten(blanca)
    assert out.shape[2] == 3 and pasos == []
