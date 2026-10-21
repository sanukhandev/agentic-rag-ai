from __future__ import annotations

import argparse
import base64
import os
import threading
import time
from pathlib import Path
from typing import Any

import requests

from .intent_catalog import parse_intent_catalog
from .pipeline import MAX_BYTES, IngestedSource, ingest_file, ingest_url
from .document_ocr import document_summary, extract_document_text
from .staging import LocalStaging


def raise_for_api_status(response: requests.Response) -> None:
    try:
        response.raise_for_status()
    except requests.HTTPError as error:
        try:
            body = response.json()
            error_body = body.get("error") if isinstance(body, dict) else None
            code = error_body.get("code") if isinstance(error_body, dict) else None
            message = error_body.get("message") if isinstance(error_body, dict) else None
        except (ValueError, TypeError):
            code = None
        if isinstance(code, str) and code:
            detail = f": {message[:200]}" if isinstance(message, str) and message else ""
            raise requests.HTTPError(f"{error}: {code}{detail}", response=response) from error
        raise


def result_payload(source: IngestedSource) -> dict[str, Any]:
    return {
        "normalizedContent": source.normalized_content,
        "contentHash": source.content_hash,
        "parserVersion": source.parser_version,
        "chunks": [{"ordinal": chunk.ordinal, "locator": chunk.locator, "content": chunk.content, "contentHash": chunk.content_hash} for chunk in source.chunks],
    }


def claim_job(api_base: str, job_id: str, worker_secret: str, session: requests.Session | None = None) -> None:
    client = session or requests.Session()
    headers = {"x-ingestion-worker-secret": worker_secret}
    base = api_base.rstrip("/")
    claim = client.post(f"{base}/api/v1/internal/ingestion-jobs/{job_id}/claim", headers=headers, timeout=15)
    raise_for_api_status(claim)


def claim_next_job(api_base: str, worker_secret: str, session: requests.Session | None = None) -> str | None:
    client = session or requests.Session()
    response = client.post(f"{api_base.rstrip('/')}/api/v1/internal/ingestion-jobs/claim-next", headers={"x-ingestion-worker-secret": worker_secret}, timeout=15)
    raise_for_api_status(response)
    body = response.json()
    job = body.get("job") if isinstance(body, dict) else None
    if job is None:
        return None
    if not isinstance(job, dict) or not isinstance(job.get("id"), str) or not job["id"]:
        raise ValueError("The ingestion API returned an invalid claimed job.")
    return job["id"]


def fetch_job_input(api_base: str, job_id: str, worker_secret: str, session: requests.Session | None = None) -> tuple[str, str, bytes]:
    client = session or requests.Session()
    response = client.get(f"{api_base.rstrip('/')}/api/v1/internal/ingestion-jobs/{job_id}/input", headers={"x-ingestion-worker-secret": worker_secret}, timeout=30)
    raise_for_api_status(response)
    body = response.json()
    if not isinstance(body, dict) or not isinstance(body.get("fileName"), str) or not isinstance(body.get("mimeType"), str) or not isinstance(body.get("contentBase64"), str):
        raise ValueError("The ingestion API returned an invalid file input.")
    try:
        content = base64.b64decode(body["contentBase64"], validate=True)
    except (ValueError, TypeError) as error:
        raise ValueError("The ingestion API returned malformed file content.") from error
    if not content or len(content) > MAX_BYTES:
        raise ValueError("The ingestion API returned an empty or oversized file.")
    return body["fileName"], body["mimeType"], content


def submit_result(api_base: str, job_id: str, worker_secret: str, source: IngestedSource, session: requests.Session | None = None, *, claim: bool = True) -> dict[str, Any]:
    client = session or requests.Session()
    headers = {"x-ingestion-worker-secret": worker_secret}
    base = api_base.rstrip("/")
    if claim:
        claim_job(base, job_id, worker_secret, client)
    result = client.post(f"{base}/api/v1/internal/ingestion-jobs/{job_id}/result", headers=headers, json=result_payload(source), timeout=30)
    raise_for_api_status(result)
    body = result.json()
    if not isinstance(body, dict):
        raise ValueError("The ingestion API returned an invalid result.")
    return body


def submit_catalog_result(api_base: str, job_id: str, worker_secret: str, result: dict[str, Any], session: requests.Session | None = None) -> dict[str, Any]:
    client = session or requests.Session()
    response = client.post(f"{api_base.rstrip('/')}/api/v1/internal/ingestion-jobs/{job_id}/result", headers={"x-ingestion-worker-secret": worker_secret}, json=result, timeout=30)
    raise_for_api_status(response)
    body = response.json()
    if not isinstance(body, dict):
        raise ValueError("The ingestion API returned an invalid catalog result.")
    return body


