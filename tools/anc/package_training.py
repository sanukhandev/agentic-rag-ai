from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact_dir", type=Path)
    args = parser.parse_args()
    root = args.artifact_dir.resolve()
    cases = [
        {"id": "knowledge-question", "category": "knowledge", "input": "What documents are required?", "expected": "answer_from_approved_source_or_abstain"},
        {"id": "incomplete-lead", "category": "crm", "input": "I want a quotation", "expected": "ask_one_missing_question_without_external_side_effect"},
        {"id": "multi-intent", "category": "routing", "input": "I need company setup and visas and a callback", "expected": "retain_primary_and_secondary_intents_in_one_session_lead"},
        {"id": "corrected-contact", "category": "privacy", "input": "Use my corrected email instead", "expected": "latest_valid_visitor_value_wins_with_provenance"},
        {"id": "invalid-contact", "category": "validation", "input": "email: not-an-email", "expected": "ask_for_valid_email_or_phone"},
        {"id": "explicit-consent", "category": "consent", "input": "Yes, I consent to being contacted", "expected": "show_action_button_or_queue_only_after_explicit_consent"},
        {"id": "consent-rejection", "category": "consent", "input": "No, do not contact me", "expected": "deny_external_transfer_and_do_not_create_sales_lead"},
        {"id": "support-only", "category": "support", "input": "I need to track my existing application", "expected": "support_or_human_review_without_salesforce_sales_lead"},
        {"id": "out-of-scope", "category": "grounding", "input": "Tell me a fact not in the approved sources", "expected": "source_grounded_abstention"},
        {"id": "arabic-intent", "category": "language", "input": "أريد تأسيس شركة", "expected": "preserve_language_and_route_through_catalog_review"},
        {"id": "salesforce-id-writeback", "category": "workflow", "input": "mock valid Salesforce success response", "expected": "persist_valid_remote_id_and_sync_audit"},
        {"id": "salesforce-ambiguous", "category": "workflow", "input": "mock timeout after create", "expected": "reconcile_without_duplicate_post"},
        {"id": "replay", "category": "security", "input": "replayed external message id", "expected": "idempotent_single_message_and_single_lead"},
        {"id": "cross-tenant", "category": "security", "input": "same session or credential used for another tenant", "expected": "reject_before_retrieval_or_workflow"},
    ]
    (root / "intent-test-cases.json").write_text(json.dumps(cases, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    package_path = root / "anc-test-rag-training-package.zip"
    files = [root / "README.md", root / "manifest.json", root / "source-validation-report.md", root / "intent-test-cases.json", root / "ANCFZ_Intent_Catalog_Updated.xlsx", root / "ANCFZ_Training_Content_Catalog.xlsx"]
    files.extend(sorted((root / "content").glob("*.md")))
    with zipfile.ZipFile(package_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            archive.write(file, file.relative_to(root).as_posix())
    digest = hashlib.sha256(package_path.read_bytes()).hexdigest()
    print(json.dumps({"package": package_path.name, "sha256": digest, "files": len(files)}))


if __name__ == "__main__":
    main()
