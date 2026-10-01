"""Genera los recibos de ejemplo de tests/fixtures/ (ya están en el repo).

    uv run python scripts/make_fixtures.py

Son recibos inventados, con los comercios de ejemplo del kit de diseño:
  · recibo_panaderia.png        POS electrónico con QR DIAN (CUFE, total y fecha)
  · recibo_panaderia_foto.jpg   el mismo, «fotografiado»: sobre una mesa, girado,
                                con perspectiva, sombra y ruido, en JPEG
  · recibo_panaderia_otra.webp  la misma foto recomprimida y más pequeña (duplicado)
  · recibo_tienda.jpg           tienda de barrio sin QR, total 45.600
  · factura_energia.pdf         factura digital con texto y CUFE (pdfplumber)
  · factura_escaneada.pdf       PDF que es solo una imagen (OCR)
"""

from __future__ import annotations

import hashlib
import random
from pathlib import Path

import cv2
import numpy as np
import zxingcpp
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
# Un CUFE es un SHA-384 en hex: 96 caracteres
CUFE = hashlib.sha384(b"lucas-panaderia-la-espiga-SETP990004217").hexdigest()
CUFE_ENERGIA = hashlib.sha384(b"lucas-energia-FEC1045887").hexdigest()
FUENTES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
]


def fuente(tam: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for ruta in FUENTES:
        if Path(ruta).exists():
            return ImageFont.truetype(ruta, tam)
    return ImageFont.load_default(size=tam)


def recibo(lineas: list[str], qr_texto: str | None, ancho: int = 560) -> Image.Image:
    f = fuente(22)
    alto = 60 + 44 * len(lineas) + (300 if qr_texto else 40)
    img = Image.new("RGB", (ancho, alto), "white")
    d = ImageDraw.Draw(img)
    y = 30
    for linea in lineas:
        d.text((28, y), linea, fill="black", font=f)
        y += 44
    if qr_texto:
        qr = zxingcpp.create_barcode(qr_texto, zxingcpp.BarcodeFormat.QRCode)
        qr_img = Image.fromarray(np.array(qr.to_image(scale=3, add_quiet_zones=True))).convert("RGB")
        img.paste(qr_img, ((ancho - qr_img.width) // 2, y + 10))
    return img


def fotografiar(img: Image.Image, semilla: int = 7) -> np.ndarray:
    """Como si lo tomaran con el celular: mesa, perspectiva, giro, sombra y ruido."""
    rnd = random.Random(semilla)
    papel = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    h, w = papel.shape[:2]
    lienzo_w, lienzo_h = int(w * 1.6), int(h * 1.35)
    mesa = np.full((lienzo_h, lienzo_w, 3), (70, 95, 120), dtype=np.uint8)  # madera oscura
    mesa = cv2.add(mesa, np.random.default_rng(semilla).integers(0, 25, mesa.shape, dtype=np.uint8))
    ox, oy = (lienzo_w - w) // 2, (lienzo_h - h) // 2
    origen = np.float32([[0, 0], [w, 0], [w, h], [0, h]])

    def j() -> float:
        return rnd.uniform(-0.035, 0.035)

    destino = np.float32(
        [
            [ox + w * j(), oy + h * j()],
            [ox + w * (1 + j()), oy + h * j() + 25],
            [ox + w * (1 + j()), oy + h * (1 + j())],
            [ox + w * j() - 15, oy + h * (1 + j())],
        ]
    )
    m = cv2.getPerspectiveTransform(origen, destino)
    warp = cv2.warpPerspective(papel, m, (lienzo_w, lienzo_h), borderValue=(0, 0, 0))
    mascara = cv2.warpPerspective(np.full((h, w), 255, np.uint8), m, (lienzo_w, lienzo_h))
    foto = np.where(mascara[..., None] > 0, warp, mesa)
    # Sombra suave de un lado y ruido del sensor
    gradiente = np.tile(np.linspace(0.78, 1.0, lienzo_w, dtype=np.float32), (lienzo_h, 1))[..., None]
    foto = np.clip(foto.astype(np.float32) * gradiente, 0, 255)
    foto = np.clip(foto + np.random.default_rng(semilla + 1).normal(0, 5, foto.shape), 0, 255).astype(np.uint8)
    return cv2.GaussianBlur(foto, (3, 3), 0.6)


def pdf_factura(ruta: Path) -> None:
    from fpdf import FPDF

    pdf = FPDF(format="Letter")
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "ENERGÍA DEL CARIBE S.A. E.S.P.", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", size=11)
    for linea in [
        "NIT 802.007.670-6",
        "FACTURA ELECTRÓNICA DE VENTA No. FEC 1045887",
        "Fecha de expedición: 22/09/2026",
        "Cliente: Valeria Ríos   Cuenta contrato 7788123",
        "Periodo facturado: 20/08/2026 - 19/09/2026",
        "",
        "Consumo energía activa 312 kWh            $ 226.512",
        "Contribución / subsidio                   $       0",
        "Alumbrado público                         $  18.400",
        "",
        "TOTAL A PAGAR                             $ 244.912",
        "Pague antes de: 05/10/2026",
        "",
        f"CUFE: {CUFE_ENERGIA}",
    ]:
        pdf.cell(0, 7, linea, new_x="LMARGIN", new_y="NEXT")
    pdf.output(str(ruta))


def pdf_escaneado(ruta: Path, img: Image.Image) -> None:
    img.convert("RGB").save(ruta, "PDF", resolution=150)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    qr = (
        "NumFac: SETP990004217\nFecFac: 2026-09-26\nHorFac: 08:14:00-05:00\nNitFac: 900123456\n"
        "DocAdq: 222222222222\nValFac: 9495.80\nValIva: 1804.20\nValOtroIm: 0.00\nValTolFac: 11300.00\n"
        f"CUFE: {CUFE}\nQRCode: https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey={CUFE}"
    )
    panaderia = recibo(
        [
            "PANADERIA LA ESPIGA S.A.S.",
            "NIT 900.123.456-7",
            "Cra 15 # 85-20 Bogota",
            "POS electronico SETP990004217",
            "Fecha: 26/09/2026  08:14",
            "2 Pandebono            5.000",
            "1 Tinto grande         3.800",
            "1 Pan frances          2.500",
            "SUBTOTAL               9.496",
            "IVA 19%                1.804",
            "TOTAL                 11.300",
            "Efectivo              20.000",
            "Cambio                 8.700",
        ],
        qr,
    )
    panaderia.save(OUT / "recibo_panaderia.png", optimize=True)
    foto = fotografiar(panaderia)
    cv2.imwrite(str(OUT / "recibo_panaderia_foto.jpg"), foto, [cv2.IMWRITE_JPEG_QUALITY, 72])
    otra = Image.fromarray(cv2.cvtColor(foto, cv2.COLOR_BGR2RGB))
    otra = otra.resize((int(otra.width * 0.8), int(otra.height * 0.8)))
    otra.save(OUT / "recibo_panaderia_otra.webp", quality=60)

    tienda = recibo(
        [
            "TIENDA DON BETO",
            "Calle 45 # 12-30",
            "25/09/2026 19:02",
            "Leche x2               9.800",
            "Huevos x30            18.500",
            "Arepas                 6.300",
            "Queso campesino       11.000",
            "TOTAL                 45.600",
            "Gracias por su compra",
        ],
        None,
    )
    cv2.imwrite(str(OUT / "recibo_tienda.jpg"), fotografiar(tienda, 11), [cv2.IMWRITE_JPEG_QUALITY, 75])

    pdf_factura(OUT / "factura_energia.pdf")
    pdf_escaneado(OUT / "factura_escaneada.pdf", tienda)
    for f in sorted(OUT.iterdir()):
        print(f"{f.name:32} {f.stat().st_size / 1024:6.1f} KB")


if __name__ == "__main__":
    main()
