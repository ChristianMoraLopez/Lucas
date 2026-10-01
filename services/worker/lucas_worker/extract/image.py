"""Fotos de recibos con OpenCV: cargar, huella perceptual y preprocesamiento.

Las fotos llegan comprimidas (~1600 px, WebP o JPEG) desde la web o desde
WhatsApp. Antes del OCR se enderezan: se busca el papel (el contorno de cuatro
lados más grande) y se corrige la perspectiva; si no aparece, se corrige solo
la inclinación del texto. Luego contraste local (CLAHE) y un poco de limpieza.
"""

from __future__ import annotations

import io
import logging

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from ..errors import PermanentError

log = logging.getLogger(__name__)

Image.MAX_IMAGE_PIXELS = 40_000_000  # una foto de celular cabe de sobra; algo más grande es sospechoso


def load_image(data: bytes) -> np.ndarray:
    """Bytes (JPEG, PNG, WebP) → imagen BGR, ya girada según el EXIF."""
    try:
        with Image.open(io.BytesIO(data)) as im:
            im = ImageOps.exif_transpose(im)
            rgb = np.asarray(im.convert("RGB"))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as e:
        raise PermanentError(f"La imagen no se puede abrir: {e}") from e
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def perceptual_hash(img: np.ndarray) -> str:
    """pHash de 256 bits (64 caracteres hex). Igual para la misma foto recomprimida o reescalada."""
    import imagehash

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    return str(imagehash.phash(Image.fromarray(gray), hash_size=16))


def hash_distance(a: str, b: str) -> int:
    """Bits distintos entre dos huellas (mismo cálculo que public.image_hash_distance)."""
    return (int(a, 16) ^ int(b, 16)).bit_count()


def resize_long_side(img: np.ndarray, max_side: int = 2000, min_side: int = 900) -> np.ndarray:
    h, w = img.shape[:2]
    largo, corto = max(h, w), min(h, w)
    escala = 1.0
    if largo > max_side:
        escala = max_side / largo
    elif corto < min_side:
        # Fotos pequeñas: el OCR lee mejor con letras más grandes
        escala = min(min_side / corto, max_side / largo, 2.5)
    if abs(escala - 1.0) < 0.02:
        return img
    interp = cv2.INTER_AREA if escala < 1 else cv2.INTER_CUBIC
    return cv2.resize(img, (round(w * escala), round(h * escala)), interpolation=interp)


def _ordenar_esquinas(pts: np.ndarray) -> np.ndarray:
    pts = pts.reshape(4, 2).astype("float32")
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype="float32")


def find_document(img: np.ndarray) -> np.ndarray | None:
    """Las cuatro esquinas del papel si ocupa buena parte de la foto."""
    h, w = img.shape[:2]
    escala = 800 / max(h, w)
    small = cv2.resize(img, (round(w * escala), round(h * escala))) if escala < 1 else img.copy()
    escala = min(escala, 1.0)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)
    contornos, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area_total = small.shape[0] * small.shape[1]
    for c in sorted(contornos, key=cv2.contourArea, reverse=True)[:5]:
        area = cv2.contourArea(c)
        if area < 0.2 * area_total:
            break
        approx = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            if area > 0.97 * area_total:
                return None  # es el borde de la foto: el papel ya la llena
            return _ordenar_esquinas(approx) / escala
    return None


def warp_document(img: np.ndarray, quad: np.ndarray) -> np.ndarray:
    tl, tr, br, bl = quad
    ancho = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    alto = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    if ancho < 100 or alto < 100:
        return img
    destino = np.array([[0, 0], [ancho - 1, 0], [ancho - 1, alto - 1], [0, alto - 1]], dtype="float32")
    m = cv2.getPerspectiveTransform(quad.astype("float32"), destino)
    return cv2.warpPerspective(img, m, (ancho, alto), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def skew_angle(gray: np.ndarray) -> float:
    """Inclinación del texto en grados (positivo = girar a la izquierda para enderezar)."""
    binaria = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    # Une las letras de cada renglón en bandas horizontales
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(15, gray.shape[1] // 40), 3))
    bandas = cv2.morphologyEx(binaria, cv2.MORPH_CLOSE, kernel)
    contornos, _ = cv2.findContours(bandas, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    angulos, pesos = [], []
    for c in contornos:
        (_, _), (w, h), ang = cv2.minAreaRect(c)
        if w < h:
            w, h = h, w
            ang -= 90
        if w < gray.shape[1] * 0.15 or h == 0 or w / h < 4:
            continue
        ang = (ang + 90) % 180 - 90
        if abs(ang) <= 20:
            angulos.append(ang)
            pesos.append(w)
    if not angulos:
        return 0.0
    return float(np.average(angulos, weights=pesos))


def rotate(img: np.ndarray, angle: float) -> np.ndarray:
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    m[0, 2] += nw / 2 - w / 2
    m[1, 2] += nh / 2 - h / 2
    return cv2.warpAffine(img, m, (nw, nh), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def straighten(img: np.ndarray) -> tuple[np.ndarray, list[str]]:
    """Papel recortado y derecho. Devuelve también qué se hizo (para el registro)."""
    pasos: list[str] = []
    if (quad := find_document(img)) is not None:
        img = warp_document(img, quad)
        pasos.append("perspectiva")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    ang = skew_angle(gray)
    if 0.4 <= abs(ang) <= 20:
        img = rotate(img, ang)
        pasos.append(f"giro {ang:+.1f}°")
    return img, pasos


def enhance(img: np.ndarray) -> np.ndarray:
    """Gris con contraste local y sin ruido fino. Vuelve a 3 canales para el OCR."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 5, 40, 40)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def qr_variants(img: np.ndarray) -> list[np.ndarray]:
    """Versiones de la foto para buscar el QR, de la más barata a la más agresiva."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
    otsu = cv2.threshold(cv2.GaussianBlur(gray, (3, 3), 0), 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    adapt = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10)
    grande = cv2.resize(gray, None, fx=1.6, fy=1.6, interpolation=cv2.INTER_CUBIC)
    return [gray, clahe, otsu, adapt, grande]
