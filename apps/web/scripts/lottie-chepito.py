"""Chepito, el cobrador de Mister Luks: un señor de frac, sombrerito (bombín) y bigote.

  python3 scripts/lottie-chepito.py   # escribe public/lottie/chepito*.lottie

Es una marca aparte de Mister Luks (que es el ícono de Luks y su globo de chat):
Chepito trabaja para él. Tiene su paleta: frac negro, coral (el color de las
cuentas de cobro), dorado y la piel; nada del morado ni del verde de Luks.

· chepito: quieto (respira, parpadea, mueve el bigote y se acomoda el sombrero). En bucle.
· chepito-saluda: aparece, levanta el sombrero y saluda con la mano.
· chepito-cobra: muestra la cuenta con cara seria y golpea el piso con el pie. En bucle.
· chepito-espera: mira el reloj de bolsillo y espera (el horario de cobranza). En bucle.
· chepito-envia: escribe en el celular y sale el mensaje.
· chepito-pagado: le pagaron: salta, el sombrero vuela, caen monedas y sale el chulo.
· chepito-no-me-escribas: se pone triste, se baja el sombrero y se va.
"""

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location("lottie_propios", Path(__file__).with_name("lottie-propios.py"))
lp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lp)

fijo, anim, tr, rect, circulo, trazo, capa, lottie, poligono, chulo, guardar, color = (
    lp.fijo,
    lp.anim,
    lp.tr,
    lp.rect,
    lp.circulo,
    lp.trazo,
    lp.capa,
    lp.lottie,
    lp.poligono,
    lp.chulo,
    lp.guardar,
    lp.color,
)
CURVAS = lp.CURVAS
TINTA, BLANCO, CORAL, CORAL_OSCURO, CORAL_CLARO, LINEA = lp.TINTA, lp.BLANCO, lp.CORAL, lp.CORAL_OSCURO, lp.CORAL_CLARO, lp.LINEA

# La paleta de Chepito
PIEL = color("#F3C6A0")
PIEL_OSCURA = color("#E39B7B")
SOLAPA = color("#352B5C")
PANTALON = color("#2A2142")
CUERO = color("#8A5A3B")
BRILLO = color("#4B4074")
DORADO = color("#F0B429")
DORADO_OSCURO = color("#C98A12")

W = H = 240
PIES = [120, 226]


# ---------------------------------------------------------------------------
# Figuras que faltan en lottie-propios.py
# ---------------------------------------------------------------------------


def elipse(x, y, w, h, relleno, borde=None, opacidad=100):
    it = [{"ty": "el", "d": 1, "s": fijo([w, h]), "p": fijo([x, y])}]
    if borde:
        it.append({"ty": "st", "c": fijo(borde[0]), "o": fijo(100), "w": fijo(borde[1]), "lc": 2, "lj": 2})
    it.append({"ty": "fl", "c": fijo(relleno), "o": fijo(opacidad), "r": 1})
    it.append(tr())
    return {"ty": "gr", "it": it}


def camino(v, i=None, o=None, cerrado=False):
    n = len(v)
    return {"i": i or [[0, 0]] * n, "o": o or [[0, 0]] * n, "v": v, "c": cerrado}


def curva(forma, color_, ancho):
    """Un trazo curvo (con tangentes), de puntas redondas; forma fija o animada"""
    ks = forma if "a" in forma else fijo(forma)
    return {
        "ty": "gr",
        "it": [
            {"ty": "sh", "ks": ks},
            {"ty": "st", "c": fijo(color_), "o": fijo(100), "w": fijo(ancho), "lc": 2, "lj": 2},
            tr(),
        ],
    }


def forma_anim(cuadros):
    """La boca que cambia (sonrisa, sonrisa grande, tristeza): mismos puntos, otra forma"""
    kf = []
    for n, c in enumerate(cuadros):
        k = {"t": c[0], "s": [c[1]]}
        if n < len(cuadros) - 1:
            x1, y1, x2, y2 = CURVAS[c[2] if len(c) > 2 else "suave"]
            k["o"] = {"x": [x1], "y": [y1]}
            k["i"] = {"x": [x2], "y": [y2]}
        kf.append(k)
    return {"a": 1, "k": kf}


