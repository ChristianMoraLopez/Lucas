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


def _foto_con_qr_chico(px_modulo: float, borroso: float) -> np.ndarray:
    """La parte de abajo de un recibo fotografiada por WhatsApp: el QR de la DIAN denso y
    chiquito, y debajo uno grande de la app del supermercado. Girada, borrosa y en JPEG."""
    import cv2
    import zxingcpp

    def modulos(texto: str) -> np.ndarray:
        bc = zxingcpp.create_barcode(texto, zxingcpp.BarcodeFormat.QRCode)
        return np.array(zxingcpp.write_barcode_to_image(bc, scale=1, add_quiet_zones=False))

    def pegar(foto: np.ndarray, mods: np.ndarray, x: int, y: int, px: float) -> int:
        lado = round(mods.shape[0] * px)
        grande = cv2.resize(mods, None, fx=16, fy=16, interpolation=cv2.INTER_NEAREST)
        chico = cv2.resize(grande, (lado, lado), interpolation=cv2.INTER_AREA)
        zona = foto[y : y + lado, x : x + lado]
        foto[y : y + lado, x : x + lado] = np.where(chico < 128, 40 + chico * 0.3, zona).astype(np.uint8)
        return lado

    dian = modulos(
        "NumFac:UZ8612345\nFecFac:2026-11-02\nHorFac:13:47:18-05:00\nNitFac:890930534\nDocAdq:1020304050\n"
        f"ValFac:857.00\nValIva:163.00\nValOtroIm:0.00\nValTolFac:1020.00\nCUFE:{CUFE}\n"
        f"QRCode:https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey={CUFE}"
    )
    foto = np.full((1600, 1200), 120, np.uint8)
    foto[:, 150:1050] = 236
    lado = pegar(foto, dian, 600 - round(dian.shape[0] * px_modulo) // 2, 600, px_modulo)
    pegar(foto, modulos("https://www.supermercado.example/descuentos"), 460, 600 + lado + 60, 9)
    foto = cv2.warpAffine(foto, cv2.getRotationMatrix2D((600, 800), 3.5, 1.0), (1200, 1600), borderValue=120)
    foto = cv2.GaussianBlur(foto, (0, 0), borroso)
    color = cv2.cvtColor(foto, cv2.COLOR_GRAY2BGR)
    for calidad in (75, 80):  # WhatsApp y el connector
        _, buf = cv2.imencode(".jpg", color, [cv2.IMWRITE_JPEG_QUALITY, calidad])
        color = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return color


@pytest.mark.parametrize(("px_modulo", "borroso"), [(3.2, 1.0), (2.6, 1.1)])
def test_qr_de_la_dian_chiquito_y_borroso_con_otro_qr_al_lado(px_modulo, borroso):
    # El QR de la app del supermercado se lee primero: no para la búsqueda del de la DIAN,
    # que se encuentra agrandándolo y subiéndole la nitidez
    from lucas_worker.extract.qr_dian import find_dian_qr

    foto = im.resize_long_side(_foto_con_qr_chico(px_modulo, borroso), 2000)
    qr = find_dian_qr(im.qr_variants(foto))
    assert qr is not None
    assert (qr.total, qr.tax, qr.cufe) == (1_020, 163, CUFE)
