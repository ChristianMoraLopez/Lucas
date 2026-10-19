"""Ítems leídos del texto del OCR (lucas_worker/extract/items.py), con recibos reales de Bogotá (sin datos personales)."""

from __future__ import annotations

from lucas_worker.extract.items import items_cuadran, items_del_recibo

GOURMET = """·GOURMET
26-200-032719
2619.40:38
uario: VENDEDOR CAJA 2
Orden Nº: CLIENTE 3
HIT PET 500
1 x 4.500,00 € 4 500,00 €
PAPA BACON
2 × 5.000,00 € 10.000,00 €
PASTELES
1 x 4.000,00 € 4.000,00 €
POLLO CHAMPINON
1 x 3.900,00 € 3,900,00 €
Cantidad de artículos: 4
TOTAL: 22.400,00 €
DAVIVIENDA 22,400,00 €
Recibido: 20 400,00 €"""

TIQUETE = """ALMACENES ONLY
NIT 860036892
Fecha: 0CT/04/26 - 12:05:59
Consecutivo # 03070000042918
Vend Sc Cnt Producto Vr Uni Vr Total
92 5 2 CAMISETA 23.800 47.600
TOTAL $ 47.600
T. Debito 47.600
CAMBIO $ 0"""

DROGUERIA = """DISTRIBUIDORA PASTEUR
RESPONSABLE DE IVA
FACT AUT 18764082225058
DE: E567 1 A: E567 2500000
FECHA: 06-10-2026 19:07
VENDEDOR: CAJA 2
CODIGO-NOMBRE
V.UNI ENT FRA DTO PARCIAL
548029-REPELENTE STAY OFF AMAZONIC
AEROSOL 160 ML(PF)
24,110 1 0 6,028 24,110
---[TOTAL DE FACTURA]--
TOAT: 24,110"""

FRUVER = """INVERSIONES APARICIO S.A.S
NIT 901322598-2
Fecha 24-Sep-2026 Hora 12:23.35
Cant. I.V.A Desonpuioa Vale
8200 CEBOLLA CABEZONA ROJA
$4,920.0
6600/ LIMÓN TAHITI
$3,960.0
1900 / VERDURAS
$608.0
1.000/ ACEITE VIVA SOYA 500 ML
$4,800.0
2.000/ PAN SUPER HAMBURGUESA
X6UND $17,400.0
1.000 / SALSA DE TOMATE SAN
JORGE 600 GR
$12,400.0
7.5500
Detalle deValores
Valor Bruto: $44,088.0
TOTALAPAGAR: $44,088.0"""

HOMECENTER = """HOMECENTER
COMPROBANTE DE VENTA ASOCIADO A LA
FACTURA ELECTRONICA NO. 6305 0100340644
01/10/26 18:10 0058 005 7834
CODIGO DESCRIPCION VALOR
691986
1 X 56,900
TRAPERO MICROFIBRA A 56,900 D
TOTAL AHORROS $ 0
VALOR RECIBIDO: $ 56,900"""

DOLLARCITY = """Dollarcity
NIT:9009432434
COMPROBANTE DE VENTA
No. F4F2 - 2047348
1SCRUBBERCLEANZ GUANTES GRD LAT
220806003832 0000
1@4000.00
2TRAPEADOR DE MICROFIBRA GIRATO
667888132416 18000.00 B
1 @ 18000.00
3LAVAPLATOS LIQ LIMON DOYPACK A
7702010382079 16000.00 B
1@ 16000.00
QUITAGRASA SPRAY C/GATILLO TAN
7709157167491 4000.00 B
14000.00
TOTAL COP 42000.00
MASTERCARD C0P 42000.00"""