def submit_failure(api_base: str, job_id: str, worker_secret: str, error_code: str = "INGESTION_FAILED", session: requests.Session | None = None) -> dict[str, Any]:
    client = session or requests.Session()
    response = client.post(
        f"{api_base.rstrip('/')}/api/v1/internal/ingestion-jobs/{job_id}/failure",
        headers={"x-ingestion-worker-secret": worker_secret},
        json={"errorCode": error_code},
        timeout=15,
    )
    raise_for_api_status(response)
    body = response.json()
    if not isinstance(body, dict):
        raise ValueError("The ingestion API returned an invalid failure result.")
    return body


def claim_next_document_job(api_base: str, worker_secret: str, session: requests.Session | None = None) -> dict[str, Any] | None:
    client = session or requests.Session()
    response = client.post(f"{api_base.rstrip('/')}/api/v1/internal/document-jobs/claim-next", headers={"x-ingestion-worker-secret": worker_secret}, timeout=15)
    raise_for_api_status(response)
    body = response.json()
    job = body.get("job") if isinstance(body, dict) else None
    return job if isinstance(job, dict) else None


def renew_document_job(api_base: str, job_id: str, tenant_id: str, worker_secret: str, lease_ms: int = 120_000, session: requests.Session | None = None) -> dict[str, Any]:
    client = session or requests.Session()
    response = client.post(f"{api_base.rstrip('/')}/api/v1/internal/document-jobs/{job_id}/renew", headers={"x-ingestion-worker-secret": worker_secret}, json={"tenantId": tenant_id, "jobId": job_id, "leaseMs": lease_ms}, timeout=15)
    raise_for_api_status(response)
    body = response.json()
    if not isinstance(body, dict) or not isinstance(body.get("job"), dict):
        raise ValueError("The document API returned an invalid renewal result.")
    return body["job"]


def fetch_document_input(api_base: str, job_id: str, tenant_id: str, worker_secret: str, session: requests.Session | None = None) -> tuple[str, str, bytes]:
    client = session or requests.Session()
    response = client.get(f"{api_base.rstrip('/')}/api/v1/internal/document-jobs/{job_id}/input", headers={"x-ingestion-worker-secret": worker_secret, "x-tenant-id": tenant_id}, timeout=30)
    raise_for_api_status(response)
    body = response.json()
    if not isinstance(body, dict) or not isinstance(body.get("fileName"), str) or not isinstance(body.get("mimeType"), str) or not isinstance(body.get("contentBase64"), str):
        raise ValueError("The document API returned malformed file content.")
    try:
        content = base64.b64decode(body["contentBase64"], validate=True)
    except (ValueError, TypeError) as error:
        raise ValueError("The document API returned malformed file content.") from error
    if not content or len(content) > 15 * 1024 * 1024:
        raise ValueError("The document API returned an empty or oversized file.")
    return body["fileName"], body["mimeType"], content


def submit_document_result(api_base: str, job_id: str, tenant_id: str, worker_secret: str, extracted_text: str, summary: str, session: requests.Session | None = None) -> dict[str, Any]:
    client = session or requests.Session()
    response = client.post(f"{api_base.rstrip('/')}/api/v1/internal/document-jobs/{job_id}/result", headers={"x-ingestion-worker-secret": worker_secret}, json={"tenantId": tenant_id, "jobId": job_id, "extractedText": extracted_text, "summary": summary, "executionReference": f"ocr-{job_id}"}, timeout=30)
    raise_for_api_status(response)
    body = response.json()
    if not isinstance(body, dict):
        raise ValueError("The document API returned an invalid result.")
    return body


def submit_document_failure(api_base: str, job_id: str, tenant_id: str, worker_secret: str, error_code: str = "DOCUMENT_OCR_FAILED", session: requests.Session | None = None) -> dict[str, Any]:
    client = session or requests.Session()
    response = client.post(f"{api_base.rstrip('/')}/api/v1/internal/document-jobs/{job_id}/failure", headers={"x-ingestion-worker-secret": worker_secret}, json={"tenantId": tenant_id, "jobId": job_id, "errorCode": error_code}, timeout=15)
    raise_for_api_status(response)
    body = response.json()
    if not isinstance(body, dict):
        raise ValueError("The document API returned an invalid failure result.")
    return body


