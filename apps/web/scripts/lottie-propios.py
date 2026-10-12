"""Lottie propios de Luks, dibujados con la paleta del kit (no vienen de LottieFiles).

  python3 scripts/lottie-propios.py   # escribe public/lottie/{archivar,borrar,mister-luks,vincular-whatsapp}.lottie

· archivar: una cuenta (un recibo) cae en una caja, la tapa se cierra y sale un chulo.
· borrar: la papelera abre la tapa, el recibo cae, se cierra, se sacude y suelta polvito.
· mister-luks: el ícono de Luks entra, cae la moneda y sale un globo de chat que termina en un chulo.
· vincular-whatsapp: el celular con su código, una línea lo une con Luks y sale un chulo.
"""

import json
import zipfile
from pathlib import Path

PUBLICO = Path(__file__).resolve().parent.parent / "public" / "lottie"
FR = 30


def color(h):
    h = h.lstrip("#")
    return [round(int(h[i : i + 2], 16) / 255, 4) for i in (0, 2, 4)] + [1]


MORADO = color("#6A35E6")
MORADO_OSCURO = color("#4E22B8")
MORADO_SUAVE = color("#ECE4FF")
AMARILLO = color("#FFC53D")
VERDE = color("#2BD48A")
CORAL = color("#DB2F47")
CORAL_OSCURO = color("#A8182F")
CORAL_CLARO = color("#F06A7D")
TINTA = color("#1C1433")
LINEA = color("#C9C0DA")
POLVO = color("#B4AACB")
BLANCO = color("#FFFFFF")
# Los del logo de Luks (public/brand/luks-icono-plano.svg)
ICONO_VERDE = color("#3E9A70")
ICONO_MORADO = color("#7A5AB3")
ICONO_AMARILLO = color("#F0BE2E")

# cubic-bezier de cada curva
CURVAS = {
    "lineal": (0.167, 0.167, 0.833, 0.833),
    "sale": (0.16, 1, 0.3, 1),
    "entra": (0.5, 0, 0.75, 0),
    "suave": (0.65, 0, 0.35, 1),
    "rebote": (0.34, 1.56, 0.64, 1),
}


def fijo(v):
    return {"a": 0, "k": v}


def anim(cuadros, espacial=False):
    """cuadros: [(t, valor, curva hacia el siguiente)]; el último sin curva."""
    kf = []
    for n, c in enumerate(cuadros):
        t, v = c[0], c[1]
        s = v if isinstance(v, list) else [v]
        k = {"t": t, "s": s}
        if n < len(cuadros) - 1:
            x1, y1, x2, y2 = CURVAS[c[2] if len(c) > 2 else "suave"]
            if espacial:
                k["o"] = {"x": x1, "y": y1}
                k["i"] = {"x": x2, "y": y2}
                k["to"] = [0, 0, 0]
                k["ti"] = [0, 0, 0]
            else:
                d = len(s)
                k["o"] = {"x": [x1] * d, "y": [y1] * d}
                k["i"] = {"x": [x2] * d, "y": [y2] * d}
        kf.append(k)
    return {"a": 1, "k": kf}


def aparece():
    """Entra suave (la opacidad no pasa de una capa a las que cuelgan de ella)"""
    return anim([(0, 0, "sale"), (6, 100)])


def tr():
    return {
        "ty": "tr",
        "p": fijo([0, 0]),
        "a": fijo([0, 0]),
        "s": fijo([100, 100]),
        "r": fijo(0),
        "o": fijo(100),
        "sk": fijo(0),
        "sa": fijo(0),
    }


def rect(x, y, w, h, r, relleno, borde=None):
    it = [{"ty": "rc", "d": 1, "s": fijo([w, h]), "p": fijo([x, y]), "r": fijo(r)}]
    if borde:
        it.append(
            {
                "ty": "st",
                "c": fijo(borde[0]),
                "o": fijo(100),
                "w": fijo(borde[1]),
                "lc": 2,
                "lj": 2,
                "ml": 4,
            }
        )
    it.append({"ty": "fl", "c": fijo(relleno), "o": fijo(100), "r": 1})
    it.append(tr())
    return {"ty": "gr", "it": it}