BOLETA_CHILE = """SOC RISTORANTE LE DUE TORRI LIMITADA
81.300.500-K
BOLETAELECTRONICA: 254764
FECHA DE EMISION: 16-10-2026 HORA: 22:27:39
GARZON Alexis Vasquez
PEDIDO:30114
DESCRIPCION CANT PRECIO VAL.OR
Coca Cola Zero 3 2.990 8970
LimonMentJeng 2 4.690 9.380
Limonada Tradicional 1 4.690 4.690
SPA Napolitana 1 11.950 11.950
SPA Carbonara Panna 1 17.950 17.950
RAV Napolitana 1 17.800 17.800
RAV Alfredo 1 17.950 17.950
Filete Grill 1 19.850 19.850
Paslas Sin Mariscos 1 9.950 9.950
12 Spaguetti
12 SPA Carbonara
Puyehue sin gas 1 3.690 3.690
TOTAL $ 122.180
SA-CREDITO S 122.180
El IVA de esta boleta es $ 19.508"""

# «PRODUCTO CANT TOTAL»: la cantidad va pegada al nombre y el valor es el del renglón
CUENTA_MISTICO = """MISTICO
18-10-2025 14:01:23 MAC-IVER 366 SIG CENTRO N.Pers: 7
MESA: 200
GARZON: JEAMPIER
PRODUCTO CANT TOTAL
LIMONADA GEN/MENT 3 17.100
L.IMONADA 1 4.400
CUSQUEÑA MICHELADA 1 5.600
VITAL SIN GAS 350CC 1 3.100
CAUSA ACEVICHADA 1 12.000
PAPAS HUANCAINA 8.500
AJI GALLINA 2 23.000
ARROZ CHAUFA MARISCO 1 16.800
ARROZ CHAUFA CARNE 1 15.800
CABRITO NORTEÑA 1 17.900
FETUCHIN HUANC LOM SALTD 1 17.200
COCA ZERO 350CC 1 3.500
TOTAL 144.900
PROPINA SUGERIDA 14.490"""

CUENTA_BRUNA = """Mesa Fecha 17/10/2026
Garzon 167
Comanda: 166169 BRUNA
Hora: 21:59
DETALLE DE MESA
CANT ARTICULO
2 MISTRAL NOBEL 15,000
6 2X PISCO SOURCATEDR47,700
SUBTOTAL S 62,700
Dscto. S 0
Recargo S 0
TOTAL A PAGAR S 62,700
10 % PropSugerida S 6,270
TOTAL + PROPINA S 68,970"""

NU_EXTRANJERO = """nU
Comprobante de
transacción
Valor $62.569,20
Tipo de transacción Compra en internet
Código de autorización 979382
Costo por conversión $281,56
Pagaste en
Comercio Una Suscripción"""

NU = """nU
Comprobante de
transacción
15:19, Sábado, 3 de Octubre de 2026
Valor $28.600,00
Tipo de
Compra con datáfono
Código de autorización 389559
Pagaste en
Comercio Surticarnes"""

NEQUI = """Comprobante de pago
Envío Realizado
Para
Porcelanas
¿Cuánto?
$8.200,00
Número Nequi
311 861 0769"""


def _tabla(texto: str, total: int) -> list[tuple[str, float, int | None, int]]:
    return [(i.name, i.quantity, i.unit_price_cop, i.total_cop) for i in items_del_recibo(texto, total)]


def test_nombre_arriba_y_cantidad_por_precio_abajo():
    assert _tabla(GOURMET, 22_400) == [
        ("Hit Pet 500", 1, 4_500, 4_500),
        ("Papa Bacon", 2, 5_000, 10_000),
        ("Pasteles", 1, 4_000, 4_000),
        ("Pollo Champinon", 1, 3_900, 3_900),
    ]


def test_tabla_con_codigos_y_la_cantidad_sale_del_unitario():
    assert _tabla(TIQUETE, 47_600) == [("Camiseta", 2, 23_800, 47_600)]


def test_nombre_en_dos_renglones_y_el_ultimo_valor_es_el_total():
    assert _tabla(DROGUERIA, 24_110) == [("Repelente Stay Off Amazonic Aerosol 160 Ml(pf)", 1, 24_110, 24_110)]


def test_cantidad_con_decimales_y_precio_en_el_renglon_de_abajo():
    assert _tabla(FRUVER, 44_088) == [
        ("Cebolla Cabezona Roja", 1, 4_920, 4_920),
        ("Limón Tahiti", 1, 3_960, 3_960),
        ("Verduras", 1, 608, 608),
        ("Aceite Viva Soya 500 Ml", 1, 4_800, 4_800),
        ("Pan Super Hamburguesa X6und", 2, 8_700, 17_400),
        ("Salsa De Tomate San Jorge 600 Gr", 1, 12_400, 12_400),
    ]


