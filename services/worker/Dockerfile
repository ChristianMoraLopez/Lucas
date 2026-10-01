# syntax=docker/dockerfile:1.7
# ============================================================================
# Lucas worker · imagen para linux/arm64 (Oracle Cloud Ampere A1) y linux/amd64
#
#   Oracle (ARM, nativo):  docker compose up -d --build
#   Desde un PC x86:       docker buildx build --platform linux/arm64 -t lucas-worker .
#
# Sin GPU: OCR (RapidOCR) y Laya corren en ONNX Runtime, Qwen en Ollama.
# ============================================================================

ARG PYTHON_VERSION=3.12

# ---------------------------------------------------------------------------
# 1. Dependencias con uv (lockfile universal: trae las ruedas de aarch64)
# ---------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm AS build

RUN pip install --no-cache-dir "uv>=0.8,<1"
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

# Compilador por si alguna dependencia no publica rueda para la arquitectura
# (hoy todas la tienen; solo vive en esta etapa, no en la imagen final)
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY lucas_worker ./lucas_worker
COPY scripts ./scripts
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

# ---------------------------------------------------------------------------
# 2. Imagen final: solo el entorno y el código
# ---------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm

LABEL org.opencontainers.image.title="lucas-worker" \
      org.opencontainers.image.description="Recibos, PDFs y mensajes → gastos (OCR, QR DIAN, Ollama, Laya)"

# libgomp: OpenMP de onnxruntime y OpenCV en aarch64
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 lucas \
 && mkdir -p /models && chown lucas:lucas /models

COPY --from=build --chown=lucas:lucas /app /app
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LAYA_CACHE_DIR=/models/laya \
    HF_HOME=/models/hf \
    HEARTBEAT_FILE=/tmp/lucas-worker-heartbeat

USER lucas
# Carga los modelos de OCR una vez: si una rueda no sirve en esta arquitectura, el build falla aquí
RUN python -m lucas_worker warmup --ocr-only

HEALTHCHECK --interval=60s --timeout=10s --start-period=180s --retries=3 \
  CMD ["python", "-m", "lucas_worker", "health", "--max-age", "900"]

CMD ["python", "-m", "lucas_worker", "run"]
