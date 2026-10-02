"""Las categorías de siempre: palabras clave y que coincidan con la base."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from lucas_worker.classify.categories import BY_NAME, CATEGORIES, keyword_category

MIGRACION = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "00000000000110_categorias_nuevas.sql"


@pytest.mark.parametrize(
    ("texto", "categoria"),
    [
        ("Vale de salud de Colsanitas", "Salud"),
        ("Droguería La Rebaja acetaminofén", "Salud"),
        ("cita con el odontólogo", "Salud"),
        ("cremas y bloqueador", "Belleza"),
        ("Peluquería Sandra corte de pelo", "Belleza"),
        ("Netflix y Spotify del mes", "Ocio"),
        ("polas en el bar", "Ocio"),
        ("un porro de weed", "Ocio"),
        ("Cine Colombia boletas", "Ocio"),
        ("Estanco La 70 aguardiente", "Licor"),
        ("concentrado para el perro", "Mascotas"),
        ("perros calientes en la esquina", "Restaurante"),
        ("Veterinaria San Francisco", "Mascotas"),
        ("matrícula del colegio", "Educación"),
        ("Smart Fit mensualidad", "Deporte"),
        ("tenis Adidas", "Ropa"),
        ("Homecenter tornillos y pintura", "Hogar"),
        ("regalo de cumpleaños de Mafe", "Regalos"),
        ("SOAT de la moto", "Transporte"),
        ("taxi al aeropuerto", "Transporte"),
        ("crema de leche y huevos", "Mercado"),
        ("factura de la luz Enel", "Servicios"),
    ],
)
def test_palabras_clave(texto, categoria):
    assert keyword_category(texto) == categoria


def test_misma_lista_que_la_base():
    """Nombres y descripciones iguales a public.default_categories (la web los muestra, Laya los lee)."""
    sql = MIGRACION.read_text(encoding="utf-8")
    filas = re.findall(r"\(\d+, '([^']+)', '(.)', '([a-z]+)', '([^']+)'\)", sql)
    assert {nombre: desc for nombre, _, _, desc in filas} == {c.name: c.desc_es for c in CATEGORIES}
    assert len(BY_NAME) == 17
