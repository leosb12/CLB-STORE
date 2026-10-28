# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN --mount=type=cache,id=clb_pip,target=/root/.cache/pip pip install -r requirements.txt
COPY fuente ./fuente
# /modelos guarda faster-whisper en el volumen clb_modelos_ia (se descarga una vez; luego funciona sin Internet).
RUN useradd --uid 10001 --create-home clb && mkdir -p /modelos && chown clb /modelos
USER clb
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=8s --start-period=40s --retries=10 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/salud', timeout=6)"
CMD ["uvicorn", "--factory", "fuente.infraestructura.arranque:app_desde_entorno", "--host", "0.0.0.0", "--port", "8000"]
