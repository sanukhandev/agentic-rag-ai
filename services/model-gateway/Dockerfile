FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY services/model-gateway/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd -r -u 10001 appuser
COPY services/model-gateway/gateway ./gateway
USER appuser
EXPOSE 8088
CMD ["uvicorn", "gateway.app:app", "--host", "0.0.0.0", "--port", "8088", "--workers", "1"]
