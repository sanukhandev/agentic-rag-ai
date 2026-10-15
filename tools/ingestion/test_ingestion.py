import tempfile
import unittest
from pathlib import Path

from ingestion.pipeline import chunk_text, ingest_file, ingest_text, sanitize


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
            self.assertEqual(first.chunks, second.chunks)

    def test_chunk_bound_is_enforced(self) -> None:
        self.assertTrue(all(len(chunk.content) <= 20 for chunk in chunk_text("one two three four five six", max_chars=20)))

    def test_unsupported_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "file.exe"
            path.write_bytes(b"not allowed")
            with self.assertRaises(ValueError):
                ingest_file(path)


if __name__ == "__main__":
    unittest.main()
