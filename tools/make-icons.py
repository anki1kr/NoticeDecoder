# Draws the app icon: a paper notice with a highlighter stroke, on the stamp-pad violet of the site.
# Writes app/icon-192.png, app/icon-512.png and app/icon-maskable-512.png (extra safe-zone padding).
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app")
VIOLET, PAPER, INK, HIGHLIGHT, AMBER = (61, 44, 141), (253, 253, 252), (29, 27, 38), (255, 241, 118), (180, 83, 9)

def draw(size, pad_ratio):
    img = Image.new("RGBA", (size, size), VIOLET)
    d = ImageDraw.Draw(img)
    pad = int(size * pad_ratio)
    inner = size - 2 * pad
    # paper
    px, py, pw, ph = pad + int(inner * 0.14), pad + int(inner * 0.08), int(inner * 0.72), int(inner * 0.84)
    d.rounded_rectangle([px, py, px + pw, py + ph], radius=int(inner * 0.05), fill=PAPER)
    # text lines (grey), one of them highlighted
    line_h = max(2, int(inner * 0.045))
    gap = int(inner * 0.11)
    y = py + int(ph * 0.2)
    for i in range(5):
        w = pw * (0.7 if i % 2 else 0.55)
        x0 = px + int(pw * 0.14)
        if i == 2:
            d.rounded_rectangle([x0 - int(line_h * 0.9), y - int(line_h * 1.3), x0 + int(w) + int(line_h * 0.9), y + int(line_h * 2.3)], radius=int(line_h), fill=HIGHLIGHT)
        d.rounded_rectangle([x0, y, x0 + int(w), y + line_h], radius=line_h // 2, fill=(160, 156, 176) if i != 2 else INK)
        y += gap
    # red clash diamond, bottom right of the paper
    cx, cy, r = px + pw - int(pw * 0.16), py + ph - int(ph * 0.16), int(inner * 0.075)
    d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=(220, 38, 38))
    d.polygon([(cx, cy - r * 0.55), (cx + r * 0.55, cy), (cx, cy + r * 0.55), (cx - r * 0.55, cy)], fill=PAPER)
    return img

draw(512, 0.0).resize((192, 192), Image.LANCZOS).save(os.path.join(ROOT, "icon-192.png"))
draw(512, 0.0).save(os.path.join(ROOT, "icon-512.png"))
draw(512, 0.12).save(os.path.join(ROOT, "icon-maskable-512.png"))
print("icons written")
