"""Las 17 categorías de siempre de cada cuenta (public.default_categories, migración 110).

Mismos nombres y descripciones que la base y que components/lucas-core.ts de la
web. Cada cuenta puede crear las suyas (migración 90) con una descripción de qué
entra en ellas: Laya las recibe como opciones descritas (question.for_account)
y de la descripción salen sus palabras clave (custom_keyword_category).
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


# El orden importa para las palabras clave: lo más específico primero (Salud
# antes que Mercado, Mascotas antes que Restaurante, Ocio antes que Licor…)
CATEGORIES: tuple[CanonicalCategory, ...] = (
    CanonicalCategory(
        "Transporte",
        "transport",
        "taxis, ride-hailing, buses, TransMilenio, metro, boats, tolls, fuel, parking, flights, car insurance (SOAT),"
        " car repairs",
        "taxis, Uber, DiDi, InDrive, buses, TransMilenio, SITP, metro, lanchas, peajes, gasolina, parqueaderos, vuelos,"
        " SOAT, taller del carro",
        "Transport",
        _kw(
            r"taxi|uber\b|didi\b|cabify|indrive|picap|bus\b|buses|buseta|lancha|peaje|gasolina|combustible|acpm"
            r"|parqueadero|parqueo|transmilenio|sitp\b|metro\b|pasaje|tiquete|vuelo|avianca|latam\b|wingo|terminal de"
            r"|mototaxi|terpel|primax|soat\b|taller\b|mecanico|llanta|lavadero|lavado del carro"
        ),
    ),
    CanonicalCategory(
        "Salud",
        "health",
        "pharmacy, medicines, health insurance (EPS, prepaid medicine: Colsanitas, Sura, Compensar), health vouchers,"
        " doctor visits, dentist, lab tests, optician",
        "droguería, medicamentos, EPS, medicina prepagada (Colsanitas, Sura, Compensar), vales de salud, citas médicas,"
        " odontólogo, exámenes, óptica",
        "Health expense",
        _kw(
            r"drogueria|farmacia|medicament|medicina|medico|eps\b|colsanitas|sanitas|sura\b|compensar|prepagada"
            r"|cita medica|citas medicas|consulta medica|odontolog|dentista|ortodonc|laboratorio clinico|examen"
            r"|optica|gafas formuladas|vales? de salud|bonos? de salud|cruz verde|farmatodo|la rebaja|copago"
            r"|acetaminofen|ibuprofeno|pastillas|vacuna|clinica|hospital|urgencias|terapia|psicolog"
        ),
    ),
    CanonicalCategory(
        "Belleza",
        "beauty",
        "personal care: creams, makeup, perfume, hair salon, barbershop, manicure, waxing, spa",
        "cuidado personal: cremas, maquillaje, perfumes, peluquería, barbería, manicure, depilación, spa",
        "Beauty and personal care",
        _kw(
            r"crema(?!s? de leche)|maquillaje|perfume|peluqueria|barberia|barbero|corte de pelo|corte de cabello"
            r"|manicure|pedicure|depilacion|spa\b|shampoo|champu|acondicionador|bloqueador|protector solar|labial"
            r"|esmalte|tinte\b|keratina|cosmetic|sephora|bella piel|cuidado personal"
        ),
    ),
    CanonicalCategory(
        "Mascotas",
        "pets",
        "vet, pet food, cat litter, pet grooming, pet toys",
        "veterinaria, concentrado, comida y arena para perro o gato, peluquería canina, juguetes",
        "Pet expense",
        _kw(
            r"veterinari|mascota|perros?\b(?! calientes?)|gatos?\b|concentrado|purina|dog chow|chunky\b|agrocampo"
            r"|petco|laika\b|arena para gato|peluqueria canina"
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
        "Ocio",
        "leisure",
        "nightlife and entertainment: bars, nightclubs, concerts, cinema, Netflix, Spotify, video games, weed,"
        " cigarettes, vapes",
        "rumba y entretenimiento: bares, discotecas, conciertos, cine, Netflix, Spotify, videojuegos, weed,"
        " cigarrillos, vape, tejo",
        "Entertainment",
        _kw(
            r"netflix|spotify|disney|hbo\b|prime video|youtube premium|crunchyroll|cine\b|cinema|cinecolombia|procinal"
            r"|cinemark|concierto|boleta|tuboleta|bar\b|bares\b|discoteca|rumba|videojuego|playstation|xbox|nintendo"
            r"|steam\b|weed|marihuana|porro|bareta|cripa\b|cigarrillo|cigarro|tabaco|vape\b|vaper|vapeador|hookah"
            r"|karaoke|bolos\b|billar|tejo\b|parque de diversiones|salitre magico|mundo aventura"
        ),
    ),
    CanonicalCategory(
        "Licor",
        "liquor",
        "take-away alcohol: liquor stores, beer, aguardiente, rum, wine, whisky",
        "trago para llevar: estancos, licoreras, cerveza, aguardiente, ron, vino, whisky",
        "Liquor",
        _kw(
            r"cerveza|aguardiente|guaro\b|ron\b|licor|estanco|vino\b|vinos|whisky|tequila|poker\b|aguila\b"
            r"|club colombia|pola\b|polas|trago"
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
            r"|perros? calientes?|salchipapa"
        ),
    ),
    CanonicalCategory(
        "Educación",
        "education",
        "school, university, tuition, courses, books, school supplies, language classes",
        "colegio, universidad, matrícula, pensión, cursos, libros, útiles, idiomas",
        "Education",
        _kw(
            r"colegio|universidad|matricula|pension\b|semestre|curso\b|cursos|libro|libreria|utiles|papeleria"
            r"|panamericana|icetex|idioma|clases de ingles|diplomado|platzi|coursera|udemy"
        ),
    ),
    CanonicalCategory(
        "Deporte",
        "sports",
        "gym, sports fields, classes, sports gear, bicycle",
        "gimnasio, canchas, clases, implementos deportivos, bicicleta",
        "Sports",
        _kw(
            r"gimnasio|gym\b|smart ?fit|bodytech|cancha|futbol|padel|tenis de mesa|yoga|crossfit|pilates|spinning"
            r"|decathlon|bicicleta|cicla\b|natacion|entrenador|proteina"
        ),
    ),
    CanonicalCategory(
        "Ropa",
        "clothing",
        "clothes, shoes, sneakers, accessories, bags",
        "ropa, zapatos, tenis, accesorios, bolsos",
        "Clothing",
        _kw(
            r"ropa|zapato|zapatilla|tenis\b|camisa|camiseta|pantalon|jeans?\b|vestido|chaqueta|buzo\b|medias\b|bolso"
            r"|accesorio|zara\b|h&m|koaj|arturo calle|studio f|bershka|pull and bear|adidas|nike\b|totto|velez\b"
        ),
    ),
    CanonicalCategory(
        "Hogar",
        "home goods",
        "home goods: furniture, appliances, hardware store, decor, repairs, electronics",
        "cosas para la casa: muebles, electrodomésticos, ferretería, decoración, arreglos, tecnología",
        "Home goods",
        _kw(
            r"mueble|colchon|sofa\b|electrodomestic|nevera|lavadora|televisor|microondas|licuadora|homecenter|easy\b"
            r"|ferreteria|tornillo|pintura|plomero|cerrajer|electricista|decoracion|cortina|sabanas|toallas|ollas"
            r"|ikea|tugo\b|jamar|alkosto|ktronix|computador|portatil|audifonos|cargador|bombillo|reparacion"
        ),
    ),
    CanonicalCategory(
        "Regalos",
        "gifts",
        "gifts, birthdays, secret Santa, flowers, gift baskets",
        "regalos, detalles, cumpleaños, amigo secreto, flores, anchetas",
        "Gift",
        _kw(r"regalo|obsequio|cumpleanos|amigo secreto|floristeria|flores\b|ancheta"),
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
        "utility and fixed bills: electricity, water, gas, internet, mobile plan, building fees, rent",
        "servicios públicos y fijos: luz, agua, gas, internet, plan de celular, administración, arriendo",
        "Utility bill",
        _kw(
            r"luz\b|energia|acueducto|agua\b|gas natural|internet|celular|claro\b|movistar|tigo\b|etb\b|enel\b"
            r"|codensa|epm\b|vanti\b|administracion|arriendo|servicios publicos"
        ),
    ),
    CanonicalCategory(
        "Otros",
        "other",
        "anything that fits no other category",
        "todo lo demás que no cabe en otra categoría",
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


_SEPARADORES = re.compile(r"[,;/·:\n()]|\by\b|\bo\b")


def _singular_o_plural(termino: str) -> str:
    """«citas medicas» → «cita» o «citas», «medica» o «medicas»; «examenes» → «examen(es)»."""
    partes = []
    for palabra in termino.split():
        if len(palabra) > 4 and palabra.endswith("es"):
            partes.append(re.escape(palabra[:-2]) + "(?:es)?")
        elif len(palabra) > 3 and palabra.endswith("s"):
            partes.append(re.escape(palabra[:-1]) + "s?")
        else:
            partes.append(re.escape(palabra) + "(?:s|es)?")
    return " ".join(partes)


def custom_keywords(name: str, description: str | None) -> re.Pattern[str] | None:
    """«Salud» + «droguería, citas médicas, EPS» → regex con «salud», «drogueria»,
    «citas medicas» y «eps» (sin tildes, al comienzo de una palabra)."""
    terminos = {normalize_merchant(name)}
    for parte in _SEPARADORES.split(description or ""):
        t = normalize_merchant(parte)
        if t and len(t) >= 3 and len(t) <= 40 and t not in ("todo lo demas", "otros", "lo demas"):
            terminos.add(t)
    terminos.discard(None)
    if not terminos:
        return None
    return re.compile(
        r"\b(?:" + "|".join(_singular_o_plural(t) for t in sorted(terminos, key=len, reverse=True)) + r")"
    )


def custom_keyword_category(text: str | None, categories: list[tuple[str, str | None]]) -> str | None:
    """La categoría propia de la cuenta cuyas palabras aparecen en el texto, o None."""
    if not text or not categories:
        return None
    t = (normalize_merchant(text) or "") + " "
    for nombre, descripcion in categories:
        if (patron := custom_keywords(nombre, descripcion)) and patron.search(t):
            return nombre
    return None


def fallback_description(category: str | None) -> str:
    return BY_NAME[category].fallback_en if category in BY_NAME else BY_NAME[OTHER].fallback_en
