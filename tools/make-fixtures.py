# Generates the photo and PDF fixtures used by the browser check:
#   examples/07-photo-notice.png   the PS-02 sample as a photographed notice (tilt, shadow, grain) -> OCR path
#   examples/08-pdf-timetable.pdf  examples/04-exam-timetable.txt as a real PDF (LibreOffice)        -> PDF text path
# Run from the repo root: python tools/make-fixtures.py
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
EX = ROOT / 'examples'
random.seed(7)


def font(size, bold=False):
    for name in (['arialbd.ttf', 'segoeuib.ttf'] if bold else ['arial.ttf', 'segoeui.ttf', 'DejaVuSans.ttf']):
        for d in ('C:/Windows/Fonts', '/usr/share/fonts/truetype/dejavu', '/Library/Fonts'):
            p = Path(d) / name
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def wrap(draw, text, fnt, width):
    lines, line = [], ''
    for word in text.split():
        trial = f'{line} {word}'.strip()
        if draw.textlength(trial, font=fnt) <= width:
            line = trial
        else:
            lines.append(line); line = word
    if line:
        lines.append(line)
    return lines


def photo_notice():
    text = (EX / '01-pdf-sample.txt').read_text(encoding='utf-8').strip()
    W, H = 1600, 1100
    paper = Image.new('RGB', (W, H), (250, 248, 240))
    d = ImageDraw.Draw(paper)
    head, body = font(54, True), font(40)
    d.text((W // 2, 110), 'NOTICE', font=head, fill=(20, 20, 30), anchor='mm')
    d.line([(W // 2 - 140, 150), (W // 2 + 140, 150)], fill=(20, 20, 30), width=3)
    d.text((110, 200), 'Dept. of CSE, III Year', font=font(34, True), fill=(20, 20, 30))
    y = 290
    for line in wrap(d, text, body, W - 220):
        d.text((110, y), line, font=body, fill=(25, 25, 35)); y += 58
    d.text((110, y + 60), 'HOD, CSE', font=font(34), fill=(25, 25, 35))
    # photographed: slight tilt, a wall behind, a soft shadow and sensor grain
    tilted = paper.rotate(2.2, resample=Image.BICUBIC, expand=True, fillcolor=(120, 118, 125))
    wall = Image.new('RGB', (tilted.width + 160, tilted.height + 160), (118, 116, 124))
    shadow = Image.new('RGBA', wall.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rectangle([100, 110, 100 + tilted.width, 110 + tilted.height], fill=(0, 0, 0, 90))
    wall.paste(Image.alpha_composite(wall.convert('RGBA'), shadow.filter(ImageFilter.GaussianBlur(18))).convert('RGB'))
    wall.paste(tilted, (80, 80))
    # uneven light: darker towards one corner
    px = wall.load()
    for yy in range(0, wall.height, 2):
        k = 1 - 0.22 * (yy / wall.height)
        for xx in range(0, wall.width, 2):
            r, g, b = px[xx, yy]
            n = random.randint(-6, 6)
            px[xx, yy] = (max(0, min(255, int(r * k) + n)), max(0, min(255, int(g * k) + n)), max(0, min(255, int(b * (k - 0.02)) + n)))
    wall = wall.filter(ImageFilter.GaussianBlur(0.6))
    wall.save(EX / '07-photo-notice.png', optimize=True)
    print('wrote', EX / '07-photo-notice.png', wall.size)


def pdf_timetable():
    src = EX / '04-exam-timetable.txt'
    soffice = next((p for p in [Path('C:/Program Files/LibreOffice/program/soffice.exe'), Path('/usr/bin/soffice'), Path('/Applications/LibreOffice.app/Contents/MacOS/soffice')] if p.exists()), None)
    if not soffice:
        sys.exit('LibreOffice not found; needed to make the PDF fixture')
    with tempfile.TemporaryDirectory() as tmp:
        txt = Path(tmp) / 'notice.txt'
        txt.write_text(src.read_text(encoding='utf-8'), encoding='utf-8')
        subprocess.run([str(soffice), '--headless', '--convert-to', 'pdf', '--outdir', tmp, str(txt)], capture_output=True, timeout=180)
        out = Path(tmp) / 'notice.pdf'
        if not out.exists():
            sys.exit('LibreOffice did not produce the PDF')
        shutil.copy(out, EX / '08-pdf-timetable.pdf')
    print('wrote', EX / '08-pdf-timetable.pdf')


if __name__ == '__main__':
    photo_notice()
    pdf_timetable()
