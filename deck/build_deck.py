# Builds deck/NoticeDecoder_NovaNexus_PS02.pptx (+ .pdf by PowerPoint): six native, editable slides on the SIH idea
# template's own frame (serif slide titles, team-name oval, footer bar, navy headings on light bands), with a SETU 2026
# wordmark where the SIH logo was. Content and numbers as in the team's 6-slide deck; numbers come from real test runs.
# Run from the project root with the app served on :8771 (python -m http.server 8771 --bind 127.0.0.1 --directory app):
#   PLAYWRIGHT_DIR=<folder whose node_modules has playwright> node tools/deck-shots.mjs && python deck/build_deck.py
import copy
import os
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_LINE_DASH_STYLE
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'tmp' / 'deck'
OUT = Path(os.environ.get('DECK_OUT', ROOT / 'deck' / 'NoticeDecoder_NovaNexus_PS02.pptx'))  # DECK_OUT: preview path while the deck is open
LIVE = 'https://anki1kr.me/NoticeDecoder/'
VIDEO = 'https://youtu.be/joI75POVTr0'    # checked public with yt_check.py
REPO = 'https://github.com/anki1kr/NoticeDecoder'
TEMPLATE = ROOT / 'deck' / 'template' / 'SIH2026-IDEA-Presentation-Format.pptx'   # the SIH idea template, used as the frame
try:
    import segno  # QR codes
except ImportError:
    sys.exit('pip install segno python-pptx pillow')

NAVY = RGBColor(0x1F, 0x49, 0x7D)      # the template's dk2 (title and heading navy)
INK = RGBColor(0x26, 0x2A, 0x33)
GREY = RGBColor(0x5B, 0x63, 0x70)
LINE = RGBColor(0xC9, 0xD2, 0xDF)
RED = RGBColor(0xB4, 0x23, 0x18)
GREEN = RGBColor(0x1E, 0x6B, 0x34)
AMBER = RGBColor(0x9A, 0x5B, 0x00)
HL = RGBColor(0xFF, 0xF1, 0x76)        # the app's highlighter yellow
# The app marks each event with a real highlighter colour (app/styles.css .c0-.c5). The deck reuses them by role:
# each slide owns one highlighter (heading bands, pins, table heads, headline figure, the stroke behind its title).
# 'mark' = the highlighter itself, 'tint' = a light band of it, 'ink' = its dark shade for text (>= 4.5:1 on white).
PAL = {
    'yellow':   dict(mark=RGBColor(0xFF, 0xF1, 0x76), tint=RGBColor(0xFF, 0xF8, 0xC2), ink=RGBColor(0x6E, 0x54, 0x00)),
    'blue':     dict(mark=RGBColor(0xB8, 0xE4, 0xFF), tint=RGBColor(0xE2, 0xF3, 0xFF), ink=RGBColor(0x12, 0x55, 0x86)),
    'green':    dict(mark=RGBColor(0xB9, 0xF5, 0xA6), tint=RGBColor(0xE3, 0xFB, 0xDB), ink=RGBColor(0x1E, 0x61, 0x16)),
    'orange':   dict(mark=RGBColor(0xFF, 0xD5, 0x9C), tint=RGBColor(0xFF, 0xEE, 0xD6), ink=RGBColor(0x86, 0x45, 0x00)),
    'lavender': dict(mark=RGBColor(0xDC, 0xCF, 0xFF), tint=RGBColor(0xF0, 0xEB, 0xFF), ink=RGBColor(0x4B, 0x36, 0x99)),
    'pink':     dict(mark=RGBColor(0xFF, 0xC4, 0xE1), tint=RGBColor(0xFF, 0xE6, 0xF1), ink=RGBColor(0x92, 0x21, 0x5C)),
}
ACC = PAL['yellow']                    # the current slide's highlighter; set before each slide
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
FONT = 'Calibri'                       # the template's body font