def nulo(ind, nombre, ancla, op, *, p=None, r=None, s=None, padre=None):
    """Una capa vacía de la que cuelgan otras (el cuerpo entero, la cabeza)"""
    c = {
        "ddd": 0,
        "ind": ind,
        "ty": 3,
        "nm": nombre,
        "sr": 1,
        "ks": {
            "o": fijo(100),
            "r": r or fijo(0),
            "p": p or fijo(ancla + [0]),
            "a": fijo(ancla + [0]),
            "s": s or fijo([100, 100, 100]),
        },
        "ao": 0,
        "ip": 0,
        "op": op,
        "st": 0,
        "bm": 0,
    }
    if padre:
        c["parent"] = padre
    return c


# Las bocas (mismos tres puntos: se pasa de una a otra)
BOCA = camino([[113, 109], [120, 112.5], [127, 109]], i=[[0, 0], [-3.5, 0], [0, 0]], o=[[0, 0], [3.5, 0], [0, 0]])
BOCA_FELIZ = camino([[109, 107], [120, 117], [131, 107]], i=[[0, 0], [-6, 0], [0, 0]], o=[[0, 0], [6, 0], [0, 0]])
BOCA_TRISTE = camino([[113, 113], [120, 109.5], [127, 113]], i=[[0, 0], [-3.5, 0], [0, 0]], o=[[0, 0], [3.5, 0], [0, 0]])


# ---------------------------------------------------------------------------
# Chepito, por capas. «mov» trae lo que se mueve en cada animación
# ---------------------------------------------------------------------------

RAIZ, CABEZA = 50, 51
# El antebrazo izquierdo (de él cuelga lo que tiene en la mano)
MANO_I = 66