def circulo(x, y, d, relleno):
    return {
        "ty": "gr",
        "it": [
            {"ty": "el", "d": 1, "s": fijo([d, d]), "p": fijo([x, y])},
            {"ty": "fl", "c": fijo(relleno), "o": fijo(100), "r": 1},
            tr(),
        ],
    }


def trazo(puntos, color_, ancho, fin=None):
    linea = {
        "i": [[0, 0]] * len(puntos),
        "o": [[0, 0]] * len(puntos),
        "v": puntos,
        "c": False,
    }
    it = [{"ty": "sh", "ks": fijo(linea)}]
    if fin:
        it.append({"ty": "tm", "s": fijo(0), "e": fin, "o": fijo(0), "m": 1})
    it.append(
        {
            "ty": "st",
            "c": fijo(color_),
            "o": fijo(100),
            "w": fijo(ancho),
            "lc": 2,
            "lj": 2,
        }
    )
    it.append(tr())
    return {"ty": "gr", "it": it}


def capa(ind, nombre, formas, ancla, op, *, p=None, r=None, s=None, o=None, padre=None):
    ks = {
        "o": o or fijo(100),
        "r": r or fijo(0),
        "p": p or fijo(ancla + [0]),
        "a": fijo(ancla + [0]),
        "s": s or fijo([100, 100, 100]),
    }
    c = {
        "ddd": 0,
        "ind": ind,
        "ty": 4,
        "nm": nombre,
        "sr": 1,
        "ks": ks,
        "ao": 0,
        "shapes": formas,
        "ip": 0,
        "op": op,
        "st": 0,
        "bm": 0,
    }
    if padre:
        c["parent"] = padre
    return c


def recibo(ancho, alto):
    """Un recibo blanco con renglones y el total en amarillo, centrado en (0, 0)."""
    y0 = -alto / 2
    return [
        rect(0, y0 + alto * 0.62, ancho * 0.56, 7, 3.5, AMARILLO),
        rect(-ancho * 0.08, y0 + alto * 0.42, ancho * 0.6, 5, 2.5, LINEA),
        rect(-ancho * 0.04, y0 + alto * 0.28, ancho * 0.68, 5, 2.5, LINEA),
        rect(0, 0, ancho, alto, 9, BLANCO, (TINTA, 3)),
    ]


def lottie(nombre, w, h, op, capas):
    return {
        "v": "5.7.4",
        "fr": FR,
        "ip": 0,
        "op": op,
        "w": w,
        "h": h,
        "nm": nombre,
        "ddd": 0,
        "assets": [],
        "layers": capas,
    }


