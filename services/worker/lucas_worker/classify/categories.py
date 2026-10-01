"""Las 8 categorías por defecto de cada cuenta (create_account en la migración 20).

Laya aprende estas etiquetas; si una cuenta tuviera una categoría extra, esa
no la propone la IA (queda para las personas en la revisión).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..extract.numbers import normalize_merchant


@dataclass(frozen=True)
class CanonicalCategory:
    name: str  # como está en public.categories
    label_en: str  # etiqueta para la variante inglesa de Laya
    desc_en: str
    desc_es: str
    fallback_en: str  # descripción en inglés si no hubo LLM
    keywords: re.Pattern[str]


def _kw(palabras: str) -> re.Pattern[str]:
    """«taxi|uber\\b|…» → regex que busca cualquiera al comienzo de una palabra."""
    return re.compile(r"\b(?:" + palabras + r")")


# El orden importa: es el de public.guess_category (lo más específico primero)
CATEGORIES: tuple[CanonicalCategory, ...] = (
    CanonicalCategory(
        "Transporte",
        "transport",
        "taxis, ride-hailing, buses, boats, tolls, fuel, parking, flights, bus terminals",
        "taxis, Uber, buses, lanchas, peajes, gasolina, parqueaderos, vuelos",
        "Transport",
        _kw(
            r"taxi|uber\b|didi\b|cabify|indriver|bus\b|buses|buseta|lancha|peaje|gasolina|combustible|acpm"
            r"|parqueadero|parqueo|transmilenio|metro\b|pasaje|tiquete|vuelo|avianca|latam\b|wingo|terminal de"
            r"|mototaxi|terpel|primax"
        ),
    ),
    CanonicalCategory(
        "Hospedaje",
        "lodging",
        "hotels, hostels, cabins, Airbnb, glamping, rented country houses",
        "hoteles, hostales, cabañas, Airbnb, glamping, fincas de alquiler",
        "Lodging",
        _kw(r"hotel|hostal|hostel|cabana|airbnb|posada|alojamiento|glamping|booking\b|finca\b"),
    ),
    CanonicalCategory(
        "Licor",
        "liquor",
        "liquor stores, beer, aguardiente, rum, wine, bars, nightclubs",
        "estancos, licoreras, cerveza, aguardiente, ron, vino, bares, discotecas",
        "Liquor",
        _kw(
            r"cerveza|aguardiente|guaro\b|ron\b|licor|estanco|vino\b|vinos|whisky|tequila|poker\b|aguila\b"
            r"|club colombia|pola\b|polas|bar\b|discoteca"
        ),
    ),
    CanonicalCategory(
        "Café",
        "coffee and bakery",
        "coffee shops, bakeries, pastries, tinto, pandebono, snacks",
        "cafeterías, panaderías, pastelerías, tinto, pandebono, onces",
        "Coffee and bakery",
        _kw(
            r"cafe\b|cafes\b|cafeteria|tinto|panaderia|pan\b|pandebono|bunuelo|almojabana|pasteleria|reposteria"
            r"|juan valdez|tostao|capuchino"
        ),
    ),
    CanonicalCategory(
        "Restaurante",
        "restaurant",
        "restaurants, lunches, dinners, fast food, food delivery",
        "restaurantes, almuerzos, cenas, comidas rápidas, domicilios de comida",
        "Restaurant meal",
        _kw(
            r"almuerzo|cena\b|desayuno|restaurante|empanada|pizza|asadero|hamburguesa|pescado|arepa|corrientazo|comida"
            r"|rappi|ifood|kfc\b|mcdonald|frisby|crepes|sushi|parrilla|asados?\b|ceviche|mariscos|picada"
        ),
    ),
    CanonicalCategory(
        "Mercado",
        "groceries",
        "groceries, supermarkets, corner stores, produce, butchers, household supplies",
        "mercado, supermercados, tiendas de barrio, fruver, carnicería, aseo del hogar",
        "Groceries",
        _kw(
            r"mercado|tienda|supermercado|fruver|carniceria|verdura|huevos|leche\b|exito\b|carulla|jumbo\b|d1\b"
            r"|ara\b|olimpica|isimo|makro|surtimax|minimercado|autoservicio|hielo"
        ),
    ),
    CanonicalCategory(
        "Servicios",
        "utilities",
        "utility bills: electricity, water, gas, internet, mobile plan, building fees, rent",
        "servicios públicos: luz, agua, gas, internet, celular, administración, arriendo",
        "Utility bill",
        _kw(
            r"luz\b|energia|acueducto|agua\b|gas natural|internet|celular|claro\b|movistar|tigo\b|etb\b|enel\b"
            r"|codensa|epm\b|vanti\b|administracion|arriendo|servicios publicos"
        ),
    ),
    CanonicalCategory(
        "Otros",
        "other",
        "anything else: pharmacy, clothing, entertainment, gifts, tickets",
        "todo lo demás: droguería, ropa, entretenimiento, regalos, entradas",
        "Other expense",
        re.compile(r"(?!)"),  # nunca por palabra clave
    ),
)

BY_NAME: dict[str, CanonicalCategory] = {c.name: c for c in CATEGORIES}
OTHER = "Otros"


def keyword_category(text: str | None) -> str | None:
    """La categoría por palabras clave, o None si ninguna aplica."""
    t = (normalize_merchant(text) or "") + " "
    for c in CATEGORIES:
        if c.keywords.search(t):
            return c.name
    return None


def fallback_description(category: str | None) -> str:
    return BY_NAME[category].fallback_en if category in BY_NAME else BY_NAME[OTHER].fallback_en
