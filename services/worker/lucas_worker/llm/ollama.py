"""Cliente de Ollama con salida estructurada y validación Pydantic.

- `format` = esquema JSON de `ReceiptExtraction`: Ollama restringe la
  generación a ese esquema (llama.cpp lo vuelve gramática).
- Temperatura 0 y contexto fijo: misma entrada, misma salida.
- Si el JSON no valida, se le devuelve el error al modelo una vez.
- Sin conexión, timeout o sin el modelo → `LlmUnavailable` (reintentable).
"""

from __future__ import annotations

import json
import logging
from typing import Protocol

import httpx
from pydantic import ValidationError

from ..errors import LlmUnavailable
from .prompt import SYSTEM_PROMPT, build_user_prompt
from .schema import ReceiptExtraction, inline_schema

log = logging.getLogger(__name__)


class LlmError(Exception):
    """El modelo respondió, pero nada que sirva (JSON inválido dos veces)."""


class ReceiptLlm(Protocol):
    def extract(self, **prompt_parts: object) -> ReceiptExtraction: ...


class OllamaClient:
    def __init__(
        self,
        base_url: str,
        model: str,
        *,
        timeout: float = 300.0,
        num_ctx: int = 4096,
        keep_alive: str = "30m",
        client: httpx.Client | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.num_ctx = num_ctx
        self.keep_alive = keep_alive
        self.http = client or httpx.Client(timeout=httpx.Timeout(timeout, connect=10.0))
        self.schema = inline_schema(ReceiptExtraction)

    def _chat(self, messages: list[dict[str, str]]) -> str:
        payload = {
            "model": self.model,
            "messages": messages,
            "format": self.schema,
            "stream": False,
            "keep_alive": self.keep_alive,
            "options": {"temperature": 0, "seed": 7, "num_ctx": self.num_ctx, "num_predict": 1024},
        }
        try:
            r = self.http.post(f"{self.base_url}/api/chat", json=payload)
        except (httpx.TransportError, httpx.TimeoutException) as e:
            raise LlmUnavailable(f"Ollama no respondió: {type(e).__name__}") from e
        if r.status_code == 404:
            raise LlmUnavailable(f"Ollama no tiene el modelo {self.model} (ollama pull {self.model})")
        if r.status_code >= 400:
            raise LlmUnavailable(f"Ollama respondió {r.status_code}: {r.text[:200]}")
        try:
            return r.json()["message"]["content"]
        except (ValueError, KeyError, TypeError) as e:
            raise LlmUnavailable("Ollama devolvió una respuesta sin mensaje") from e

    def extract(self, **prompt_parts: object) -> ReceiptExtraction:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(**prompt_parts)},  # type: ignore[arg-type]
        ]
        content = self._chat(messages)
        try:
            return ReceiptExtraction.model_validate_json(content)
        except ValidationError as e:
            errores = json.dumps(e.errors(include_url=False, include_input=False), ensure_ascii=False)[:1500]
            log.info("El JSON del LLM no validó; se le pide corregirlo", extra={"detail": errores[:300]})
            messages += [
                {"role": "assistant", "content": content},
                {"role": "user", "content": f"That JSON failed validation: {errores}\nReturn the corrected JSON only."},
            ]
            content = self._chat(messages)
            try:
                return ReceiptExtraction.model_validate_json(content)
            except ValidationError as e2:
                raise LlmError(f"El LLM no devolvió un JSON válido: {e2.error_count()} errores") from e2

    def ping(self) -> str:
        """Para `lucas-worker check`: ¿está Ollama y tiene el modelo?"""
        try:
            r = self.http.get(f"{self.base_url}/api/tags", timeout=10)
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise LlmUnavailable(f"Ollama no responde en {self.base_url}: {e}") from e
        nombres = {m.get("name") for m in r.json().get("models", [])}
        if self.model not in nombres and f"{self.model}:latest" not in nombres:
            raise LlmUnavailable(f"Ollama no tiene {self.model}. Tiene: {', '.join(sorted(n for n in nombres if n))}")
        return self.model