def chepito(op, mov=None, *, delante=(), detras=(), brazo_i_delante=False, en_mano_i=()):
    """Las capas de Chepito. mov[capa] = {"p"|"r"|"s"|"o": propiedad animada}; delante y
    detrás, capas extra; en_mano_i, lo que tiene en la mano izquierda. Lo de la cabeza
    cuelga de CABEZA; todo, de RAIZ."""
    mov = mov or {}

    def m(nombre, prop, defecto=None):
        return mov.get(nombre, {}).get(prop, defecto)

    raiz = nulo(RAIZ, "chepito", PIES, op, p=m("raiz", "p"), r=m("raiz", "r"), s=m("raiz", "s"))
    cabeza = nulo(CABEZA, "cabeza", [120, 120], op, p=m("cabeza", "p"), r=m("cabeza", "r"), s=m("cabeza", "s"), padre=RAIZ)

    def parte(ind, nombre, formas, ancla, padre, **defectos):
        return capa(
            ind,
            nombre,
            formas,
            ancla,
            op,
            p=m(nombre, "p", defectos.get("p")),
            r=m(nombre, "r", defectos.get("r")),
            s=m(nombre, "s", defectos.get("s")),
            o=m(nombre, "o"),
            padre=padre,
        )

    sombrero = parte(
        64,
        "sombrero",
        [
            rect(107, 30, 10, 3, 1.5, BRILLO),
            rect(120, 46, 56, 7, 2, CORAL),
            rect(120, 52, 86, 9, 4.5, TINTA),
            rect(120, 37, 56, 34, 16, TINTA),
        ],
        [120, 52],
        CABEZA,
    )
    ceja_i = parte(60, "ceja_i", [trazo([[100, 69], [112, 66]], TINTA, 4)], [106, 67.5], CABEZA)
    ceja_d = parte(61, "ceja_d", [trazo([[128, 66], [140, 69]], TINTA, 4)], [134, 67.5], CABEZA)
    ojos = parte(
        59,
        "ojos",
        [
            circulo(107.6, 77.4, 2.6, BLANCO),
            circulo(135.6, 77.4, 2.6, BLANCO),
            elipse(106, 80, 8, 11, TINTA),
            elipse(134, 80, 8, 11, TINTA),
        ],
        [120, 80],
        CABEZA,
    )
    bigote = parte(
        62,
        "bigote",
        [
            circulo(87.5, 90.5, 6, TINTA),
            circulo(152.5, 90.5, 6, TINTA),
            curva(
                camino([[102, 102], [90, 99], [87.5, 91]], i=[[0, 0], [4, 1.5], [0.5, 4]], o=[[-5, 0], [-3, -1], [0, 0]]),
                TINTA,
                6,
            ),
            curva(
                camino([[138, 102], [150, 99], [152.5, 91]], i=[[0, 0], [-4, 1.5], [-0.5, 4]], o=[[5, 0], [3, -1], [0, 0]]),
                TINTA,
                6,
            ),
            elipse(110, 101, 24, 11, TINTA),
            elipse(130, 101, 24, 11, TINTA),
        ],
        [120, 100],
        CABEZA,
    )
    boca = capa(63, "boca", [curva(m("boca", "forma", BOCA), TINTA, 3)], [120, 110], op, padre=CABEZA)
    cara = parte(
        58,
        "cara",
        [
            elipse(97, 95, 11, 8, CORAL_CLARO, opacidad=45),
            elipse(143, 95, 11, 8, CORAL_CLARO, opacidad=45),
            elipse(120, 93, 14, 12, PIEL_OSCURA),
            elipse(120, 84, 70, 72, PIEL, (TINTA, 3)),
            elipse(85, 88, 14, 17, PIEL, (TINTA, 3)),
            elipse(155, 88, 14, 17, PIEL, (TINTA, 3)),
        ],
        [120, 84],
        CABEZA,
    )
    corbatin = parte(
        53,
        "corbatin",
        [
            circulo(120, 123.5, 8, CORAL_OSCURO),
            poligono([[105, 116], [105, 131], [119, 123.5]], CORAL),
            poligono([[135, 116], [135, 131], [121, 123.5]], CORAL),
        ],
        [120, 123.5],
        RAIZ,
    )
    cuerpo = parte(
        52,
        "cuerpo",
        [
            circulo(120, 170, 5, BLANCO),
            circulo(120, 184, 5, BLANCO),
            poligono([[96, 142], [108, 142], [102, 135]], CORAL),
            poligono([[104, 122], [136, 122], [120, 158]], BLANCO),
            poligono([[100, 122], [110, 122], [120, 158], [108, 152]], SOLAPA),
            poligono([[140, 122], [130, 122], [120, 158], [132, 152]], SOLAPA),
            rect(120, 163, 74, 84, 24, TINTA),
        ],
        [120, 163],
        RAIZ,
    )
    # El brazo izquierdo en dos partes: del hombro al codo y el antebrazo con la mano
    brazo_i = parte(54, "brazo_i", [rect(89, 143, 17, 30, 8.5, TINTA)], [92, 130], RAIZ, r=fijo(8))
    antebrazo_i = parte(
        MANO_I,
        "antebrazo_i",
        [
            circulo(86, 186, 17, PIEL),
            rect(86, 177, 17, 5, 2, BLANCO),
            rect(87, 167, 17, 30, 8.5, TINTA),
        ],
        [88, 154],
        54,
    )
    # El derecho, con el maletín
    brazo_d = parte(
        55,
        "brazo_d",
        [
            circulo(154, 186, 17, PIEL),
            rect(154, 177, 17, 5, 2, BLANCO),
            rect(153, 155, 17, 48, 8.5, TINTA),
            rect(156, 197, 8, 5, 1.5, DORADO),
            trazo([[148, 191], [148, 185], [164, 185], [164, 191]], TINTA, 3),
            rect(156, 205, 38, 26, 5, CUERO, (TINTA, 2.5)),
        ],
        [148, 130],
        RAIZ,
        r=fijo(-8),
    )
    pierna_i = parte(56, "pierna_i", [elipse(106, 223, 26, 10, TINTA), rect(110, 207, 14, 30, 6, PANTALON)], [110, 194], RAIZ)
    pierna_d = parte(57, "pierna_d", [elipse(134, 223, 26, 10, TINTA), rect(130, 207, 14, 30, 6, PANTALON)], [130, 194], RAIZ)
    sombra = capa(
        65,
        "sombra",
        [elipse(120, 227, 92, 10, TINTA, opacidad=14)],
        [120, 227],
        op,
        p=m("sombra", "p"),
        s=m("sombra", "s"),
        o=m("sombra", "o"),
    )

    # Arriba primero
    capas = list(delante) + [sombrero, ceja_i, ceja_d, ojos, bigote, boca, cara, corbatin, brazo_d]
    capas += list(en_mano_i) + ([antebrazo_i, brazo_i, cuerpo] if brazo_i_delante else [cuerpo, antebrazo_i, brazo_i])
    capas += [pierna_i, pierna_d] + list(detras) + [sombra, raiz, cabeza]
    return capas


