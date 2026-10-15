from __future__ import annotations

import argparse
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


def submit_result(api_base: str, job_id: str, worker_secret: str, source: IngestedSource, session: requests.Session | None = None) -> dict[str, Any]:
    client = session or requests.Session()
    headers = {"x-ingestion-worker-secret": worker_secret}
    base = api_base.rstrip("/")
    claim = client.post(f"{base}/api/v1/internal/ingestion-jobs/{job_id}/claim", headers=headers, timeout=15)
    claim.raise_for_status()
    result = client.post(f"{base}/api/v1/internal/ingestion-jobs/{job_id}/result", headers=headers, json=result_payload(source), timeout=30)
    result.raise_for_status()
    body = result.json()
    if not isinstance(body, dict):
        raise ValueError("The ingestion API returned an invalid result.")
    return body


def main() -> None:
    parser = argparse.ArgumentParser(description="Run safe source extraction and submit one ingestion job result.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--path", type=Path)
    source.add_argument("--url")
    parser.add_argument("--title")
    parser.add_argument("--allowed-host", action="append", default=[])
    parser.add_argument("--staging-root", type=Path, help="Private local staging directory for file inputs.")
    parser.add_argument("--api-base", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--worker-secret", required=True)
    args = parser.parse_args()
    if args.url:
        if not args.title or not args.allowed_host:
            parser.error("--url requires --title and at least one --allowed-host")
        ingested = ingest_url(args.title, args.url, set(args.allowed_host))
    else:
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
    submit_result(args.api_base, args.job_id, args.worker_secret, ingested)


if __name__ == "__main__":
    main()