def archivar():
    op = 56
    # La caja se aplasta un poco cuando la tapa cae (todo lo de la caja cuelga de esta capa)
    caja = capa(
        2,
        "caja",
        [rect(120, 176, 112, 66, 14, MORADO), rect(120, 170, 42, 11, 5.5, AMARILLO)],
        [120, 210],
        op,
        s=anim(
            [
                (0, [92, 92, 100], "rebote"),
                (8, [100, 100, 100]),
                (29, [100, 100, 100], "sale"),
                (33, [107, 91, 100], "sale"),
                (39, [98, 103, 100], "suave"),
                (46, [100, 100, 100]),
            ]
        ),
        o=aparece(),
    )
    # Abierta queda parada a la izquierda, fuera del camino del recibo
    tapa = capa(
        1,
        "tapa",
        [rect(120, 136, 122, 18, 8, MORADO_OSCURO)],
        [61, 136],
        op,
        r=anim(
            [(0, -92), (17, -92, "entra"), (28, 0, "sale"), (31, -9, "suave"), (36, 0)]
        ),
        o=aparece(),
        padre=2,
    )
    boca = capa(
        4,
        "boca",
        [rect(120, 146, 104, 10, 5, MORADO_OSCURO)],
        [120, 146],
        op,
        o=aparece(),
        padre=2,
    )
    tarjeta = capa(
        3,
        "recibo",
        recibo(54, 68),
        [0, 0],
        op,
        p=anim(
            [
                (0, [124, 40, 0], "sale"),
                (5, [124, 46, 0], "entra"),
                (23, [120, 180, 0]),
            ],
            espacial=True,
        ),
        r=anim([(0, -12, "suave"), (23, 3)]),
        s=anim([(0, [100, 100, 100], "entra"), (23, [70, 70, 100])]),
        o=anim([(0, 0, "sale"), (5, 100, "lineal"), (27, 100, "lineal"), (28, 0)]),
    )
    chulo = capa(
        6,
        "chulo",
        [
            trazo(
                [[-9, 1], [-3, 7], [9, -6]],
                BLANCO,
                6,
                fin=anim([(38, 0, "sale"), (48, 100)]),
            ),
            circulo(0, 0, 44, VERDE),
        ],
        [0, 0],
        op,
        p=fijo([176, 106, 0]),
        s=anim([(0, [0, 0, 100]), (34, [0, 0, 100], "rebote"), (42, [100, 100, 100])]),
    )
    sombra = capa(
        5,
        "sombra",
        [
            {
                "ty": "gr",
                "it": [
                    {"ty": "el", "d": 1, "s": fijo([120, 12]), "p": fijo([120, 214])},
                    {"ty": "fl", "c": fijo(TINTA), "o": fijo(10), "r": 1},
                    tr(),
                ],
            }
        ],
        [120, 214],
        op,
        o=aparece(),
        padre=2,
    )
    # Arriba primero: chulo, tapa, caja, recibo, boca, sombra
    return lottie("archivar", 240, 240, op, [chulo, tapa, caja, tarjeta, boca, sombra])


def borrar():
    op = 62
    lata = capa(
        2,
        "lata",
        [
            rect(98, 154, 8, 62, 4, CORAL_CLARO),
            rect(120, 154, 8, 62, 4, CORAL_CLARO),
            rect(142, 154, 8, 62, 4, CORAL_CLARO),
            rect(120, 154, 100, 96, 14, CORAL),
        ],
        [120, 202],
        op,
        r=anim(
            [
                (0, 0),
                (33, 0, "suave"),
                (37, -6, "suave"),
                (41, 5, "suave"),
                (45, -3, "suave"),
                (49, 0),
            ]
        ),
        s=anim([(0, [92, 92, 100], "rebote"), (8, [100, 100, 100])]),
        o=aparece(),
    )
    tapa = capa(
        1,
        "tapa",
        [
            rect(120, 92, 26, 10, 5, CORAL_OSCURO),
            rect(120, 101, 118, 16, 7, CORAL_OSCURO),
        ],
        [178, 101],
        op,
        r=anim(
            [
                (0, 0),
                (4, 0, "sale"),
                (12, 38),
                (24, 38, "entra"),
                (30, 0, "sale"),
                (33, 5, "suave"),
                (37, 0),
            ]
        ),
        o=aparece(),
        padre=2,
    )
    boca = capa(
        4,
        "boca",
        [rect(120, 108, 104, 10, 5, CORAL_OSCURO)],
        [120, 108],
        op,
        o=aparece(),
        padre=2,
    )
    # Cae por delante de la tapa abierta y se encoge al entrar por la boca
    tarjeta = capa(
        3,
        "recibo",
        recibo(54, 70),
        [0, 0],
        op,
        p=anim(
            [(0, [118, 40, 0]), (8, [118, 40, 0], "entra"), (24, [120, 112, 0])],
            espacial=True,
        ),
        r=anim([(0, 10), (8, 10, "suave"), (24, -4)]),
        s=anim([(8, [100, 100, 100], "entra"), (24, [52, 40, 100])]),
        o=anim(
            [(0, 0), (8, 0, "sale"), (11, 100, "lineal"), (21, 100, "entra"), (25, 0)]
        ),
    )
    polvo = []
    for n, (dx, dy, d) in enumerate(
        [(-58, -26, 12), (-44, -48, 9), (52, -40, 10), (64, -18, 8)]
    ):
        polvo.append(
            capa(
                10 + n,
                f"polvo{n}",
                [circulo(0, 0, d, POLVO)],
                [0, 0],
                op,
                p=anim(
                    [
                        (31, [120 + dx * 0.4, 100, 0], "sale"),
                        (52, [120 + dx, 100 + dy, 0]),
                    ],
                    espacial=True,
                ),
                s=anim(
                    [
                        (31, [40, 40, 100], "sale"),
                        (44, [110, 110, 100], "suave"),
                        (54, [60, 60, 100]),
                    ]
                ),
                o=anim(
                    [
                        (0, 0),
                        (31, 0, "sale"),
                        (34, 100, "lineal"),
                        (44, 100, "suave"),
                        (56, 0),
                    ]
                ),
            )
        )
    sombra = capa(
        5,
        "sombra",
        [
            {
                "ty": "gr",
                "it": [
                    {"ty": "el", "d": 1, "s": fijo([112, 14]), "p": fijo([120, 206])},
                    {"ty": "fl", "c": fijo(TINTA), "o": fijo(10), "r": 1},
                    tr(),
                ],
            }
        ],
        [120, 206],
        op,
        o=aparece(),
    )
    capas = polvo + [tarjeta, tapa, lata, boca, sombra]
    return lottie("borrar", 240, 240, op, capas)


