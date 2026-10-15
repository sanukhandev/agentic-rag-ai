import tempfile
import unittest
import zipfile
from unittest.mock import Mock, patch
from pathlib import Path

from ingestion.pipeline import chunk_text, extract_file, fetch_authorized_https, ingest_file, ingest_text, ingest_url, sanitize
from ingestion.staging import LocalStaging
from ingestion.worker import fetch_job_input, result_payload, submit_result


class IngestionTests(unittest.TestCase):
    def test_masks_pii_and_secrets_before_chunking(self) -> None:
        result = sanitize("Email alice@example.com, call +971 50 123 4567, api_key=secret-value")
        self.assertNotIn("alice@example.com", result)
        self.assertNotIn("secret-value", result)
        self.assertIn("[REDACTED_EMAIL]", result)

    def test_supported_text_file_is_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "faq.txt"
            path.write_text("Pricing is published.\n\nSupport is available.", encoding="utf-8")
            first = ingest_file(path)
            second = ingest_file(path)
            self.assertEqual(first.content_hash, second.content_hash)
            self.assertEqual(first.normalized_content, "Pricing is published.\n\nSupport is available.")
            self.assertEqual(first.chunks, second.chunks)

    def test_chunk_bound_is_enforced(self) -> None:
        self.assertTrue(all(len(chunk.content) <= 20 for chunk in chunk_text("one two three four five six", max_chars=20)))

    def test_unsupported_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "file.exe"
            path.write_bytes(b"not allowed")
            with self.assertRaises(ValueError):
                ingest_file(path)

    def test_private_staging_copies_and_purges_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.txt"
            root = Path(directory) / "private-staging"
            source.write_text("Private source", encoding="utf-8")
            staging = LocalStaging(root)
            staged = staging.stage(source)
            self.assertEqual(staged.parent, root.resolve())
            self.assertEqual(staged.read_text(encoding="utf-8"), "Private source")
            staging.purge(staged)
            self.assertFalse(staged.exists())
            staged_bytes = staging.stage_bytes(".txt", b"private bytes")
            self.assertEqual(staged_bytes.read_bytes(), b"private bytes")
            staging.purge(staged_bytes)

    def test_legacy_office_formats_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            for suffix in (".doc", ".xls"):
                path = Path(directory) / f"legacy{suffix}"
                path.write_bytes(b"not supported")
                with self.assertRaisesRegex(ValueError, "Unsupported file type"):
                    ingest_file(path)

    def test_docx_and_xlsx_preserve_structured_values(self) -> None:
        from docx import Document
        from openpyxl import Workbook

        with tempfile.TemporaryDirectory() as directory:
            docx_path = Path(directory) / "guide.docx"
            document = Document()
            document.add_heading("Pricing", level=1)
            document.add_table(rows=1, cols=2).rows[0].cells[0].text = "Plan"
            document.tables[0].rows[0].cells[1].text = "100 credits"
            document.save(docx_path)
            docx_text, _ = extract_file(docx_path)
            self.assertIn("Pricing", docx_text)
            self.assertIn("100 credits", docx_text)

            xlsx_path = Path(directory) / "pricing.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = "Plans"
            sheet.append(["Plan", "Units"])
            sheet.append(["Starter", 100])
            workbook.save(xlsx_path)
            xlsx_text, _ = extract_file(xlsx_path)
            self.assertIn("Sheet: Plans", xlsx_text)
            self.assertIn("Starter | 100", xlsx_text)

    def test_pdf_locators_and_ocr_only_rejection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "faq.pdf"
            path.write_bytes(b"%PDF-1.7 synthetic")
            page = Mock()
            page.extract_text.return_value = "Pricing is 100 credits."
            with patch("pypdf.PdfReader", return_value=Mock(pages=[page])):
                text, mime = extract_file(path)
            self.assertEqual(mime, "application/pdf")
            self.assertIn("Page 1:", text)
            empty_page = Mock()
            empty_page.extract_text.return_value = ""
            with patch("pypdf.PdfReader", return_value=Mock(pages=[empty_page])):
                with self.assertRaisesRegex(ValueError, "OCR-only"):
                    extract_file(path)

    def test_office_container_signatures_and_macros_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fake_docx = Path(directory) / "fake.docx"
            fake_docx.write_bytes(b"not a zip")
            with self.assertRaisesRegex(ValueError, "signature"):
                extract_file(fake_docx)

            macro_docx = Path(directory) / "macro.docx"
            with zipfile.ZipFile(macro_docx, "w") as archive:
                archive.writestr("word/vbaProject.bin", b"macro")
            with self.assertRaisesRegex(ValueError, "Macro"):
                extract_file(macro_docx)

    def test_website_ingestion_blocks_private_dns_and_redirects(self) -> None:
        with patch("ingestion.pipeline.socket.getaddrinfo", return_value=[(None, None, None, None, ("127.0.0.1", 443))]), patch("requests.get") as request:
            with self.assertRaisesRegex(ValueError, "Private"):
                fetch_authorized_https("https://approved.example/faq", {"approved.example"})
            request.assert_not_called()

        response = Mock(status_code=200, encoding="utf-8")
        response.iter_content.return_value = [b"<html><body>Approved FAQ</body></html>"]
        response.raise_for_status.return_value = None
        with patch("ingestion.pipeline.socket.getaddrinfo", return_value=[(None, None, None, None, ("93.184.216.34", 443))]), patch("requests.get", return_value=response):
            text, mime = fetch_authorized_https("https://approved.example/faq", {"approved.example"})
        self.assertEqual(mime, "text/html")
        self.assertIn("Approved FAQ", text)

        redirect = Mock(status_code=302, encoding="utf-8")
        redirect.raise_for_status.return_value = None
        with patch("ingestion.pipeline.socket.getaddrinfo", return_value=[(None, None, None, None, ("93.184.216.34", 443))]), patch("requests.get", return_value=redirect):
            with self.assertRaisesRegex(ValueError, "Redirects"):
                fetch_authorized_https("https://approved.example/redirect", {"approved.example"})

        response = Mock(status_code=200, encoding="utf-8")
        response.iter_content.return_value = [b"<html><body>Rebound</body></html>"]
        response.raise_for_status.return_value = None
        public = (None, None, None, None, ("93.184.216.34", 443))
        private = (None, None, None, None, ("10.0.0.8", 443))
        with patch("ingestion.pipeline.socket.getaddrinfo", side_effect=[[public], [private]]), patch("requests.get", return_value=response) as request:
            with self.assertRaisesRegex(ValueError, "Private"):
                fetch_authorized_https("https://approved.example/rebound", {"approved.example"})
            request.assert_called_once()

    def test_url_ingestion_keeps_approved_snapshot_url_and_sanitizes_content(self) -> None:
        response = Mock(status_code=200, encoding="utf-8")
        response.iter_content.return_value = [b"<html><body>Pricing is 42 credits. Email alice@example.com</body></html>"]
        response.raise_for_status.return_value = None
        with patch("ingestion.pipeline.socket.getaddrinfo", return_value=[(None, None, None, None, ("93.184.216.34", 443))]), patch("requests.get", return_value=response):
            source = ingest_url("Approved FAQ", "https://approved.example/faq", {"approved.example"})
        self.assertEqual(source.source_url, "https://approved.example/faq")
        self.assertIn("Pricing is 42 credits.", source.normalized_content)
        self.assertNotIn("alice@example.com", source.normalized_content)

    def test_worker_payload_is_sanitized_and_submission_claims_then_publishes(self) -> None:
        source = ingest_text("FAQ", "Email alice@example.com.\n\nPricing is 42 credits.", "text/plain")
        payload = result_payload(source)
        self.assertNotIn("alice@example.com", payload["normalizedContent"])
        session = Mock()
        claim_response = Mock()
        result_response = Mock()
        result_response.json.return_value = {"job": {"status": "completed"}}
        session.post.side_effect = [claim_response, result_response]
        output = submit_result("http://localhost:4000/", "job-1", "worker-secret", source, session)
        self.assertEqual(output["job"]["status"], "completed")
        self.assertEqual(session.post.call_count, 2)
        self.assertEqual(session.post.call_args_list[0].args[0], "http://localhost:4000/api/v1/internal/ingestion-jobs/job-1/claim")
        self.assertEqual(session.post.call_args_list[1].kwargs["json"]["contentHash"], source.content_hash)

    def test_worker_fetches_api_file_input_after_claim(self) -> None:
        session = Mock()
        response = Mock()
        response.json.return_value = {"fileName": "job-1.txt", "mimeType": "text/plain", "contentBase64": "RkFRIGRhdGE="}
        session.get.return_value = response
        file_name, mime_type, content = fetch_job_input("http://localhost:4000/", "job-1", "worker-secret", session)
        self.assertEqual((file_name, mime_type, content), ("job-1.txt", "text/plain", b"FAQ data"))
        self.assertEqual(session.get.call_args.args[0], "http://localhost:4000/api/v1/internal/ingestion-jobs/job-1/input")

    def test_worker_submits_without_reclaiming_an_already_claimed_upload(self) -> None:
        source = ingest_text("FAQ", "Approved content", "text/plain")
        session = Mock()
        response = Mock()
        response.json.return_value = {"job": {"status": "completed"}}
        session.post.return_value = response
        submit_result("http://localhost:4000", "job-1", "worker-secret", source, session, claim=False)
        self.assertEqual(session.post.call_count, 1)
        self.assertIn("/api/v1/internal/ingestion-jobs/job-1/result", session.post.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
