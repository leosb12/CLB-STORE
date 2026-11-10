# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN --mount=type=cache,id=clb_pip,target=/root/.cache/pip pip install -r requirements.txt
COPY fuente ./fuente
RUN useradd --uid 10002 --create-home clb
USER clb
EXPOSE 8050
# Un proceso con hilos: las sesiones (tokens) viven en memoria del proceso. Ver fuente/adaptadores/sso.py.
CMD ["gunicorn", "--bind", "0.0.0.0:8050", "--workers", "1", "--threads", "8", "--timeout", "150", "--access-logfile", "-", "fuente.presentacion.app:servidor_wsgi()"]