def parpadeo(t, op=None):
    """Los ojos se cierran y se abren en t"""
    k = [(0, [100, 100, 100]), (t, [100, 100, 100], "suave"), (t + 3, [100, 8, 100], "suave"), (t + 6, [100, 100, 100])]
    if op:
        k.append((op, [100, 100, 100]))
    return anim(k)


def ida_y_vuelta(base, valores, desde, paso, curva_="suave"):
    """base → cada valor → base, cada «paso» cuadros desde «desde»"""
    k = [(0, base), (desde, base, curva_)]
    t = desde
    for v in valores:
        t += paso
        k.append((t, v, curva_))
    k.append((t + paso, base))
    return anim(k)


# ---------------------------------------------------------------------------
# Objetos
# ---------------------------------------------------------------------------


def moneda(d):
    return [
        rect(0, 0, d * 0.12, d * 0.46, d * 0.06, DORADO_OSCURO),
        elipse(0, 0, d * 0.62, d * 0.62, DORADO, (DORADO_OSCURO, 2)),
        elipse(0, 0, d, d, DORADO, (DORADO_OSCURO, 2.5)),
    ]


def recibo_cobro():
    """La cuenta: el recibo con el total en coral"""
    return [
        rect(0, 18, 34, 7, 3.5, CORAL),
        rect(-4, 4, 36, 5, 2.5, LINEA),
        rect(-2, -6, 40, 5, 2.5, LINEA),
        rect(-6, -16, 32, 5, 2.5, LINEA),
        rect(0, 0, 56, 70, 8, BLANCO, (TINTA, 3)),
    ]


def reloj():
    return [
        rect(0, -16, 6, 6, 2, DORADO_OSCURO),
        circulo(0, 0, 4, TINTA),
        elipse(0, 0, 24, 24, BLANCO, (DORADO_OSCURO, 2)),
        elipse(0, 0, 32, 32, DORADO, (DORADO_OSCURO, 2.5)),
    ]


def celular():
    """El celular con carcasa coral (blanco se perdería contra la camisa)"""
    return [
        circulo(0, 22, 5, CORAL_CLARO),
        rect(0, -6, 18, 3, 1.5, LINEA),
        rect(0, 2, 18, 3, 1.5, LINEA),
        rect(0, -2, 26, 38, 4, BLANCO),
        rect(0, 0, 34, 56, 8, CORAL, (TINTA, 2.5)),
    ]


def globo():
    return [
        poligono([[-22, 16], [-8, 16], [-26, 30]], BLANCO),
        rect(0, 0, 70, 40, 14, BLANCO, (CORAL, 3)),
    ]


# ---------------------------------------------------------------------------
# Las animaciones
# ---------------------------------------------------------------------------


def quieto_en_bucle():
    """Respira, parpadea, mueve el bigote y se acomoda el sombrero (en bucle)"""
    op = 90
    mov = {
        "raiz": {"s": anim([(0, [100, 100, 100]), (45, [101, 98.5, 100]), (90, [100, 100, 100])])},
        "ojos": {"s": parpadeo(52, op)},
        "bigote": {"r": ida_y_vuelta(0, [7, -7, 5], 14, 5)},
        "sombrero": {
            "p": anim([(0, [120, 52, 0]), (64, [120, 52, 0], "sale"), (70, [120, 45, 0], "rebote"), (78, [120, 52, 0]), (90, [120, 52, 0])], espacial=True),
            "r": anim([(0, 0), (64, 0, "sale"), (70, -9, "rebote"), (78, 0), (90, 0)]),
        },
    }
    return lottie("chepito", W, H, op, chepito(op, mov))


