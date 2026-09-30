"""Cliente mínimo de Supabase: RPC de PostgREST y descarga de Storage.

Solo lo que el worker usa, con httpx y reintentos cortos. La llave es la
secret / service role key: `apikey` siempre; `Authorization: Bearer` solo si
es un JWT (las llaves nuevas `sb_secret_…` no lo son y el gateway las toma del
`apikey`).
"""

from __future__ import annotations

import logging
import time
from typing import Any, Protocol
from urllib.parse import quote

import httpx

from .errors import PermanentError, RetryableError

log = logging.getLogger(__name__)


class SupabaseError(RetryableError):
    def __init__(self, message: str, status: int | None = None, retryable: bool = True):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


class Database(Protocol):
    """Lo que el resto del worker necesita de Supabase (las pruebas lo simulan)."""

    def rpc(self, fn: str, params: dict[str, Any] | None = None) -> Any: ...

    def download(self, bucket: str, path: str) -> bytes: ...


class Supabase:
    def __init__(self, url: str, key: str, *, timeout: float = 30.0, client: httpx.Client | None = None):
        self.url = url.rstrip("/")
        headers = {"apikey": key}
        if key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {key}"
        self.http = client or httpx.Client(timeout=timeout, headers=headers)
        if client is not None:
            self.http.headers.update(headers)

    def _request(self, method: str, url: str, *, attempts: int = 3, **kwargs: Any) -> httpx.Response:
        last: Exception | None = None
        for intento in range(1, attempts + 1):
            try:
                r = self.http.request(method, url, **kwargs)
            except (httpx.TransportError, httpx.TimeoutException) as e:
                last = e
            else:
                if r.status_code < 500 and r.status_code not in (408, 429):
                    return r
                last = SupabaseError(f"Supabase respondió {r.status_code}", r.status_code)
            if intento < attempts:
                time.sleep(0.5 * 2 ** (intento - 1))
        raise SupabaseError(f"No pudimos hablar con Supabase: {last}") from last

    def rpc(self, fn: str, params: dict[str, Any] | None = None) -> Any:
        r = self._request("POST", f"{self.url}/rest/v1/rpc/{fn}", json=params or {})
        if r.status_code >= 400:
            try:
                body = r.json()
                detail = body.get("message") or body
            except ValueError:
                detail = r.text[:300]
            raise SupabaseError(f"{fn}: {detail}", r.status_code, retryable=False)
        if not r.content:
            return None
        return r.json()

    def download(self, bucket: str, path: str) -> bytes:
        safe = "/".join(quote(part, safe="") for part in path.split("/"))
        r = self._request("GET", f"{self.url}/storage/v1/object/{quote(bucket, safe='')}/{safe}")
        if r.status_code in (400, 404):
            raise PermanentError(f"No encontramos el archivo en Storage ({r.status_code})")
        if r.status_code >= 400:
            raise SupabaseError(f"Storage respondió {r.status_code}", r.status_code)
        return r.content
