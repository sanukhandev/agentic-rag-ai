from __future__ import annotations

import csv
import hashlib
import ipaddress
import json
import re
import socket
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlparse

MAX_BYTES = 5 * 1024 * 1024
PARSER_VERSION = "python-ingestion-0.1.0"


@dataclass(frozen=True)
class Chunk:
    ordinal: int
    locator: str
    content: str
    content_hash: str


@dataclass(frozen=True)
class IngestedSource:
    title: str
    mime_type: str
    source_url: str | None
    normalized_content: str
    content_hash: str
    parser_version: str
    chunks: list[Chunk]


def normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def sanitize(text: str) -> str:
    text = re.sub(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[REDACTED_EMAIL]", text)
    text = re.sub(r"(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)", "[REDACTED_PHONE]", text)
    text = re.sub(r"(?i)(api[_ -]?key|secret|password|token)\s*[:=]\s*[^\s,;]+", r"\1=[REDACTED_SECRET]", text)
    return text


def chunk_text(text: str, max_chars: int = 800) -> list[Chunk]:
    paragraphs = [part.strip() for part in normalize(text).split("\n\n") if part.strip()]
    output: list[Chunk] = []
    current = ""
    for paragraph in paragraphs:
        if current and len(current) + len(paragraph) + 2 > max_chars:
            output.append(_chunk(current, len(output)))
            current = ""
        current = f"{current}\n\n{paragraph}".strip()
        if len(current) > max_chars:
            for start in range(0, len(current), max_chars):
                piece = current[start : start + max_chars].strip()
                if piece:
                    output.append(_chunk(piece, len(output)))
            current = ""
    if current:
        output.append(_chunk(current, len(output)))
    return output


def _chunk(content: str, ordinal: int) -> Chunk:
    return Chunk(ordinal=ordinal, locator=f"section {ordinal + 1}", content=content, content_hash=hashlib.sha256(content.encode()).hexdigest())


def _safe_path(path: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_file():
        raise ValueError("Input file does not exist.")
    if resolved.stat().st_size > MAX_BYTES:
        raise ValueError("Input exceeds the 5 MiB ingestion limit.")
    return resolved


def extract_file(path: Path) -> tuple[str, str]:
    path = _safe_path(path)
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md"}:
        return path.read_text(encoding="utf-8"), "text/markdown" if suffix == ".md" else "text/plain"
    if suffix == ".csv":
        with path.open(newline="", encoding="utf-8") as handle:
            return "\n".join(" | ".join(row) for row in csv.reader(handle)), "text/csv"
    if suffix == ".docx":
        from docx import Document

        document = Document(path)
        parts = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
        parts.extend(" | ".join(cell.text for cell in row.cells) for table in document.tables for row in table.rows)
        return "\n\n".join(parts), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if suffix == ".xlsx":
        from openpyxl import load_workbook

        workbook = load_workbook(path, read_only=True, data_only=True)
        try:
            values = []
            for sheet in workbook.worksheets:
                values.append(f"Sheet: {sheet.title}")
                values.extend(" | ".join("" if cell is None else str(cell) for cell in row) for row in sheet.iter_rows(values_only=True))
            return "\n".join(values), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        finally:
            workbook.close()
    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(path)
        pages = [f"Page {index}:\n{text}" for index, page in enumerate(reader.pages, start=1) if (text := page.extract_text() or "").strip()]
        if not pages:
            raise ValueError("PDF has no extractable text; OCR-only or empty PDFs are unsupported.")
        return "\n\n".join(pages), "application/pdf"
    raise ValueError(f"Unsupported file type: {suffix}")


def fetch_authorized_https(url: str, allowed_hosts: set[str]) -> tuple[str, str]:
    parsed = urlparse(url)
    hostname = parsed.hostname.lower() if parsed.hostname else ""
    allowed = {host.strip().lower() for host in allowed_hosts}
    if parsed.scheme != "https" or not hostname or hostname not in allowed or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Website ingestion requires an allowlisted HTTPS host.")
    try:
        addresses = {ipaddress.ip_address(info[4][0]) for info in socket.getaddrinfo(hostname, parsed.port or 443, type=socket.SOCK_STREAM)}
    except (OSError, ValueError) as error:
        raise ValueError("Website host could not be resolved safely.") from error
    if any(address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast or address.is_unspecified for address in addresses):
        raise ValueError("Private and local network targets are not allowed.")
    import requests
    from bs4 import BeautifulSoup

    response = requests.get(url, timeout=10, headers={"User-Agent": "agentic-rag-ingestion/0.1"}, allow_redirects=False, stream=True)
    response.raise_for_status()
    if 300 <= response.status_code < 400:
        raise ValueError("Redirects are not accepted for website ingestion; approve the final host explicitly.")
    chunks: list[bytes] = []
    size = 0
    for chunk in response.iter_content(chunk_size=64 * 1024):
        size += len(chunk)
        if size > MAX_BYTES:
            raise ValueError("Website response exceeds the 5 MiB ingestion limit.")
        chunks.append(chunk)
    soup = BeautifulSoup(b"".join(chunks).decode(response.encoding or "utf-8", errors="replace"), "html.parser")
    for element in soup(["script", "style", "noscript"]):
        element.decompose()
    return soup.get_text("\n"), "text/html"


def ingest_text(title: str, text: str, mime_type: str, source_url: str | None = None) -> IngestedSource:
    cleaned = sanitize(normalize(text))
    chunks = chunk_text(cleaned)
    return IngestedSource(title=title, mime_type=mime_type, source_url=source_url, normalized_content=cleaned, content_hash=hashlib.sha256(cleaned.encode()).hexdigest(), parser_version=PARSER_VERSION, chunks=chunks)


def ingest_file(path: Path) -> IngestedSource:
    text, mime_type = extract_file(path)
    return ingest_text(path.stem, text, mime_type)


def to_json(source: IngestedSource) -> str:
    return json.dumps(asdict(source), indent=2, sort_keys=True)