def poligono(puntos, relleno):
    """Una figura cerrada y rellena (la colita del globo de chat)."""
    forma = {
        "i": [[0, 0]] * len(puntos),
        "o": [[0, 0]] * len(puntos),
        "v": puntos,
        "c": True,
    }
    return {
        "ty": "gr",
        "it": [
            {"ty": "sh", "ks": fijo(forma)},
            {"ty": "fl", "c": fijo(relleno), "o": fijo(100), "r": 1},
            tr(),
        ],
    }


def chulo(x, y, d, desde, op, ind):
    """El círculo verde que aparece con rebote y el chulo blanco que se dibuja."""
    return capa(
        ind,
        "chulo",
        [
            trazo(
                [[-d * 0.2, d * 0.02], [-d * 0.07, d * 0.16], [d * 0.2, -d * 0.14]],
                BLANCO,
                d * 0.14,
                fin=anim([(desde + 4, 0, "sale"), (desde + 14, 100)]),
            ),
            circulo(0, 0, d, VERDE),
        ],
        [0, 0],
        op,
        p=fijo([x, y, 0]),
        s=anim(
            [
                (0, [0, 0, 100]),
                (desde, [0, 0, 100], "rebote"),
                (desde + 8, [100, 100, 100]),
            ]
        ),
    )


def mister_luks():
    """Mister Luks: el ícono de Luks entra, la moneda cae, sale un globo de chat
    con tres puntos (está escribiendo) y termina en un chulo."""
    op = 60
    icono = capa(
        2,
        "icono",
        [
            rect(104, 186, 122, 44, 22, ICONO_MORADO),
            rect(78, 140, 44, 112, 22, ICONO_VERDE),
        ],
        [92, 208],
        op,
        s=anim([(0, [70, 70, 100], "rebote"), (10, [100, 100, 100])]),
        o=aparece(),
    )
    moneda = capa(
        3,
        "moneda",
        [circulo(0, 0, 34, ICONO_AMARILLO)],
        [0, 0],
        op,
        p=anim(
            [
                (4, [124, 40, 0], "entra"),
                (14, [124, 106, 0], "sale"),
                (18, [124, 100, 0], "suave"),
                (22, [124, 104, 0]),
            ],
            espacial=True,
        ),
        o=anim([(0, 0), (4, 0, "sale"), (7, 100)]),
    )
    globo = capa(
        4,
        "globo",
        [
            poligono([[150, 92], [166, 92], [148, 108]], BLANCO),
            rect(176, 70, 92, 56, 18, BLANCO, (TINTA, 3)),
        ],
        [150, 100],
        op,
        s=anim([(0, [0, 0, 100]), (16, [0, 0, 100], "rebote"), (24, [100, 100, 100])]),
    )
    puntos = []
    for n, x in enumerate([158, 176, 194]):
        inicio = 24 + n * 4
        puntos.append(
            capa(
                5 + n,
                f"punto{n}",
                [circulo(0, 0, 11, MORADO)],
                [0, 0],
                op,
                p=anim(
                    [
                        (inicio, [x, 74, 0], "sale"),
                        (inicio + 4, [x, 66, 0], "suave"),
                        (inicio + 8, [x, 70, 0]),
                    ],
                    espacial=True,
                ),
                o=anim(
                    [
                        (0, 0),
                        (inicio, 0, "sale"),
                        (inicio + 3, 100, "lineal"),
                        (42, 100, "entra"),
                        (45, 0),
                    ]
                ),
            )
        )
    listo = chulo(176, 70, 40, 42, op, 1)
    # Arriba primero: el chulo, los puntos, el globo, la moneda y el ícono
    return lottie(
        "mister-luks", 240, 240, op, [listo] + puntos + [globo, moneda, icono]
    )


