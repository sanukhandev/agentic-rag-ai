FROM python:3.12-slim
WORKDIR /opt/ancfz
RUN useradd -r -u 10001 ancfz && mkdir -p /var/lib/mockpay && chown 10001:10001 /var/lib/mockpay
COPY --chown=10001:10001 server.py /opt/ancfz/
USER 10001:10001
EXPOSE 8098
CMD ["python","server.py"]
