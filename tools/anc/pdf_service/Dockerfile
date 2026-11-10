FROM python:3.12-slim
WORKDIR /opt/quote-pdf
COPY requirements.txt /opt/quote-pdf/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd -r -u 10001 quote_pdf && mkdir -p /var/lib/quote-pdf-private && touch /var/lib/quote-pdf-private/.keep && chown -R 10001:10001 /var/lib/quote-pdf-private
COPY --chown=10001:10001 render.py server.py /opt/quote-pdf/
USER 10001:10001
EXPOSE 8097
CMD ["python","server.py"]