def vincular_whatsapp():
    """Vincular el WhatsApp: el celular muestra el código, una línea lo une con
    Luks (como WhatsApp Web) y termina en un chulo."""
    op = 60
    celular = capa(
        2,
        "celular",
        [
            rect(64, 168, 18, 4, 2, LINEA),
            rect(56, 108, 14, 14, 3, TINTA),
            rect(76, 108, 14, 14, 3, TINTA),
            rect(56, 128, 14, 14, 3, TINTA),
            rect(76, 132, 6, 6, 1, TINTA),
            rect(66, 122, 50, 80, 8, MORADO_SUAVE),
            rect(66, 124, 66, 112, 14, BLANCO, (TINTA, 3)),
        ],
        [66, 180],
        op,
        s=anim([(0, [80, 80, 100], "rebote"), (10, [100, 100, 100])]),
        o=aparece(),
    )
    luks = capa(
        3,
        "luks",
        [
            # La base del computador y, en la pantalla, el logo de Luks en chiquito
            rect(180, 150, 104, 10, 5, TINTA),
            circulo(188, 101, 11, ICONO_AMARILLO),
            rect(171, 113, 12, 30, 6, ICONO_VERDE),
            rect(181, 125, 32, 12, 6, ICONO_MORADO),
            rect(180, 112, 84, 60, 8, BLANCO, (TINTA, 3)),
        ],
        [180, 155],
        op,
        s=anim(
            [(0, [80, 80, 100]), (4, [80, 80, 100], "rebote"), (14, [100, 100, 100])]
        ),
        o=anim([(0, 0), (4, 0, "sale"), (10, 100)]),
    )
    enlace = capa(
        4,
        "enlace",
        [
            trazo(
                [[102, 124], [136, 124]],
                MORADO,
                6,
                fin=anim([(14, 0, "sale"), (28, 100)]),
            )
        ],
        [0, 0],
        op,
    )
    listo = chulo(119, 124, 38, 30, op, 1)
    return lottie("vincular-whatsapp", 240, 240, op, [listo, enlace, luks, celular])


def guardar(nombre, animacion):
    destino = PUBLICO / f"{nombre}.lottie"
    manifest = {
        "animations": [{"id": nombre, "mode": "normal", "direction": 1}],
        "author": "Luks",
        "generator": "scripts/lottie-propios.py",
        "version": "1.0",
    }
    with zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, separators=(",", ":")))
        z.writestr(
            f"animations/{nombre}.json", json.dumps(animacion, separators=(",", ":"))
        )
    print(destino, destino.stat().st_size, "bytes")


if __name__ == "__main__":
    guardar("archivar", archivar())
    guardar("borrar", borrar())
    guardar("mister-luks", mister_luks())
    guardar("vincular-whatsapp", vincular_whatsapp())