def saluda():
    """Aparece con rebote, levanta el sombrero y saluda con la mano (desde el codo)"""
    op = 75
    mov = {
        "raiz": {"s": anim([(0, [0, 0, 100], "rebote"), (12, [100, 100, 100])])},
        "sombra": {"s": anim([(0, [0, 0, 100], "rebote"), (12, [100, 100, 100])])},
        "brazo_i": {"r": anim([(0, 8), (12, 8, "sale"), (20, 150, "suave"), (46, 150, "suave"), (54, 8)])},
        "antebrazo_i": {"r": anim([(0, 0), (20, -10, "suave"), (26, -45, "suave"), (32, -10, "suave"), (38, -45, "suave"), (44, -10, "suave"), (54, 0)])},
        "sombrero": {
            "p": anim([(0, [120, 52, 0]), (16, [120, 52, 0], "sale"), (24, [120, 34, 0], "suave"), (44, [120, 34, 0], "rebote"), (52, [120, 52, 0])], espacial=True),
            "r": anim([(0, 0), (16, 0, "sale"), (24, -14, "suave"), (44, -14, "rebote"), (52, 0)]),
        },
        "boca": {"forma": forma_anim([(0, BOCA), (16, BOCA, "suave"), (22, BOCA_FELIZ, "suave"), (50, BOCA_FELIZ, "suave"), (58, BOCA)])},
        "bigote": {"r": ida_y_vuelta(0, [8, -8, 6], 22, 5)},
        "ojos": {"s": parpadeo(60)},
    }
    return lottie("chepito-saluda", W, H, op, chepito(op, mov))


def cobra():
    """Muestra la cuenta con cara seria y golpea el piso con el pie (en bucle)"""
    op = 60
    cuenta = capa(
        1,
        "cuenta",
        recibo_cobro(),
        [0, 0],
        op,
        p=fijo([86, 200, 0]),
        r=anim([(0, -135), (10, -143), (20, -135), (30, -143), (40, -135), (50, -143), (60, -135)]),
        s=fijo([82, 82, 100]),
        padre=MANO_I,
    )
    mov = {
        "brazo_i": {"r": fijo(150)},
        "antebrazo_i": {"r": fijo(-15)},
        "ceja_i": {"r": fijo(14), "p": fijo([106, 69, 0])},
        "ceja_d": {"r": fijo(-14), "p": fijo([134, 69, 0])},
        "boca": {"forma": fijo(BOCA_TRISTE)},
        "pierna_d": {"r": anim([(0, 0), (8, -10, "suave"), (14, 0, "suave"), (22, -10, "suave"), (28, 0), (60, 0)])},
        "bigote": {"r": ida_y_vuelta(0, [5, -5], 34, 4)},
        "cabeza": {"r": anim([(0, 0), (15, -3), (30, 0), (45, -3), (60, 0)])},
    }
    return lottie("chepito-cobra", W, H, op, chepito(op, mov, en_mano_i=[cuenta]))


def espera():
    """Mira el reloj de bolsillo frente al pecho, golpea el pie y espera (en bucle)"""
    op = 90
    el_reloj = capa(1, "reloj", reloj(), [0, 0], op, p=fijo([86, 192, 0]), r=fijo(90), padre=MANO_I)
    # La aguja que gira (va en el reloj)
    aguja = capa(3, "aguja", [trazo([[0, 0], [0, -9]], CORAL, 2)], [0, 0], op, p=fijo([86, 192, 0]), r=anim([(0, 90), (90, 450)]), padre=MANO_I)
    mov = {
        "brazo_i": {"r": fijo(20)},
        "antebrazo_i": {"r": fijo(-110)},
        "ojos": {
            "p": anim([(0, [120, 83, 0]), (40, [120, 83, 0], "suave"), (46, [121, 79, 0], "suave"), (60, [121, 79, 0], "suave"), (66, [120, 83, 0]), (90, [120, 83, 0])], espacial=True),
            "s": parpadeo(30, op),
        },
        "ceja_i": {"p": anim([(0, [106, 67.5, 0]), (44, [106, 67.5, 0], "suave"), (48, [106, 64, 0], "suave"), (60, [106, 64, 0], "suave"), (64, [106, 67.5, 0]), (90, [106, 67.5, 0])], espacial=True)},
        "pierna_d": {"r": anim([(0, 0), (6, -9, "suave"), (12, 0, "suave"), (18, -9, "suave"), (24, 0), (90, 0)])},
        "bigote": {"r": ida_y_vuelta(0, [6, -6], 70, 4)},
    }
    return lottie("chepito-espera", W, H, op, chepito(op, mov, en_mano_i=[aguja, el_reloj], brazo_i_delante=True))