# ---------------------------------------------------------------- numbers from real runs (unchanged from the team's builder)
def run(*cmd, cwd=ROOT, env=None):
    e = dict(os.environ)
    if env:
        e.update(env)
    return subprocess.run(list(cmd), cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace', env=e, shell=(os.name == 'nt')).stdout


def passed(out):
    m = re.search(r'(\d+) passed', out)
    return int(m.group(1)) if m else None


N_ENGINE = passed(run('node', 'tests/engine.test.mjs'))
N_WORKER = passed(run('node', 'worker/test/feed.test.mjs'))
run('node', 'tools/bundle-engine.mjs')
N_GMAIL = passed(run('node', 'integrations/gmail-apps-script/test/run.mjs'))
run('node', 'companion/scripts/sync-engine.mjs')
N_APP = passed(run('node', 'test/pipeline.test.mjs', cwd=ROOT / 'companion'))
ui = run('node', 'tools/ui-check.mjs', env={'PLAYWRIGHT_DIR': os.environ.get('PLAYWRIGHT_DIR', str(Path.home() / 'Desktop' / 'gm'))})
m = re.search(r'(\d+) passed, (\d+) failed', ui)
N_BROWSER, N_BROWSER_FAIL = (int(m.group(1)), int(m.group(2))) if m else (None, None)
N_NOTICES = len(list((ROOT / 'examples').glob('*.txt')))
if None in (N_ENGINE, N_WORKER, N_GMAIL, N_APP, N_BROWSER) or N_BROWSER_FAIL:
    sys.exit(f'A check failed or did not run (engine {N_ENGINE}, worker {N_WORKER}, gmail {N_GMAIL}, app {N_APP}, browser {N_BROWSER}/{N_BROWSER_FAIL} failed); fix it before building the deck.')
for f in ('summary.png', 'notice.png', 'rows.png', 'timeline.png', 'phone-amber.png'):
    if not (SHOTS / f).exists():
        sys.exit(f'missing {SHOTS / f}: run node tools/deck-shots.mjs with the app served on :8771')
parts = [Image.open(SHOTS / f'{n}.png') for n in ('summary', 'notice', 'rows')]
gap = 28
comp = Image.new('RGB', (max(p.width for p in parts), sum(p.height for p in parts) + gap * 2), (239, 238, 242))
ypos, PART_Y = 0, []
for p in parts:
    comp.paste(p, (0, ypos)); PART_Y.append(ypos); ypos += p.height + gap
comp.save(SHOTS / 'shot-solution.png')
pr = Image.open(SHOTS / 'phone-results.png'); pr.crop((0, int(pr.height * 0.35), pr.width, pr.height)).save(SHOTS / 'phone-results-crop.png')
am = Image.open(SHOTS / 'phone-amber.png'); am.crop((0, 0, am.width, int(am.height * 0.52))).save(SHOTS / 'phone-amber-top.png')
print(f'engine {N_ENGINE}, worker {N_WORKER}, gmail {N_GMAIL}, companion {N_APP}, browser {N_BROWSER}, notices {N_NOTICES}')


# ---------------------------------------------------------------- the SIH frame, SETU branding
prs = Presentation(str(TEMPLATE))
sldIdLst = prs.slides._sldIdLst
sldIdLst.remove(sldIdLst[6])           # the template's instructions slide


def drop(slide, pred):
    for sh in [sh for sh in slide.shapes if pred(sh)]:
        sh._element.getparent().remove(sh._element)


def set_text(shape, value):
    """Replace a placeholder's words but keep its first run's formatting; drop any other runs and empty paragraphs."""
    paras = shape.text_frame.paragraphs
    first = next((r for p in paras for r in p.runs), None)
    for p in paras:
        for r in list(p.runs):
            if r._r is not first._r:   # python-pptx wraps each access in a new object; compare the XML
                r._r.getparent().remove(r._r)
    for br in shape.text_frame._txBody.iter('{http://schemas.openxmlformats.org/drawingml/2006/main}br'):
        br.getparent().remove(br)   # a hidden line break would push the text off its centre
    if first is not None:
        for p in paras:
            if not p.runs:
                p._p.getparent().remove(p._p)
    if first is None:
        first = paras[0].add_run()
    first.text = value
    return first


def runs(p, text, size, color=INK, hl=NAVY, bold_all=False):
    """**word** = bold navy (a judge reading only the bold words gets the line); ==phrase== = bold on the slide's
    highlighter, the way the app marks a notice. Use == once or twice a slide."""
    from lxml import etree
    for part in re.split(r'(\*\*.+?\*\*|==.+?==)', text):
        if not part:
            continue
        bold, mark = part.startswith('**'), part.startswith('==')
        r = p.add_run(); r.text = part[2:-2] if (bold or mark) else part
        f = r.font; f.name = FONT; f.size = Pt(size)
        f.bold = bold or mark or bold_all
        f.color.rgb = INK if mark else (hl if bold else color)
        if mark:
            rpr = r._r.get_or_add_rPr()
            h = etree.Element('{http://schemas.openxmlformats.org/drawingml/2006/main}highlight')
            etree.SubElement(h, '{http://schemas.openxmlformats.org/drawingml/2006/main}srgbClr').set('val', str(ACC['mark']))
            fill = rpr.find('{http://schemas.openxmlformats.org/drawingml/2006/main}solidFill')
            (fill.addnext(h) if fill is not None else rpr.insert(0, h))


def text(slide, x, y, w, h, lines, size=16, color=INK, hl=NAVY, align=PP_ALIGN.LEFT, space=4, anchor=MSO_ANCHOR.TOP, bold_all=False):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = True; tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Inches(0.05); tf.margin_top = tf.margin_bottom = Inches(0.02)
    for i, line in enumerate([lines] if isinstance(lines, str) else lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align; p.space_after = Pt(space)
        runs(p, line, size, color, hl, bold_all)
    return tb


def band(slide, x, y, w, label, h=0.42, size=16):
    """A section heading: bold, in the slide highlighter's ink, on a light band of the same highlighter."""
    b = rect(slide, x, y, w, h, ACC['tint'], None, MSO_SHAPE.ROUNDED_RECTANGLE)
    b.adjustments[0] = 0.18
    tb = text(slide, x + 0.06, y, w - 0.1, h, label, size, ACC['ink'], ACC['ink'], bold_all=True, anchor=MSO_ANCHOR.MIDDLE)
    tb.text_frame.margin_left = Inches(0.1)
    return tb


def rect(slide, x, y, w, h, fill, line=None, shape=MSO_SHAPE.RECTANGLE, lw=1.0):
    s = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        s.adjustments[0] = 0.08
    if fill is None:
        s.fill.background()
    else:
        s.fill.solid(); s.fill.fore_color.rgb = fill
    if line:
        s.line.color.rgb = line; s.line.width = Pt(lw)
    else:
        s.line.fill.background()
    s.shadow.inherit = False
    return s


def box(slide, x, y, w, h, key, detail=None, keycol=NAVY, edge=LINE, fill=WHITE, ks=15, ds=13, lw=1.0, center=False):
    """Key word on top in bold, one plain line under it. White with a thin edge; the edge carries the meaning."""
    s = rect(slide, x, y, w, h, fill, edge, MSO_SHAPE.ROUNDED_RECTANGLE, lw)
    tf = s.text_frame; tf.word_wrap = True; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.margin_left = tf.margin_right = Inches(0.1); tf.margin_top = tf.margin_bottom = Inches(0.04)
    al = PP_ALIGN.CENTER if center else PP_ALIGN.LEFT
    p = tf.paragraphs[0]; p.alignment = al; runs(p, key, ks, keycol, keycol, bold_all=True)
    if detail:
        p2 = tf.add_paragraph(); p2.alignment = al; p2.space_before = Pt(2); runs(p2, detail, ds, INK)
    return s


def headline(slide, x, y, w, h, big, label, bs=28, ls=14):
    """The one figure a judge should remember from this slide, on the app's highlighter yellow."""
    s = rect(slide, x, y, w, h, ACC['mark'], None, MSO_SHAPE.RECTANGLE)
    tf = s.text_frame; tf.word_wrap = True; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.margin_left = tf.margin_right = Inches(0.14)
    p = tf.paragraphs[0]; runs(p, big, bs, INK, INK, bold_all=True)
    p2 = tf.add_paragraph(); runs(p2, label, ls, INK)
    return s


def connector(slide, x1, y1, x2, y2):
    c = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = NAVY; c.line.width = Pt(1.75)
    ln = c.line._get_or_add_ln()
    from lxml import etree
    tail = etree.SubElement(ln, '{http://schemas.openxmlformats.org/drawingml/2006/main}tailEnd')
    tail.set('type', 'triangle'); tail.set('w', 'med'); tail.set('len', 'med')
    return c


def pin(slide, x, y, n):
    c = rect(slide, x, y, 0.34, 0.34, ACC['ink'], WHITE, MSO_SHAPE.OVAL, 1.5)
    tf = c.text_frame; tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER; runs(p, str(n), 13, WHITE, WHITE, bold_all=True)


def shot(slide, path, x, y, w, pins=None):
    """Screenshot with a thin frame. Pins (n, fy) sit OUTSIDE the picture on its left edge, level with what they name,
    so no pin ever covers words or a button."""
    pic = slide.shapes.add_picture(str(path), Inches(x), Inches(y), width=Inches(w))
    pic.line.color.rgb = LINE; pic.line.width = Pt(1)
    h = pic.height / 914400
    for n, fy in pins or []:
        pin(slide, x - 0.42, y + fy * h - 0.17, n)
    return h


def table(slide, x, y, w, col_w, rows, size=13, head=14, row_h=0.36):
    shp = slide.shapes.add_table(len(rows), len(rows[0]), Inches(x), Inches(y), Inches(w), Inches(row_h * len(rows)))
    t = shp.table
    for j, cw in enumerate(col_w):
        t.columns[j].width = Inches(cw)
    for i, row in enumerate(rows):
        t.rows[i].height = Inches(row_h)
        for j, val in enumerate(row):
            c = t.cell(i, j); c.margin_left = c.margin_right = Inches(0.08); c.margin_top = c.margin_bottom = Inches(0.03)
            c.vertical_anchor = MSO_ANCHOR.MIDDLE
            c.fill.solid(); c.fill.fore_color.rgb = ACC['ink'] if i == 0 else (WHITE if i % 2 else ACC['tint'])
            p = c.text_frame.paragraphs[0]
            if i == 0:
                runs(p, val, head, WHITE, WHITE, bold_all=True)
            else:
                runs(p, val or ' ', size, INK)
    return shp


def qr(slide, url, x, y, size, label):
    path = SHOTS / f"qr-{''.join(c for c in label.lower() if c.isalnum())}.png"
    segno.make(url, error='m').save(str(path), scale=12, border=2)
    pic = slide.shapes.add_picture(str(path), Inches(x), Inches(y), Inches(size), Inches(size))
    pic.line.color.rgb = LINE; pic.line.width = Pt(0.75)
    pic.click_action.hyperlink.address = url
    tb = slide.shapes.add_textbox(Inches(x - 0.4), Inches(y + size + 0.03), Inches(size + 0.8), Inches(0.5))
    p = tb.text_frame.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = label; r.hyperlink.address = url
    r.font.name, r.font.size, r.font.bold, r.font.color.rgb = FONT, Pt(13), True, NAVY
    p.add_run().text = ' '   # a plain run after the link keeps PowerPoint's PDF export from dropping it


def wordmark(slide):
    """SETU 2026 where the template had the SIH logo."""
    text(slide, 10.55, 0.18, 2.6, 0.95, ['**SETU 2026**', 'Forge Realm  |  PS-02'], 13, GREY, NAVY, PP_ALIGN.RIGHT, space=0)
    slide.shapes[-1].text_frame.paragraphs[0].runs[0].font.size = Pt(24)


from PIL import ImageFont  # noqa: E402
TITLE_FONT = ImageFont.truetype('C:/Windows/Fonts/timesbd.ttf', 400)
TITLE_BOX = (1.85, 0.2, 8.6, 1.0)      # every slide title: same box, text centred both ways


def title_stroke(slide, title, size_pt, cy, cx=None):
    """Marker stroke behind the lower half of a serif title. Width measured from the Times New Roman Bold glyphs."""
    w = TITLE_FONT.getlength(title) / 400 * size_pt / 72 + 0.35
    cx = TITLE_BOX[0] + TITLE_BOX[2] / 2 if cx is None else cx
    st = rect(slide, cx - w / 2, cy, w, size_pt / 72 * 0.36, ACC['mark'], None, MSO_SHAPE.ROUNDED_RECTANGLE)
    st.adjustments[0] = 0.5
    tree = slide.shapes._spTree
    tree.remove(st._element); tree.insert(2, st._element)   # behind everything else on the slide


def frame(slide, title):
    """Keep the template's footer bar, slide number, team oval and serif title; swap the SIH logo and pointers."""
    drop(slide, lambda sh: sh.shape_type == 13 or sh.name.startswith('TextBox'))
    for sh in slide.shapes:
        if sh.name.startswith('Oval'):
            r = set_text(sh, 'Nova Nexus'); r.font.bold = True; r.font.size = Pt(15)
        elif sh.name.startswith('Footer'):
            set_text(sh, '@SETU 2026  PS-02 Prototype Submission')
        elif sh.name.startswith('Title'):
            r = set_text(sh, title)
            size = (r.font.size.pt if r.font.size else 36)
            sh.left, sh.top, sh.width, sh.height = (Inches(v) for v in TITLE_BOX)
            sh.text_frame.vertical_anchor = MSO_ANCHOR.MIDDLE
            for q in sh.text_frame.paragraphs:
                q.alignment = PP_ALIGN.CENTER
            title_stroke(slide, title, size, TITLE_BOX[1] + TITLE_BOX[3] / 2 + 0.02)
    wordmark(slide)


S = list(prs.slides)

ACC = PAL['yellow']

# ---------------------------------------------------------------- 1. title page
s = S[0]
drop(s, lambda sh: sh.shape_type in (13, 5) or sh.name.startswith('Rectangle'))
for sh in s.shapes:
    if sh.name.startswith('Title'):
        set_text(sh, 'SETU 2026')
    if sh.name.startswith('Subtitle'):
        set_text(sh, 'NOTICE DECODER')
        sh.left, sh.top, sh.width, sh.height = Inches(0.45), Inches(1.05), Inches(7.1), Inches(0.75)
        sh.text_frame.paragraphs[0].alignment = PP_ALIGN.LEFT
        sh.text_frame.vertical_anchor = MSO_ANCHOR.TOP; sh.text_frame.auto_size = None
        _w = TITLE_FONT.getlength('NOTICE DECODER') / 400 * 40 / 72 + 0.35
        title_stroke(s, 'NOTICE DECODER', 40, 1.38, cx=0.45 + _w / 2)
        sh.text_frame.margin_top = sh.text_frame.margin_bottom = 0
    if sh.name.startswith('TextBox'):
        # the template's six bullet lines (blank spacer paragraphs between them are kept)
        lines = [q for q in sh.text_frame.paragraphs if q.text.strip()]
        values = [('Problem Statement ID – ', 'PS-02'), ('Problem Statement Title – ', 'Notice Decoder'),
                  ('Realm – ', 'Forge Realm'), ('Category – ', 'Software (web app)'),
                  ('Team Name – ', 'Nova Nexus'), ('Members – ', 'Ankit Kumar (Leader), Ankit, Ashwani Tanwar')]
        for q, (lab, val) in zip(lines, values):
            first = q.runs[0]
            for r in q.runs[1:]:
                r._r.getparent().remove(r._r)
            first.text = lab; first.font.size = Pt(18)
            r = q.add_run(); r.text = val; r.font.size = Pt(18); r.font.bold = False
            q.alignment = PP_ALIGN.LEFT
text(s, 0.5, 1.95, 7.0, 0.6, 'Paste a college notice. Its dates go into your calendar, with clashes marked.', 16, GREY)
s.shapes[-1].text_frame.paragraphs[0].runs[0].font.italic = True
ph = shot(s, SHOTS / 'phone-results-crop.png', 7.75, 1.45, 2.55)
for i, (url, label) in enumerate([(VIDEO, 'Demo video'), (LIVE, 'Website'), (REPO, 'GitHub')]):
    qr(s, url, 11.15, 1.2 + i * 1.85, 1.2, label)
text(s, 10.4, 0.25, 2.75, 0.4, 'Forge Realm  |  PS-02', 14, GREY, align=PP_ALIGN.RIGHT)

# ---------------------------------------------------------------- 2. the idea
ACC = PAL['yellow']
s = S[1]; frame(s, 'NOTICE DECODER')
band(s, 0.45, 1.3, 6.15, 'The problem')
text(s, 0.45, 1.78, 6.15, 0.7, 'Notices come as long paragraphs. Students miss dates, and find clashes too late.', 15)
band(s, 6.73, 1.3, 6.15, 'Our idea')
text(s, 6.73, 1.78, 6.15, 0.7, 'Paste a notice. The app finds each event, shows the words it read, checks for clashes and adds the ==calendar events==.', 15)
sh_h = shot(s, SHOTS / 'shot-solution.png', 0.95, 2.6, 6.6,
            pins=[(1, (PART_Y[0] + 51) / comp.height), (2, (PART_Y[1] + 330) / comp.height), (3, (PART_Y[2] + 190) / comp.height)])
text(s, 0.55, 2.7 + sh_h, 7.0, 0.4, '**1** The answer first     **2** Each date shows the words it came from     **3** One line per event', 13)
band(s, 7.85, 2.6, 5.03, 'What others will not have')
text(s, 7.85, 3.1, 5.03, 2.9, ['**Shows where each date came from.** Tap a date and the notice lights up the words.',
                               '**Catches a notice that disagrees with itself.** "Results by 9 PM today" and "results next day": both shown, you pick one.',
                               '**Never makes up a date.** "This week or next week" waits in a list, not in your calendar.',
                               '**One change updates the whole class.** The class rep publishes once; a postponed exam moves in every student\'s calendar.'], 13, space=6)
headline(s, 7.85, 6.05, 5.03, 0.78, '3 of 3 events right', 'and both clashes found on the PS-02 example', bs=20, ls=13)

# ---------------------------------------------------------------- 3. technical approach
ACC = PAL['blue']
s = S[2]; frame(s, 'TECHNICAL APPROACH')
band(s, 0.45, 1.3, 5.45, 'What we use')
text(s, 0.45, 1.85, 5.45, 3.9, ['**App:** a web page in plain JavaScript. It runs in the browser, so it works offline.',
                                '**Reading rules:** dates (13 Nov, 13/11/2026), times (2 PM, 14:00, 12 noon), rooms, and words like "postponed to".',
                                '**Photos and PDFs:** read on the phone; every date from a photo is marked for a check.',
                                '**Calendar:** an .ics file, Google Calendar in one tap, or a class calendar link from a free Cloudflare Worker.',
                                f'**Tested:** {N_ENGINE} rule tests and {N_BROWSER} browser checks run on every change.'], 14, space=9)
band(s, 6.2, 1.3, 6.68, 'How a notice becomes events')
ins = [('Paste or share', 'yellow', False), ('Photo or PDF', 'pink', False), ('College email', 'orange', True), ('WhatsApp group', 'green', True)]
for i, (k, c, later) in enumerate(ins):
    b = box(s, 6.2, 1.95 + i * 0.75, 1.75, 0.6, k, None, keycol=INK, edge=PAL[c]['ink'], fill=PAL[c]['mark'] if not later else WHITE, ks=13, center=True, lw=1.25)
    if later:
        b.line.dash_style = MSO_LINE_DASH_STYLE.DASH
    connector(s, 7.95, 2.25 + i * 0.75, 8.45, 3.05)
core = box(s, 8.45, 2.45, 2.0, 1.2, 'Reading rules', 'find dates, times and rooms; keep a reason for each', keycol=WHITE, edge=NAVY, fill=NAVY, ks=15, ds=12)
for p in core.text_frame.paragraphs[1:]:
    for r in p.runs: r.font.color.rgb = WHITE
box(s, 10.85, 1.95, 2.03, 0.95, 'Sure', 'added, with Undo', keycol=GREEN, edge=GREEN, ks=14, ds=12, lw=1.5)
box(s, 10.85, 3.15, 2.03, 0.95, 'Not sure', 'asks you first', keycol=AMBER, edge=AMBER, ks=14, ds=12, lw=1.5)
connector(s, 10.45, 2.9, 10.85, 2.42)
connector(s, 10.45, 3.2, 10.85, 3.62)
box(s, 8.45, 4.55, 2.0, 1.0, 'Clash check', 'two events at once? a deadline in a class?', ks=14, ds=12)
connector(s, 9.45, 3.65, 9.45, 4.55)
box(s, 10.85, 4.55, 2.03, 1.0, 'Calendar', 'Google, phone or .ics file', ks=14, ds=12)
connector(s, 10.45, 5.05, 10.85, 5.05)
text(s, 6.2, 5.75, 6.68, 1.1, ['Dashed boxes need a one-time install: the Gmail script or the Android app.',
                               'Adding the same notice twice ==updates the events==. It does not make copies.'], 13, space=5)

# ---------------------------------------------------------------- 4. scope and feasibility
ACC = PAL['green']
s = S[3]; frame(s, 'SCOPE AND FEASIBILITY')
band(s, 0.45, 1.3, 5.75, 'What is ready')
scope = [('Works now on the website', GREEN, False,
          'Paste or share a notice, a photo or a PDF. Events with reasons, clash check, review before export, .ics file, Hindi and Hinglish times. A class calendar link: the class rep publishes, the class subscribes.'),
         ('Built, needs a one-time install or sign-in', AMBER, True,
          'Google Calendar in one tap (Google sign-in), college email (Gmail script), WhatsApp group reading (Android app), Chrome extension.'),
         ('Next', NAVY, False,
          'Try it with one real class for a term. Read more notice styles. Handle spelling mistakes.')]
for i, (k, col, dashed, d) in enumerate(scope):
    b = box(s, 0.45, 1.88 + i * 1.62, 5.75, 1.45, k, d, keycol=col, edge=col, ks=15, ds=13, lw=1.5)
    if dashed:
        b.line.dash_style = MSO_LINE_DASH_STYLE.DASH
band(s, 6.5, 1.3, 6.38, 'Problems we expect, and our plan')
pairs = [('A long notice is cut off in a phone notification', 'Share or paste the full text'),
         ('Google updates a shared calendar only every 12 to 24 hours', 'One-tap add writes the events at once'),
         ('iPhone does not let apps read WhatsApp', 'On iPhone, paste the notice or use the email script'),
         ('Spelling mistakes ("tset", "Nvo")', 'The date stays empty and export stays locked')]
for i, (risk, fix) in enumerate(pairs):
    y = 1.9 + i * 1.18
    box(s, 6.5, y, 2.85, 0.98, risk, None, keycol=RED, edge=RED, ks=13, lw=1.25)
    connector(s, 9.37, y + 0.49, 9.72, y + 0.49)
    box(s, 9.75, y, 3.13, 0.98, fix, None, keycol=GREEN, edge=GREEN, ks=13, lw=1.25)

# ---------------------------------------------------------------- 5. impact and who pays
ACC = PAL['orange']
s = S[4]; frame(s, 'IMPACT AND WHO PAYS')
band(s, 0.45, 1.3, 6.1, 'Who gains what')
table(s, 0.45, 1.85, 6.1, [1.35, 2.3, 2.45],
      [['Who', 'Today', 'With Notice Decoder'],
       ['Student', 'Reads a long paragraph, misses a date', 'Gets the dates in the calendar; checks only the unsure ones'],
       ['Class rep', 'Forwards every notice by hand', 'Publishes once; the class subscribes once'],
       ['Department', 'Finds clashes too late', 'Sees every clash in the term']], 13, 14, 0.62)
text(s, 0.45, 4.6, 6.1, 2.2, ['**For scale:** Fedena, a full college ERP, lists $999 to $1,699 a year for a whole college. One feature for one department must cost far less.',
                              '**Where we are:** no college has paid yet.'], 14, space=8)
band(s, 6.85, 1.3, 6.03, 'Who pays')
headline(s, 6.85, 1.85, 6.03, 0.95, '₹2,999 per department per year', 'our proposed price; the first term is free', bs=24, ls=14)
text(s, 6.85, 2.95, 6.03, 3.9, ['**Free for students:** everything in "Works now". It runs on the phone, so it costs us about ₹0.',
                                '**Department plan:** the class rep or a teacher publishes notices, and the HOD pays.',
                                '**Why pay?** On WhatsApp, nobody\'s calendar changes when a date changes. With the plan, it changes ==for the whole class==.',
                                '**Pilot:** one department for one term. If the HOD pays for the next term, it works.'], 14, space=9)

# ---------------------------------------------------------------- 6. research and references
ACC = PAL['lavender']
s = S[5]; frame(s, 'RESEARCH AND REFERENCES')
band(s, 0.45, 1.3, 8.2, 'Other notice tools (we read their code, Oct 2026)')
table(s, 0.45, 1.85, 8.2, [4.6, 1.8, 1.8],
      [['Project', 'Calendar file', 'Clash check'],
       ['7 notice tools on GitHub, most send the text to an AI model', '0 of 7', '0 of 7'],
       ['edt-tamis: university timetable files, not notices', 'Yes', 'Yes'],
       ['Notice Decoder', 'Yes', 'Yes, with the reason']], 13, 14, 0.5)
band(s, 0.45, 4.05, 8.2, 'Why the problem is real')
text(s, 0.45, 4.55, 8.2, 2.3, ['**APSIT Mumbai** stopped sharing notices in WhatsApp groups because "many students miss important notices" (e-notice board post, 23 Sep 2025).',
                               '**Jamia Millia Islamia** keeps academic notices in official class groups run by the class rep (Careers360, 9 Sep 2026).',
                               '**St Agnes College, Mangaluru** set semester exams in the Dasara holidays, and students protested (PTI via Careers360, 12 Oct 2026).',
                               '**Price:** **fedena.com/pricing-and-plans**.  **Problem statement:** SETU 2026 Forge Realm PS-02.'], 13, space=6)
LINKS = {'fedena.com/pricing-and-plans': 'https://fedena.com/pricing-and-plans', 'youtu.be/joI75POVTr0': VIDEO,
         'anki1kr.me/NoticeDecoder': LIVE, 'github.com/anki1kr/NoticeDecoder': REPO}
def link_runs(shape):
    # A run whose whole text is a known address becomes a click-through link in the PDF.
    for p in shape.text_frame.paragraphs:
        rs = p.runs
        for r in rs:
            if r.text in LINKS:
                r.hyperlink.address = LINKS[r.text]
        if rs and rs[-1].text in LINKS:
            p.add_run().text = ' '   # a plain run after a closing link keeps PowerPoint's PDF export from dropping it
link_runs(s.shapes[-1])
for i, (url, label) in enumerate([(VIDEO, 'Demo video'), (LIVE, 'Website'), (REPO, 'GitHub')]):
    qr(s, url, 9.2 + i * 1.3, 1.5, 1.1, label)
text(s, 8.95, 3.3, 4.0, 1.6, ['**youtu.be/joI75POVTr0**', '**anki1kr.me/NoticeDecoder**', '**github.com/anki1kr/NoticeDecoder**'], 13, GREY, NAVY, PP_ALIGN.CENTER, space=3)
link_runs(s.shapes[-1])

OUT.parent.mkdir(exist_ok=True)
prs.save(OUT)
print('saved', OUT)
