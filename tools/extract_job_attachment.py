"""Extract official notice text; scanned/unsupported files remain unverified."""
import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

source = Path(sys.argv[1])
if source.suffix.lower() == '.pdf':
    from pypdf import PdfReader
    reader = PdfReader(source)
    if len(reader.pages) > 80:
        raise ValueError('notice exceeds 80 pages')
    pages = [page.extract_text(extraction_mode='layout') or '' for page in reader.pages]
elif source.suffix.lower() == '.hwpx':
    with zipfile.ZipFile(source) as archive:
        sections = [name for name in archive.namelist() if name.startswith('Contents/section') and name.endswith('.xml')]
        if sum(archive.getinfo(name).file_size for name in sections) > 16 * 1024 * 1024:
            raise ValueError('notice exceeds extraction size limit')
        pages = ['\n'.join(ElementTree.fromstring(archive.read(name)).itertext()) for name in sorted(sections)]
else:
    raise ValueError('unsupported attachment format')
text = '\n\n'.join(pages)
print(json.dumps({'text': text[:250000], 'complete': len(text) <= 250000 and len(text.strip()) > 100}, ensure_ascii=True))
