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


def test_un_comprobante_de_banco_no_tiene_items():
    assert _tabla(NU, 28_600) == []
    assert _tabla(NEQUI, 8_200) == []


def test_si_no_cuadran_con_el_total_no_se_usan():
    # El OCR leyó la mitad del recibo de otra cosa: mejor ninguno
    assert _tabla(GOURMET, 90_000) == []
    assert _tabla(GOURMET, 0) == []


def test_cuadran_con_propina_pero_no_si_pasan_el_total():
    assert items_cuadran([50_000, 30_000], 88_000)  # 10 % de servicio aparte
    assert not items_cuadran([50_000, 60_000], 100_000)
    assert not items_cuadran([10_000], 100_000)
