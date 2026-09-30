"""Errores que deciden si un trabajo se reintenta o no."""


class PermanentError(Exception):
    """Reintentar no sirve: el archivo no existe, el PDF tiene clave, la imagen está dañada."""


class RetryableError(Exception):
    """Algo externo falló (red, Supabase, Ollama): se intenta otra vez más tarde."""


class LlmUnavailable(RetryableError):
    """Ollama no respondió o no tiene el modelo."""
