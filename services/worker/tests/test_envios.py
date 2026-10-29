"""El pantallazo de una transferencia a una persona: cuánto y a quién."""

from lucas_worker.extract.envios import envio_a_persona, montos_del_comprobante, parece_comprobante

# El de Javi en Gentelinda: «@MrLuks ya pagué mi amor ❤️»
NU_BRE_B = """10:47 4G 59
X Bre-B|nu
Listo! Enviaste tu dinero
$48.750
Para Chr****** Rey** Mor*** Lop**
Más impuesto del gobierno 4x1000
$195
Recibe en su cuenta de
Bancolombia
Fecha de envío
24 de octubre de 2026 a las 22:47h
Contacto guardado"""

NEQUI = """Comprobante de pago
Envío Realizado
Para
Porcelanas
¿Cuánto?
$8.200,00
Número Nequi
311 861 0769"""

# El de Juanes en Nochita: Nu parte «Comprobante de / transferencia» y pone «Nombre» antes del nombre
NU_COMPROBANTE = """NU
Comprobante de
transferencia
29 OCT 2026 - 00:17:44
Monto total $9.800,00
Monto $9.800,00
Impuesto 4x1.000 $0,00
Vía Bre-B
Número de comprobante (ID MOL)
20261029901658107ENT001744443205649
Para
Nombre Christian Rey Mora Lopez
Entidad Bancolombia
Llave 1018441569
Estado Completada
De
Nombre Jua Esteban Jiménez Jiménez
Entidad Nu C.F.
Número de cuenta …4490
Nu C.F.
NIT:901.658.107-2"""

# El de Tiago en Nochita (Bancolombia): «Destino: …»
BANCOLOMBIA = """Envío exitoso!
Fecha y hora: 29 octubre 202612:20 a.m.
Cuenta origen: SANTIAGO ECHEVERRIA
SANCHEZ *******0653
Destino: Christian Rey Mora Lopez
Llave: 1018441569
Valor: $ 9.800,00
Entidad financiera: Bancolombia
Concepto: H
Costo de la transacción: $0,00
ID Transacción:
10551075688770760113691379554689485"""

# La de Oxxo en Nochita: una compra con la tarjeta de Nu
NU_OXXO = """Oxxo Arrayanes
$78.400,00
20:13, Miércoles, 28 de Octubre de 2026
Comprobante Reportar
problema
Establecimiento
Oxxo Arrayanes
Categoría
Supermercado
Tarjeta virtual
.…. 9687"""

NU_COMPRA = """nU
Comprobante de
transacción
Valor $28.600,00
Tipo de
Compra con datáfono
Pagaste en
Comercio Surticarnes"""


def test_transferencia_de_nu_por_bre_b():
    e = envio_a_persona(NU_BRE_B)
    # El 4x1000 no es lo que envió; del nombre solo se ve el principio
    assert e is not None and e.monto == 48_750 and e.para == ["chr", "rey", "mor", "lop"]


def test_envio_de_nequi_con_el_nombre_en_la_linea_siguiente():
    e = envio_a_persona(NEQUI)
    assert e is not None and e.monto == 8_200 and e.para == ["porcelanas"]


def test_una_compra_con_la_tarjeta_no_es_un_envio():
    assert envio_a_persona(NU_COMPRA) is None
    assert envio_a_persona("PANADERIA LA ESPIGA\nTOTAL 11.300") is None


def test_comprobante_de_transferencia_de_nu_con_el_nombre_despues_de_nombre():
    e = envio_a_persona(NU_COMPROBANTE)
    assert e is not None and e.monto == 9_800 and e.para == ["christian", "rey", "mora", "lopez"]


def test_envio_exitoso_de_bancolombia_con_destino():
    e = envio_a_persona(BANCOLOMBIA)
    assert e is not None and e.monto == 9_800 and e.para == ["christian", "rey", "mora", "lopez"]


def test_una_compra_en_un_establecimiento_no_es_un_envio_ni_lo_parece():
    assert envio_a_persona(NU_OXXO) is None
    assert not parece_comprobante(NU_OXXO)
    assert not parece_comprobante(NU_COMPRA)


def test_lo_que_parece_un_comprobante_y_sus_montos():
    # Otro banco, otro formato: no se sabe leer del todo, pero tiene cara de transferencia
    raro = "Davivienda\nTransacción aprobada\nLlave destino @vale\nValor\n$ 25.000\nCosto $0\nReferencia 99887766"
    assert envio_a_persona(raro) is None
    assert parece_comprobante(raro)
    assert montos_del_comprobante(raro) == [25_000]
    assert montos_del_comprobante(NU_COMPROBANTE) == [9_800]
    assert not parece_comprobante("PANADERIA LA ESPIGA\nTOTAL 11.300")
