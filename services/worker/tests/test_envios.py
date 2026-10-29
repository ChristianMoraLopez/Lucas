"""El pantallazo de una transferencia a una persona: cuánto y a quién."""

from lucas_worker.extract.envios import envio_a_persona

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