def envia():
    """Escribe en el celular, sale el mensaje y llega (chulo)"""
    op = 70
    cel = capa(
        1, "celular", celular(), [0, 0], op, p=fijo([86, 196, 0]), r=anim([(0, 0), (8, 100)]), o=anim([(0, 0), (4, 0, "sale"), (8, 100)]), padre=MANO_I
    )
    mensaje = capa(
        2,
        "mensaje",
        [circulo(-16, 0, 7, CORAL), circulo(0, 0, 7, CORAL), circulo(16, 0, 7, CORAL), *globo()],
        [0, 0],
        op,
        p=anim([(0, [112, 140, 0]), (20, [112, 140, 0], "sale"), (34, [190, 62, 0])], espacial=True),
        s=anim([(0, [0, 0, 100]), (20, [0, 0, 100], "rebote"), (30, [100, 100, 100])]),
    )
    listo = chulo(220, 44, 26, 42, op, 3)
    mov = {
        "brazo_i": {"r": anim([(0, 8), (8, 30, "sale"), (14, 30)])},
        "antebrazo_i": {"r": anim([(0, 0), (8, -130, "sale"), (14, -130)])},
        "cabeza": {"r": anim([(0, 0), (8, -6, "suave"), (20, -6, "suave"), (30, 0)])},
        "ojos": {"p": anim([(0, [120, 80, 0]), (8, [117, 83, 0], "suave"), (20, [117, 83, 0], "suave"), (30, [122, 78, 0], "suave"), (44, [122, 78, 0], "suave"), (52, [120, 80, 0])], espacial=True)},
        "boca": {"forma": forma_anim([(0, BOCA), (40, BOCA, "suave"), (46, BOCA_FELIZ)])},
        "bigote": {"r": ida_y_vuelta(0, [7, -7], 44, 4)},
    }
    return lottie("chepito-envia", W, H, op, chepito(op, mov, delante=[listo, mensaje], en_mano_i=[cel], brazo_i_delante=True))


def pagado():
    """Le pagaron: salta de felicidad, el sombrero vuela, caen monedas y sale el chulo"""
    op = 80
    monedas = []
    for n, (x, y, t, d) in enumerate([(54, 70, 14, 26), (186, 64, 18, 22), (120, 18, 22, 20), (40, 140, 26, 18), (202, 132, 24, 20)]):
        monedas.append(
            capa(
                10 + n,
                f"moneda{n}",
                moneda(d),
                [0, 0],
                op,
                p=anim([(0, [120, 150, 0]), (t, [120, 150, 0], "sale"), (t + 12, [x, y, 0], "suave"), (t + 40, [x, y + 70, 0])], espacial=True),
                s=anim([(0, [0, 0, 100]), (t, [0, 0, 100], "rebote"), (t + 8, [100, 100, 100])]),
                r=anim([(0, 0), (t, 0, "lineal"), (t + 40, 300)]),
                o=anim([(0, 0), (t, 0, "lineal"), (t + 2, 100, "lineal"), (t + 30, 100, "lineal"), (t + 40, 0)]),
            )
        )
    listo = chulo(204, 40, 36, 50, op, 2)
    mov = {
        "raiz": {
            "p": anim([(0, [120, 226, 0]), (8, [120, 226, 0], "sale"), (18, [120, 196, 0], "entra"), (28, [120, 226, 0], "sale"), (36, [120, 214, 0], "entra"), (42, [120, 226, 0])], espacial=True),
            "s": anim([(0, [100, 100, 100]), (6, [108, 90, 100], "sale"), (14, [95, 107, 100], "suave"), (28, [108, 92, 100], "rebote"), (34, [100, 100, 100])]),
        },
        "sombra": {"s": anim([(0, [100, 100, 100]), (8, [100, 100, 100], "sale"), (18, [70, 70, 100], "entra"), (28, [100, 100, 100])])},
        "brazo_i": {"r": anim([(0, 8), (6, 8, "sale"), (16, 160, "suave"), (60, 160, "suave"), (70, 8)])},
        "antebrazo_i": {"r": anim([(0, 0), (16, -20, "suave"), (24, 10, "suave"), (32, -20, "suave"), (60, -20, "suave"), (70, 0)])},
        "brazo_d": {"r": anim([(0, -8), (6, -8, "sale"), (16, -40, "suave"), (60, -40, "suave"), (70, -8)])},
        "sombrero": {
            "p": anim([(0, [120, 52, 0]), (10, [120, 52, 0], "sale"), (24, [120, 22, 0], "entra"), (38, [120, 52, 0])], espacial=True),
            "r": anim([(0, 0), (10, 0, "lineal"), (38, -360)]),
        },
        "boca": {"forma": forma_anim([(0, BOCA), (6, BOCA, "suave"), (12, BOCA_FELIZ)])},
        "ceja_i": {"p": anim([(0, [106, 67.5, 0]), (8, [106, 67.5, 0], "suave"), (14, [106, 63, 0])], espacial=True)},
        "ceja_d": {"p": anim([(0, [134, 67.5, 0]), (8, [134, 67.5, 0], "suave"), (14, [134, 63, 0])], espacial=True)},
        "bigote": {"r": ida_y_vuelta(0, [9, -9, 7, -7], 16, 4)},
    }
    return lottie("chepito-pagado", W, H, op, chepito(op, mov, delante=[listo], detras=monedas))


