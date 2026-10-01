"""Pagador y división según el mensaje; memoria de comercios; cascada de categorías."""

from lucas_worker.classify.classifier import Category, CategoryClassifier
from lucas_worker.classify.laya import CategoryPrediction
from lucas_worker.classify.memory import MemoryEntry, match_memory
from lucas_worker.classify.question import ClassifyInput
from lucas_worker.payer import Person, match_person, resolve_payer, resolve_split

GENTE = [
    Person("v", "Valeria"),
    Person("jc", "Juan Camilo"),
    Person("s", "Santi"),
    Person("c", "Caro"),
    Person("l", "Laura"),
]


def test_quien_pago_segun_el_mensaje():
    assert resolve_payer("La lancha la pagó Santi: 210.500", GENTE, "v").person_id == "s"
    assert resolve_payer("Vale pagó el almuerzo, 80 lucas", GENTE, "s").person_id == "v"
    assert resolve_payer("pagado por Laura", GENTE, "s").person_id == "l"
    assert resolve_payer("invitó Juanca a las polas", GENTE, "s").person_id == "jc"
    assert resolve_payer("la pagó Santy", GENTE, "v").person_id == "s"  # con error de dedo


def test_pague_o_nada_es_quien_lo_mando():
    r = resolve_payer("pagué el taxi, 38 lucas", GENTE, "c")
    assert (r.person_id, r.source, r.confidence) == ("c", "remitente", 0.97)
    assert resolve_payer(None, GENTE, "c").person_id == "c"
    nadie = resolve_payer("pagó el almuerzo", GENTE, None)
    assert nadie.person_id is None and nadie.confidence < 0.75


def test_el_llm_como_segunda_opinion():
    r = resolve_payer("foto", GENTE, None, llm_payer_name="Laura Gómez")
    assert (r.person_id, r.source) == ("l", "llm")


def test_no_confunde_palabras_con_nombres():
    assert match_person("todos", GENTE) is None
    assert match_person("el", GENTE) is None
    assert resolve_payer("pagó la cuenta del hotel", GENTE, "v").person_id == "v"


def test_division_entre_los_que_nombra():
    r = resolve_split("hielo 12 lucas entre Vale, Santi y Caro", GENTE)
    assert r.person_ids == ["v", "s", "c"]
    assert r.note == "Leído del mensaje: «entre vale santi y caro»"
    assert resolve_split("entre Juan Camilo y Laura", GENTE).person_ids == ["jc", "l"]
    assert resolve_split("almuerzo entre los 4", GENTE).person_ids == []
    assert "entre los 4" in resolve_split("almuerzo entre los 4", GENTE).note
    # Un nombre que no está: solo la nota, y se divide entre todos
    r = resolve_split("entre Vale y Pedro", GENTE)
    assert r.person_ids == [] and "vale y pedro" in r.note


MEMORIA = [
    MemoryEntry("m1", "PANADERIA LA ESPIGA", "panaderia la espiga", "cafe", 9),
    MemoryEntry("m2", "TIENDA DON BETO", "tienda don beto", "mercado", 7),
    MemoryEntry("m3", "ESTANCO EL PAISA", "estanco el paisa", "licor", 3),
]


def test_memoria_exacta_y_con_errores_de_ocr():
    exacto = match_memory("Panadería La Espiga S.A.S.", MEMORIA)
    assert exacto.exact and exacto.entry.id == "m1" and exacto.confidence == 0.96
    ocr = match_memory("PANADERIA LA ESP1GA", MEMORIA)
    assert ocr and not ocr.exact and ocr.entry.id == "m1" and 0.84 <= ocr.confidence < 0.96
    orden = match_memory("Beto Don Tienda", MEMORIA)
    assert orden and orden.entry.id == "m2"


def test_memoria_no_confunde_comercios_parecidos():
    assert match_memory("Tienda", MEMORIA) is None
    assert match_memory("Tienda Doña Rosa", MEMORIA) is None
    assert match_memory(None, MEMORIA) is None


CATS = [Category(n.lower(), n) for n in ["Café", "Licor", "Mercado", "Transporte", "Restaurante", "Otros"]]


class LayaFijo:
    name = "laya-prueba"

    def __init__(self, categoria: str | None):
        self.categoria = categoria
        self.visto: list[str] | None = None

    def predict(self, inp, allowed):
        self.visto = allowed
        if self.categoria is None:
            raise RuntimeError("se cayó")
        return CategoryPrediction(self.categoria, 0.77, {self.categoria: 0.77}, self.name)


def test_cascada_memoria_primero():
    d = CategoryClassifier(LayaFijo("Licor")).classify(ClassifyInput(merchant="Tienda Don Beto"), CATS, MEMORIA)
    assert (d.source, d.category_name, d.memory_id) == ("memory", "Mercado", "m2")


def test_cascada_laya_si_no_hay_memoria():
    laya = LayaFijo("Licor")
    d = CategoryClassifier(laya).classify(ClassifyInput(merchant="Bar Nuevo"), CATS, MEMORIA)
    assert (d.source, d.category_name, d.confidence) == ("laya", "Licor", 0.77)
    assert "Servicios" not in laya.visto  # solo las categorías que tiene la cuenta


def test_cascada_palabras_clave_y_otros():
    sin_laya = CategoryClassifier(None)
    d = sin_laya.classify(ClassifyInput(merchant="Taxis al aeropuerto"), CATS, [])
    assert (d.source, d.category_name) == ("keywords", "Transporte")
    d = CategoryClassifier(LayaFijo(None)).classify(ClassifyInput(merchant="Cosa rara"), CATS, [])
    assert (d.source, d.category_name) == ("default", "Otros") and d.confidence < 0.75