def process_document_job(api_base: str, job: dict[str, Any], worker_secret: str, session: requests.Session | None = None) -> dict[str, Any]:
    client = session or requests.Session()
    job_id = str(job["id"])
    tenant_id = str(job.get("tenant_id") or job.get("tenantId"))
    stop_heartbeat = threading.Event()

    def heartbeat() -> None:
        while not stop_heartbeat.wait(20):
            try:
                renew_document_job(api_base, job_id, tenant_id, worker_secret)
            except requests.RequestException:
                pass

    heartbeat_thread = threading.Thread(target=heartbeat, name=f"document-lease-{job_id}", daemon=True)
    heartbeat_thread.start()
    try:
        file_name, mime_type, content = fetch_document_input(api_base, job_id, tenant_id, worker_secret, client)
        text = extract_document_text(file_name, mime_type, content)
        return submit_document_result(api_base, job_id, tenant_id, worker_secret, text, document_summary(text, file_name), client)
    except Exception:
        submit_document_failure(api_base, job_id, tenant_id, worker_secret, session=client)
        raise
    finally:
        stop_heartbeat.set()
        heartbeat_thread.join(timeout=5)


def process_job(
    api_base: str,
    job_id: str,
    worker_secret: str,
    *,
    path: Path | None = None,
    url: str | None = None,
    title: str | None = None,
    allowed_hosts: set[str] | None = None,
    staging_root: Path | None = None,
    session: requests.Session | None = None,
    already_claimed: bool = False,
) -> dict[str, Any]:
    client = session or requests.Session()
    claimed = already_claimed
    try:
        if not claimed:
            claim_job(api_base, job_id, worker_secret, client)
            claimed = True
        if url:
            ingested = ingest_url(title or "", url, allowed_hosts or set())
        elif path:
            staging = LocalStaging(staging_root) if staging_root else None
            staged = staging.stage(path) if staging else None
            try:
                ingested = ingest_file(staged or path)
            finally:
                if staging and staged:
                    staging.purge(staged)
        else:
            if not staging_root:
                raise ValueError("A staging root is required for uploaded jobs.")
            file_name, mime_type, content = fetch_job_input(api_base, job_id, worker_secret, client)
            staging = LocalStaging(staging_root)
            staged = staging.stage_bytes(Path(file_name).suffix, content)
            try:
                if mime_type == "application/vnd.agentic.intent-catalog+excel":
                    return submit_catalog_result(api_base, job_id, worker_secret, parse_intent_catalog(staged), client)
                ingested = ingest_file(staged)
            finally:
                staging.purge(staged)
        return submit_result(api_base, job_id, worker_secret, ingested, client, claim=False)
    except Exception:
        if claimed:
            try:
                submit_failure(api_base, job_id, worker_secret, session=client)
            except Exception:
                pass
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Run safe source extraction and submit one ingestion job result.")
    source = parser.add_mutually_exclusive_group(required=False)
    source.add_argument("--path", type=Path)
    source.add_argument("--url")
    parser.add_argument("--title")
    parser.add_argument("--allowed-host", action="append", default=[])
    parser.add_argument("--staging-root", type=Path, help="Private local staging directory for file inputs.")
    parser.add_argument("--api-base", default=os.environ.get("INGESTION_API_BASE", "http://api:4000"))
    parser.add_argument("--job-id")
    parser.add_argument("--worker-secret", default=os.environ.get("INGESTION_WORKER_SECRET"))
    parser.add_argument("--poll-interval-seconds", type=float, default=float(os.environ.get("INGESTION_POLL_INTERVAL_SECONDS", "5")))
    args = parser.parse_args()
    if not args.worker_secret:
        parser.error("--worker-secret or INGESTION_WORKER_SECRET is required")
    if args.poll_interval_seconds <= 0:
        parser.error("--poll-interval-seconds must be greater than zero")
    if args.url and (not args.title or not args.allowed_host):
        parser.error("--url requires --title and at least one --allowed-host")
    if args.job_id:
        if not args.path and not args.url and not args.staging_root:
            parser.error("--staging-root is required when processing an uploaded API file")
        process_job(args.api_base, args.job_id, args.worker_secret, path=args.path, url=args.url, title=args.title, allowed_hosts=set(args.allowed_host), staging_root=args.staging_root)
        return
    if args.path or args.url:
        parser.error("--path and --url require --job-id")
    if not args.staging_root:
        parser.error("--staging-root is required in polling mode")
    with requests.Session() as session:
        while True:
            try:
                document_job = claim_next_document_job(args.api_base, args.worker_secret, session)
                if document_job:
                    process_document_job(args.api_base, document_job, args.worker_secret, session)
                else:
                    job_id = claim_next_job(args.api_base, args.worker_secret, session)
                    if job_id:
                        process_job(args.api_base, job_id, args.worker_secret, staging_root=args.staging_root, session=session, already_claimed=True)
                    else:
                        time.sleep(args.poll_interval_seconds)
            except KeyboardInterrupt:
                return
            except Exception as error:
                print(f"ingestion worker: {type(error).__name__}: {error}", flush=True)
                time.sleep(args.poll_interval_seconds)


if __name__ == "__main__":
    main()
