from pathlib import Path

from PIL import Image, ImageDraw
from reportlab.graphics.barcode import qr


OUT_DIR = Path(__file__).resolve().parents[1] / "assets" / "card"
NAVY = "#1F3A5F"
PAPER = "#FFFFFF"
QR_CODES = {
    "qr-general.png": "https://gyo6.kr/card/kim-younghee/?src=paper",
    "qr-vocational.png": "https://gyo6.kr/card/kim-younghee/?mode=vocational&src=vocational",
    "qr-exam.png": "https://gyo6.kr/card/kim-younghee/?mode=exam&src=exam",
    "qr-studio.png": "https://gyo6.kr/card/kim-younghee/?mode=studio&src=studio",
}


def qr_matrix(value: str) -> list[list[bool]]:
    widget = qr.QrCodeWidget(value)
    widget.qr.make()
    return [[bool(cell) for cell in row] for row in widget.qr.modules]


def render_qr(value: str, size: int = 720, quiet: int = 4) -> Image.Image:
    matrix = qr_matrix(value)
    module_count = len(matrix)
    total_modules = module_count + quiet * 2
    module_size = max(1, size // total_modules)
    actual_size = module_size * total_modules
    image = Image.new("RGB", (actual_size, actual_size), PAPER)
    draw = ImageDraw.Draw(image)
    for row_index, row in enumerate(matrix):
        for column_index, is_dark in enumerate(row):
            if not is_dark:
                continue
            x0 = (column_index + quiet) * module_size
            y0 = (row_index + quiet) * module_size
            draw.rectangle((x0, y0, x0 + module_size - 1, y0 + module_size - 1), fill=NAVY)
    return image.resize((size, size), Image.Resampling.NEAREST)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for filename, value in QR_CODES.items():
        render_qr(value).save(OUT_DIR / filename, optimize=True)


if __name__ == "__main__":
    main()
