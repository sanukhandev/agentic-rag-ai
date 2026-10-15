from __future__ import annotations

import argparse
import base64
from dataclasses import asdict
from pathlib import Path
from typing import Any

import requests

from .pipeline import IngestedSource, ingest_file, ingest_url
from .staging import LocalStaging


def result_payload(source: IngestedSource) -> dict[str, Any]:
    return {
        "normalizedContent": source.normalized_content,
        "contentHash": source.content_hash,
        "parserVersion": source.parser_version,
        "chunks": [asdict(chunk) for chunk in source.chunks],
    }


def claim_job(api_base: str, job_id: str, worker_secret: str, session: requests.Session | None = None) -> None:
    client = session or requests.Session()
    headers = {"x-ingestion-worker-secret": worker_secret}
    base = api_base.rstrip("/")
    claim = client.post(f"{base}/api/v1/internal/ingestion-jobs/{job_id}/claim", headers=headers, timeout=15)
    claim.raise_for_status()


def fetch_job_input(api_base: str, job_id: str, worker_secret: str, session: requests.Session | None = None) -> tuple[str, str, bytes]:
    client = session or requests.Session()
    response = client.get(f"{api_base.rstrip('/')}/api/v1/internal/ingestion-jobs/{job_id}/input", headers={"x-ingestion-worker-secret": worker_secret}, timeout=30)
    response.raise_for_status()
    body = response.json()
    if not isinstance(body, dict) or not isinstance(body.get("fileName"), str) or not isinstance(body.get("mimeType"), str) or not isinstance(body.get("contentBase64"), str):
        raise ValueError("The ingestion API returned an invalid file input.")
    try:
        content = base64.b64decode(body["contentBase64"], validate=True)
    except (ValueError, TypeError) as error:
        raise ValueError("The ingestion API returned malformed file content.") from error
    if not content or len(content) > 5 * 1024 * 1024:
        raise ValueError("The ingestion API returned an empty or oversized file.")
    return body["fileName"], body["mimeType"], content


def submit_result(api_base: str, job_id: str, worker_secret: str, source: IngestedSource, session: requests.Session | None = None, *, claim: bool = True) -> dict[str, Any]:
    client = session or requests.Session()
    headers = {"x-ingestion-worker-secret": worker_secret}
    base = api_base.rstrip("/")
    if claim:
        claim_job(base, job_id, worker_secret, client)
    result = client.post(f"{base}/api/v1/internal/ingestion-jobs/{job_id}/result", headers=headers, json=result_payload(source), timeout=30)
    result.raise_for_status()
    body = result.json()
    if not isinstance(body, dict):
        raise ValueError("The ingestion API returned an invalid result.")
    return body


def main() -> None:
    parser = argparse.ArgumentParser(description="Run safe source extraction and submit one ingestion job result.")
    source = parser.add_mutually_exclusive_group(required=False)
    source.add_argument("--path", type=Path)
    source.add_argument("--url")
    parser.add_argument("--title")
    parser.add_argument("--allowed-host", action="append", default=[])
    parser.add_argument("--staging-root", type=Path, help="Private local staging directory for file inputs.")
    parser.add_argument("--api-base", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--worker-secret", required=True)
    args = parser.parse_args()
    if not args.path and not args.url and not args.staging_root:
        parser.error("--staging-root is required when processing an uploaded API file")
    if args.url and (not args.title or not args.allowed_host):
        parser.error("--url requires --title and at least one --allowed-host")
    claim = True
    if args.path or args.url:
        claim_job(args.api_base, args.job_id, args.worker_secret)
        claim = False
    if args.url:
        ingested = ingest_url(args.title, args.url, set(args.allowed_host))
    elif args.path:
        staging_root = args.staging_root
        if staging_root:
            staging = LocalStaging(staging_root)
            staged = staging.stage(args.path)
            try:
                ingested = ingest_file(staged)
            finally:
                staging.purge(staged)
        else:
            ingested = ingest_file(args.path)
    else:
        claim_job(args.api_base, args.job_id, args.worker_secret)
        file_name, _mime_type, content = fetch_job_input(args.api_base, args.job_id, args.worker_secret)
        staging = LocalStaging(args.staging_root)
        staged = staging.stage_bytes(Path(file_name).suffix, content)
        try:
            ingested = ingest_file(staged)
        finally:
            staging.purge(staged)
        claim = False
    submit_result(args.api_base, args.job_id, args.worker_secret, ingested, claim=claim)


if __name__ == "__main__":
    main()
