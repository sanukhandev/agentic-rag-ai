"""Create reviewable, redacted RAG artifacts from the owner-supplied source ZIP."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ingestion"))
from ingestion.pipeline import chunk_text, extract_file, sanitize


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_zip", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--tenant-scope", required=True)
    args = parser.parse_args()
    output_dir = args.output_dir.resolve()
    content_dir = output_dir / "content"
    content_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, object]] = []
    source_hash = hashlib.sha256(args.source_zip.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix="anc-source-") as temp_name:
        temp_dir = Path(temp_name)
        with zipfile.ZipFile(args.source_zip) as archive:
            for entry in archive.infolist():
                if entry.is_dir():
                    continue
                source_name = Path(entry.filename).name
                if source_name.casefold() != entry.filename.casefold() or not source_name.endswith(".docx"):
                    raise ValueError(f"Unexpected source entry: {entry.filename}")
                source_path = temp_dir / source_name
                source_path.write_bytes(archive.read(entry))
                raw_text, mime_type = extract_file(source_path)
                redacted = sanitize(raw_text).strip()
                chunks = chunk_text(redacted)
                key = f"{args.tenant_scope}-source-{slug(source_name.removesuffix('.docx'))}"
                markdown_name = f"{slug(source_name.removesuffix('.docx'))}.md"
                (content_dir / markdown_name).write_text(
                    "---\n"
                    f"tenantScope: {args.tenant_scope}\nsourceKey: {key}\nsourceFile: {source_name}\n"
                    f"sourceSha256: {hashlib.sha256(source_path.read_bytes()).hexdigest()}\n"
                    "visibility: public-for-chat\npiiScreening: pattern-redacted-human-review-required\n---\n\n"
                    + redacted + "\n",
                    encoding="utf-8",
                )
                rows.append({
                    "tenantScope": args.tenant_scope,
                    "sourceKey": key,
                    "title": source_name.removesuffix(".docx").replace("_", " "),
                    "sourceFile": source_name,
                    "mimeType": mime_type,
                    "sourceSha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
                    "artifactPath": f"content/{markdown_name}",
                    "chunkCount": len(chunks),
                    "visibility": "public-for-chat",
                    "status": "awaiting_review",
                    "piiScreening": "pattern-redacted-human-review-required",
                })
    rows.sort(key=lambda row: str(row["sourceFile"]))
    manifest = {"schemaVersion": "rag-training-v1", "tenantScope": args.tenant_scope, "sourceZipSha256": source_hash, "sources": rows}
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output_dir / "README.md").write_text(
        f"# {args.tenant_scope} RAG training package\n\n"
        "Generated from the supplied source ZIP. Content is pattern-redacted and remains awaiting human review; "
        "this package does not publish sources or change tenant data.\n\n"
        f"Source ZIP SHA-256: `{source_hash}`\n",
        encoding="utf-8",
    )
    (output_dir / "source-validation-report.md").write_text(
        f"# Source validation report\n\n- Tenant scope: `{args.tenant_scope}`\n- Source ZIP SHA-256: `{source_hash}`\n"
        f"- Source files: {len(rows)} DOCX files\n- ZIP path checks: passed by the ingestion extractor\n"
        "- Office container checks: passed by the ingestion extractor\n"
        "- Formula/macro checks: not applicable to DOCX inputs\n"
        "- PII handling: pattern redaction applied; human review is still required before publication\n"
        "- Publication: not performed\n",
        encoding="utf-8",
    )
    (output_dir / "content-catalog.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"tenantScope": args.tenant_scope, "sourceZipSha256": source_hash, "sources": len(rows), "chunks": sum(int(row["chunkCount"]) for row in rows)}))


if __name__ == "__main__":
    main()
