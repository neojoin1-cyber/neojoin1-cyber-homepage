"""Extract official notice text; scanned/unsupported files remain unverified."""
import json
import sys
import zipfile
import hashlib
import io
from pathlib import Path
from xml.etree import ElementTree

def extract(name, data):
    suffix = Path(name).suffix.lower()
    if suffix == '.pdf':
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        if len(reader.pages) > 80:
            raise ValueError('notice exceeds 80 pages')
        pages = [page.extract_text(extraction_mode='layout') or '' if '/Contents' in page else '' for page in reader.pages]
    elif suffix == '.hwpx':
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            sections = [n for n in archive.namelist() if n.startswith('Contents/section') and n.endswith('.xml')]
            if sum(archive.getinfo(n).file_size for n in sections) > 16 * 1024 * 1024:
                raise ValueError('notice exceeds extraction size limit')
            pages = ['\n'.join(ElementTree.fromstring(archive.read(n)).itertext()) for n in sorted(sections)]
    else:
        return {'name': name, 'text': '', 'complete': False, 'reason': 'unsupported-format'}
    text = '\n\n'.join(pages)
    return {'name': name, 'sha256': hashlib.sha256(data).hexdigest(), 'text': text[:250000],
            'complete': len(text) <= 250000 and len(text.strip()) > 100}


def safe_extract(name, data):
    try:
        return extract(name, data)
    except Exception as error:
        return {'name': name, 'text': '', 'complete': False, 'reason': type(error).__name__}


source = Path(sys.argv[1])
if source.suffix.lower() == '.zip':
    with zipfile.ZipFile(source) as archive:
        files = [item for item in archive.infolist() if not item.is_dir()]
        if len(files) > 40 or sum(item.file_size for item in files) > 32 * 1024 * 1024:
            raise ValueError('archive exceeds bounded extraction limits')
        # Read in memory only; archive paths are never written to the filesystem.
        documents = [safe_extract(item.filename, archive.read(item)) for item in files
                     if Path(item.filename).suffix.lower() in ('.pdf', '.hwpx', '.hwp')]
else:
    documents = [safe_extract(source.name, source.read_bytes())]
print(json.dumps({'documents': documents}, ensure_ascii=True))