def no_me_escribas():
    """Se pone triste, se baja el sombrero, da media vuelta y se va (con su sombra)"""
    op = 90
    paso = 6
    piernas_i = [(0, 0), (30, 0, "suave")]
    piernas_d = [(0, 0), (30, 0, "suave")]
    t = 30
    signo = 1
    while t < op - paso:
        t += paso
        piernas_i.append((t, 16 * signo, "suave"))
        piernas_d.append((t, -16 * signo, "suave"))
        signo = -signo
    piernas_i.append((op, 0))
    piernas_d.append((op, 0))
    mov = {
        "raiz": {
            "p": anim([(0, [120, 226, 0]), (30, [120, 226, 0], "entra"), (op, [300, 226, 0])], espacial=True),
            "s": anim([(0, [100, 100, 100]), (14, [100, 96, 100], "suave"), (30, [100, 96, 100])]),
        },
        "sombra": {"p": anim([(0, [120, 227, 0]), (30, [120, 227, 0], "entra"), (op, [300, 227, 0])], espacial=True)},
        "cabeza": {"r": anim([(0, 0), (12, 6, "suave"), (30, 6)]), "p": anim([(0, [120, 120, 0]), (12, [120, 124, 0])], espacial=True)},
        "ceja_i": {"r": anim([(0, 0), (8, -16)]), "p": anim([(0, [106, 67.5, 0]), (8, [106, 66, 0])], espacial=True)},
        "ceja_d": {"r": anim([(0, 0), (8, 16)]), "p": anim([(0, [134, 67.5, 0]), (8, [134, 66, 0])], espacial=True)},
        "boca": {"forma": forma_anim([(0, BOCA), (8, BOCA_TRISTE)])},
        "bigote": {"s": anim([(0, [100, 100, 100]), (10, [96, 84, 100])]), "r": anim([(0, 0), (10, 4)])},
        "sombrero": {"p": anim([(0, [120, 52, 0]), (14, [120, 57, 0])], espacial=True), "r": anim([(0, 0), (14, 8)])},
        "ojos": {"s": anim([(0, [100, 100, 100]), (10, [100, 60, 100])])},
        "pierna_i": {"r": anim(piernas_i)},
        "pierna_d": {"r": anim(piernas_d)},
        "brazo_i": {"r": anim([(0, 8), (30, 4, "suave"), (60, 14, "suave"), (op, 4)])},
        "brazo_d": {"r": anim([(0, -8), (30, -4, "suave"), (60, -14, "suave"), (op, -4)])},
    }
    return lottie("chepito-no-me-escribas", W, H, op, chepito(op, mov))


if __name__ == "__main__":
    guardar("chepito", quieto_en_bucle())
    guardar("chepito-saluda", saluda())
    guardar("chepito-cobra", cobra())
    guardar("chepito-espera", espera())
    guardar("chepito-envia", envia())
    guardar("chepito-pagado", pagado())
    guardar("chepito-no-me-escribas", no_me_escribas())
