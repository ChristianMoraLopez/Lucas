"""Instrucciones para Qwen. En inglés (lo sigue mejor), con los datos en español tal cual."""

from __future__ import annotations

from datetime import date

from ..extract.numbers import con_centavos
from ..extract.qr_dian import DianQr

# Cuentas en dólares o bolivianos: los montos van en centavos (los campos se siguen llamando *_cop)
_CENTAVOS = (
    "IMPORTANT: this account is not in Colombian pesos. Ignore the peso rules above. Every amount field "
    "(total_cop, unit_price_cop, subtotal_cop, tax_cop, tip_cop…) is in CENTS as an integer: '$12.50' = 1250, "
    "'1,234.56' = 123456, '45' = 4500. Dates may be month/day/year when the receipt is from the United States."
)

SYSTEM_PROMPT = """You extract structured expense data for a Colombian shared-expenses app.

Input is one of: OCR text of a receipt photo, text of a PDF invoice, or a WhatsApp chat message.
Rules:
- Money is Colombian pesos (COP) without decimals. '.' separates thousands: '$84.300' = 84300,
  '1.014.500' = 1014500. Cents like ',00' or '.00' at the end are dropped.
- Slang in messages: '100 lucas' = 100000, '84 mil' = 84000, '1,2 palos' = 1200000, '50k' = 50000.
- total_cop is the final amount paid (TOTAL / TOTAL A PAGAR / VALOR TOTAL), never the cash given
  ('Efectivo', 'Recibido') nor the change ('Cambio'). If a DIAN QR total is given, use it.
- Dates in Colombia are day/month/year. Output YYYY-MM-DD. Relative words ('ayer', 'el sábado') are
  relative to the 'today' date given. If no date is stated, return null.
- merchant: the store trading name as printed, in title case, without NIT or legal suffixes
  (S.A.S., Ltda). For chat messages without a store, a short Spanish name of what was paid for.
- payer_name: only if the text says who paid ('la pagó Santi', 'Vale pagó', 'pagado por Laura').
  'pagué' means the sender paid: return null.
- items: every product line of a receipt or invoice, as printed, with quantity, unit price and line
  total. 'PAPA BACON' followed by '2 x 5.000,00 10.000,00' is name 'Papa bacon', quantity 2,
  unit_price_cop 5000, total_cop 10000. Line totals should add up to the subtotal. Use an empty list
  for chat messages and for payment or transfer vouchers that list no products.
- description_en: a short, normalized English description of what was bought (no amounts, no names
  of people). It is used to classify the expense, so name the kind of business and main items.
- is_expense: false only for messages that are clearly not about spending money.
- Never invent values. Unknown fields are null. Output JSON only."""


def _recorte(texto: str, limite: int) -> str:
    texto = texto.strip()
    if len(texto) <= limite:
        return texto
    # Los recibos largos tienen lo importante arriba (comercio) y abajo (total)
    mitad = limite // 2
    return texto[:mitad] + "\n[…]\n" + texto[-mitad:]


def build_user_prompt(
    *,
    kind: str,
    today: date,
    document_text: str | None = None,
    message_text: str | None = None,
    qr: DianQr | None = None,
    total_candidates: list[int] | None = None,
    message_amount: int | None = None,
    people: list[str] | None = None,
    max_chars: int = 6000,
) -> str:
    partes = [f"today: {today.isoformat()}", f"source: {kind}"]
    if con_centavos():
        partes.append(_CENTAVOS)
    if people:
        partes.append("people in this group: " + ", ".join(people))
    if qr and (qr.total or qr.issued_on):
        partes.append(
            "DIAN QR (reliable): "
            + ", ".join(
                x
                for x in (
                    f"total={qr.total}" if qr.total else "",
                    f"date={qr.issued_on.isoformat()}" if qr.issued_on else "",
                    f"nit={qr.nit}" if qr.nit else "",
                )
                if x
            )
        )
    if total_candidates:
        partes.append("amounts found on TOTAL lines: " + ", ".join(str(x) for x in total_candidates))
    if message_amount:
        partes.append(f"amount parsed from the message: {message_amount}")
    if message_text:
        partes.append(f"WhatsApp message:\n<<<\n{_recorte(message_text, 1000)}\n>>>")
    if document_text:
        partes.append(f"Document text:\n<<<\n{_recorte(document_text, max_chars)}\n>>>")
    return "\n\n".join(partes)
