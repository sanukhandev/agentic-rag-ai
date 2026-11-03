import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from ingestion.pipeline import ingest_archive_members
from ingestion.worker import archive_result_payload, configured_zip_member_delay_seconds


class ArchiveMemberIngestionTest(unittest.TestCase):
    def test_zip_creates_independent_member_sources_and_paces(self):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "training.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("training/01-pricing.md", "## Pricing\\n\\nApproved package information.")
                archive.writestr("training/02-process.txt", "Company formation is a staged process.")
            with patch("ingestion.pipeline.time.sleep") as pause:
                members, warnings = ingest_archive_members(archive_path, 1.25)
            self.assertEqual(warnings, [])
            self.assertEqual(len(members), 2)
            self.assertNotEqual(members[0][1].content_hash, members[1][1].content_hash)
            self.assertIn("01-pricing.md", members[0][1].chunks[0].locator)
            self.assertIn("02-process.txt", members[1][1].chunks[0].locator)
            pause.assert_called_once_with(1.25)
            payload = archive_result_payload(members, warnings)
            self.assertEqual(payload["kind"], "archive_members")
            self.assertEqual(payload["members"][0]["mimeType"], "text/markdown")
            self.assertEqual(set(payload["members"][0]), {"fileName", "mimeType", "normalizedContent", "contentHash", "chunks"})
            self.assertEqual([row["fileName"] for row in payload["members"]], ["training/01-pricing.md", "training/02-process.txt"])

    def test_zip_rejects_unsafe_and_oversized_delays(self):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "training.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("../outside.txt", "unsafe")
            with self.assertRaisesRegex(ValueError, "unsafe path"):
                ingest_archive_members(archive_path, 0)
            with self.assertRaisesRegex(ValueError, "delay"):
                ingest_archive_members(archive_path, 11)

    def test_bad_delay_configuration_is_rejected(self):
        with patch.dict("os.environ", {"INGESTION_ZIP_MEMBER_DELAY_SECONDS": "abc"}):
            with self.assertRaisesRegex(ValueError, "must be a number"):
                configured_zip_member_delay_seconds()


if __name__ == "__main__":
    unittest.main()
