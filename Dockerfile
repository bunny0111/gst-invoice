# Render (and any Docker host) build: React bundle -> Django image with Pango for WeasyPrint PDFs.
FROM node:20-slim AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libfontconfig1 fonts-dejavu-core shared-mime-info \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY --from=web /app/frontend/dist frontend/dist
WORKDIR /app/backend
# collectstatic needs a key but never touches the database
RUN SECRET_KEY=build-only python manage.py collectstatic --noinput
EXPOSE 10000
CMD ["sh", "-c", "python manage.py migrate_schemas --noinput && python manage.py bootstrap_public && gunicorn config.wsgi --bind 0.0.0.0:${PORT:-10000} --workers 2 --timeout 90"]
