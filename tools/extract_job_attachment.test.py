import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile


class AttachmentTests(unittest.TestCase):
    def run_reader(self, path):
        return subprocess.run([sys.executable, str(Path(__file__).with_name('extract_job_attachment.py')), str(path)],
                              capture_output=True, text=True, timeout=15)

    def test_hwpx_inside_zip_and_unsupported_hwp(self):
        import io
        document = io.BytesIO()
        with zipfile.ZipFile(document, 'w') as archive:
            archive.writestr('Contents/section0.xml', '<root>' + '고졸 신입 지원 자격 확인. ' * 20 + '</root>')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'notice.zip'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('../../notice.hwpx', document.getvalue())
                archive.writestr('unsupported.hwp', b'unsupported')
            result = self.run_reader(path)
            self.assertEqual(result.returncode, 0, result.stderr)
            docs = json.loads(result.stdout)['documents']
            self.assertTrue(docs[0]['complete'])
            self.assertEqual(len(docs[0]['sha256']), 64)
            self.assertFalse(docs[1]['complete'])
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_zip_entry_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'notice.zip'
            with zipfile.ZipFile(path, 'w') as archive:
                for i in range(41):
                    archive.writestr(str(i) + '.pdf', b'')
            self.assertNotEqual(self.run_reader(path).returncode, 0)

    def test_scanned_or_empty_pdf_stays_unverified(self):
        from pypdf import PdfWriter
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'notice.pdf'
            writer = PdfWriter()
            writer.add_blank_page(width=100, height=100)
            writer.write(path)
            result = self.run_reader(path)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(json.loads(result.stdout)['documents'][0]['complete'])


if __name__ == '__main__':
    unittest.main()
