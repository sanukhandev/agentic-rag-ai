import io
import unittest
from zipfile import ZipInfo
from pathlib import Path
from prepare_local_rag import safe_member

class SafetyTests(unittest.TestCase):
    def test_blocks_traversal(self):self.assertEqual(safe_member(ZipInfo('../secret.pdf'))[1],'unsafe_path')
    def test_blocks_executable(self):self.assertEqual(safe_member(ZipInfo('script.exe'))[1],'unsupported_extension')
    def test_allows_markdown(self):self.assertTrue(safe_member(ZipInfo('documents/business.md'))[0])
    def test_blocks_absolute(self):self.assertFalse(safe_member(ZipInfo('/etc/passwd'))[0])
if __name__=='__main__':unittest.main()
