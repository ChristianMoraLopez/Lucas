"""El JSON que el LLM tiene que devolver.

El esquema se le pasa a Ollama en `format` (salida estructurada: el modelo no
puede escribir otra cosa) y la respuesta se valida con el mismo modelo de
Pydantic. Las reglas finas (recortes, fechas válidas, montos no negativos) van
en validadores y no en el esquema, para que la gramática de Ollama sea simple.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..extract.numbers import parse_number


def _texto(v: Any, largo: int) -> str | None:
    if v is None:
        return None
    s = " ".join(str(v).split())
    return s[:largo] or None


def _pesos(v: Any) -> int | None:
    """Acepta 11300, 11300.0 o «11.300» y devuelve pesos enteros, nunca negativos."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, int | float):
        return max(0, round(v))
    n = parse_number(str(v))
    return n if n is None else max(0, n)


class ReceiptItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(description="Item as printed, e.g. 'Pandebono'")
    quantity: float | None = Field(default=1, description="Units bought (1 if not printed)")
    unit_price_cop: int | None = Field(default=None, description="Unit price in whole Colombian pesos")
    total_cop: int | None = Field(default=None, description="Line total in whole Colombian pesos")

    @field_validator("name", mode="before")
    @classmethod
    def _nombre(cls, v: Any) -> str:
        return _texto(v, 80) or "?"

    @field_validator("quantity", mode="before")
    @classmethod
    def _cantidad(cls, v: Any) -> float:
        try:
            q = float(str(v).replace(",", ".")) if v is not None else 1.0
        except ValueError:
            return 1.0
        return q if 0 < q < 10_000 else 1.0

    @field_validator("unit_price_cop", "total_cop", mode="before")
    @classmethod
    def _plata(cls, v: Any) -> int | None:
        return _pesos(v)


class ReceiptExtraction(BaseModel):
    """Lo que Qwen lee de un recibo, factura o mensaje."""

    model_config = ConfigDict(extra="ignore")

    is_expense: bool = Field(
        description="False only if the message is clearly not about money spent (greetings, jokes)"
    )
    merchant: str | None = Field(
        description="Business trading name as printed (e.g. 'Panadería La Espiga'), or a short name of what was paid "
        "for if it is a chat message (e.g. 'Taxis al aeropuerto'). Null if unknown."
    )
    merchant_nit: str | None = Field(default=None, description="Seller NIT digits if printed, else null")
    date: str | None = Field(description="Purchase date as YYYY-MM-DD, null if not stated")
    total_cop: int | None = Field(
        description="Final amount paid in whole Colombian pesos (TOTAL A PAGAR), null if unknown"
    )
    subtotal_cop: int | None = Field(default=None, description="Subtotal before taxes if printed")
    tax_cop: int | None = Field(default=None, description="IVA / INC taxes if printed")
    tip_cop: int | None = Field(default=None, description="Tip / propina if printed")
    items: list[ReceiptItem] = Field(default_factory=list, description="Purchased items, at most 30")
    payer_name: str | None = Field(
        default=None, description="Name of the person the message says paid ('la pagó Santi' -> 'Santi'), else null"
    )
    description_en: str = Field(
        description="Short normalized English description of the purchase, 3-12 words, no amounts, "
        "e.g. 'Bakery breakfast: pandebono, coffee and bread' or 'Airport taxi rides'"
    )

    @field_validator("merchant", "payer_name", mode="before")
    @classmethod
    def _cortos(cls, v: Any) -> str | None:
        return _texto(v, 80)

    @field_validator("merchant_nit", mode="before")
    @classmethod
    def _nit(cls, v: Any) -> str | None:
        # Sin dígito de verificación: «900.123.456-7» → 900123456 (como viene en el QR)
        digitos = "".join(c for c in str(v or "").split("-")[0] if c.isdigit())
        return digitos[:15] or None

    @field_validator("description_en", mode="before")
    @classmethod
    def _descripcion(cls, v: Any) -> str:
        return _texto(v, 160) or ""

    @field_validator("total_cop", "subtotal_cop", "tax_cop", "tip_cop", mode="before")
    @classmethod
    def _plata(cls, v: Any) -> int | None:
        return _pesos(v)

    @field_validator("items", mode="before")
    @classmethod
    def _items(cls, v: Any) -> list[Any]:
        return list(v or [])[:30]

    @field_validator("date", mode="before")
    @classmethod
    def _fecha(cls, v: Any) -> str | None:
        if not v:
            return None
        try:
            return date.fromisoformat(str(v).strip()[:10]).isoformat()
        except ValueError:
            return None

    @property
    def parsed_date(self) -> date | None:
        return date.fromisoformat(self.date) if self.date else None


def inline_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Esquema JSON sin $ref/$defs (la gramática de Ollama es más predecible así)."""
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def resolver(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                return resolver(defs[node["$ref"].split("/")[-1]])
            return {k: resolver(v) for k, v in node.items() if k != "title"}
        if isinstance(node, list):
            return [resolver(x) for x in node]
        return node

    return resolver(schema)