def test_codigo_de_barras_en_medio_y_cantidad_con_arroba():
    assert _tabla(DOLLARCITY, 42_000) == [
        ("Scrubbercleanz Guantes Grd Lat", 1, 4_000, 4_000),
        ("Trapeador De Microfibra Girato", 1, 18_000, 18_000),
        ("Lavaplatos Liq Limon Doypack A", 1, 16_000, 16_000),
        ("Quitagrasa Spray C/gatillo Tan", 1, 4_000, 4_000),
    ]


def test_lo_que_va_despues_del_monto_es_el_codigo_del_iva():
    assert _tabla(HOMECENTER, 56_900) == [("Trapero Microfibra A", 1, 56_900, 56_900)]


def test_boleta_chilena_con_la_cantidad_en_la_misma_linea():
    # «Coca Cola Zero 3 2.990 8970»: son tres, aunque el total venga sin puntos
    assert _tabla(BOLETA_CHILE, 122_180) == [
        ("Coca Cola Zero", 3, 2_990, 8_970),
        ("LimonMentJeng", 2, 4_690, 9_380),
        ("Limonada Tradicional", 1, 4_690, 4_690),
        ("SPA Napolitana", 1, 11_950, 11_950),
        ("SPA Carbonara Panna", 1, 17_950, 17_950),
        ("RAV Napolitana", 1, 17_800, 17_800),
        ("RAV Alfredo", 1, 17_950, 17_950),
        ("Filete Grill", 1, 19_850, 19_850),
        ("Paslas Sin Mariscos", 1, 9_950, 9_950),
        ("Puyehue sin gas", 1, 3_690, 3_690),
    ]
    assert sum(t for *_, t in _tabla(BOLETA_CHILE, 122_180)) == 122_180


def test_cuenta_chilena_con_la_cantidad_primero_y_el_precio_pegado():
    # «6 2X PISCO SOURCATEDR47,700»: seis piscos (en promoción 2x) y el precio pegado al nombre
    assert _tabla(CUENTA_BRUNA, 62_700) == [
        ("Mistral Nobel", 2, 7_500, 15_000),
        ("Pisco Sourcatedr", 6, 7_950, 47_700),
    ]


def test_cuenta_chilena_con_la_cantidad_despues_del_nombre_y_el_total_del_renglon():
    # «LIMONADA GEN/MENT 3 17.100»: son 3 limonadas que valen 17.100 entre las tres (no cada una)
    items = _tabla(CUENTA_MISTICO, 159_390)
    assert items[:3] == [
        ("Limonada Gen/ment", 3, 5_700, 17_100),
        ("L.imonada", 1, 4_400, 4_400),
        ("Cusqueña Michelada", 1, 5_600, 5_600),
    ]
    assert ("Aji Gallina", 2, 11_500, 23_000) in items
    assert ("Papas Huancaina", 1, 8_500, 8_500) in items
    assert ("Vital Sin Gas 350cc", 1, 3_100, 3_100) in items
    assert sum(t for *_, t in items) == 144_900


def test_un_comprobante_de_banco_no_tiene_items():
    assert _tabla(NU, 28_600) == []
    assert _tabla(NEQUI, 8_200) == []
    # Dos montos (valor y costo por conversión) tampoco son ítems
    assert _tabla(NU_EXTRANJERO, 62_569) == []


def test_si_no_cuadran_con_el_total_no_se_usan():
    # El OCR leyó la mitad del recibo de otra cosa: mejor ninguno
    assert _tabla(GOURMET, 90_000) == []
    assert _tabla(GOURMET, 0) == []


def test_cuadran_con_propina_pero_no_si_pasan_el_total():
    assert items_cuadran([50_000, 30_000], 88_000)  # 10 % de servicio aparte
    assert not items_cuadran([50_000, 60_000], 100_000)
    assert not items_cuadran([10_000], 100_000)
