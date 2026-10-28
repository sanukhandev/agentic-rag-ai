FROM python:3.12-slim
WORKDIR /opt/ancfz
COPY requirements.txt /opt/ancfz/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd -r -u 10001 ancfz && mkdir -p /var/lib/ancfz-private && chown 10001:10001 /var/lib/ancfz-private
COPY --chown=10001:10001 render.py server.py /opt/ancfz/
USER 10001:10001
EXPOSE 8097
CMD ["python","server.py"]
