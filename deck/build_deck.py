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
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'tmp' / 'deck'
OUT = Path(os.environ.get('DECK_OUT', ROOT / 'deck' / 'NoticeDecoder_NovaNexus_PS02.pptx'))  # DECK_OUT: preview path while the deck is open
LIVE = 'https://anki1kr.me/NoticeDecoder/'
SKILL = Path.home() / '.claude' / 'skills' / 'sih-deck'
TEMPLATE = SKILL / 'assets' / 'SIH2026-IDEA-Presentation-Format.pptx'
sys.path.insert(0, str(SKILL / 'scripts'))
import _env  # noqa: E402,F401  (the skill's own copy of segno)
import segno  # noqa: E402
from deck_lib import heading_band  # noqa: E402

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
    path = SHOTS / 'qr-live.png'
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
            set_text(sh, '@SETU 2026  PS-02 Idea Submission')
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
                  ('Realm – ', 'Forge Realm'), ('Category – ', 'Software (web + Android)'),
                  ('Team Name – ', 'Nova Nexus'), ('Members – ', 'Ankit Kumar (Leader), Ankit, Ashwani Tanwar')]
        for q, (lab, val) in zip(lines, values):
            first = q.runs[0]
            for r in q.runs[1:]:
                r._r.getparent().remove(r._r)
            first.text = lab; first.font.size = Pt(18)
            r = q.add_run(); r.text = val; r.font.size = Pt(18); r.font.bold = False
            q.alignment = PP_ALIGN.LEFT
text(s, 0.5, 1.95, 7.0, 0.6, 'A notice lands in the class group. It is in your calendar before you open the chat.', 16, GREY)
s.shapes[-1].text_frame.paragraphs[0].runs[0].font.italic = True
ph = shot(s, SHOTS / 'phone-results-crop.png', 7.75, 1.45, 2.55)
qr(s, LIVE, 10.75, 2.2, 1.75, 'Live demo')
text(s, 10.35, 4.6, 2.6, 0.9, 'Scan to open the working app on your phone.', 13, GREY, align=PP_ALIGN.CENTER)
text(s, 10.4, 0.25, 2.75, 0.4, 'Forge Realm  |  PS-02', 14, GREY, align=PP_ALIGN.RIGHT)

# ---------------------------------------------------------------- 2. the idea
ACC = PAL['yellow']
s = S[1]; frame(s, 'NOTICE DECODER')
band(s, 0.45, 1.3, 12.43, 'Proposed solution')
text(s, 0.45, 1.78, 12.43, 0.5, '**Paste, share or auto-read** a college notice. It becomes ==calendar events==, **clashes** are found, and the student is asked only about an ==uncertain field==.', 15)
sh_h = shot(s, SHOTS / 'shot-solution.png', 0.95, 2.45, 6.6,
            pins=[(1, (PART_Y[0] + 51) / comp.height), (2, (PART_Y[1] + 330) / comp.height), (3, (PART_Y[2] + 190) / comp.height)])
text(s, 0.55, 2.55 + sh_h, 7.0, 0.4, '**1** The answer first      **2** Highlighter shows the source words      **3** One clean line per event', 13)
band(s, 7.85, 2.45, 5.03, 'How it addresses the problem')
text(s, 7.85, 2.95, 5.03, 1.5, ['**Every field shows why:** the exact words it came from.',
                                '**Clash check:** overlap, and a deadline that falls inside another event.',
                                '**One tap** to Google Calendar; .ics and a class link as backups.'], 14, space=5)
band(s, 7.85, 4.45, 5.03, 'Innovation and uniqueness')
text(s, 7.85, 4.95, 5.03, 1.1, ['**Plain rules on the phone**, no AI: same answer every time, the notice never leaves the device.',
                                '**Asks, never guesses:** "Thursday, but 13 Nov 2026 is a Friday."'], 14, space=5)
headline(s, 7.85, 6.05, 5.03, 0.78, '3 of 3 events right', 'and both clashes found on the PS-02 example', bs=20, ls=13)

# ---------------------------------------------------------------- 3. technical approach
ACC = PAL['blue']
s = S[2]; frame(s, 'TECHNICAL APPROACH')
band(s, 0.45, 1.3, 5.45, 'Technologies used')
text(s, 0.45, 1.85, 5.45, 3.6, ['**Engine:** plain JavaScript rules; runs in the browser. No server, no AI model.',
                                '**Inputs:** paste or share (installable web app), photos and PDFs read on the device, a Gmail Apps Script, an Android companion app.',
                                '**Calendar:** .ics file (India time, reminders), Google Calendar in one tap, a class feed on a free Cloudflare Worker.',
                                f'**Tests on every push:** {N_ENGINE} engine, {N_WORKER} feed, {N_GMAIL} Gmail, {N_APP} app tests; {N_BROWSER} browser checks.'], 14, space=10)
text(s, 0.45, 5.55, 5.45, 1.2, ['**One engine everywhere:** the web app, the Gmail script and the Android app run the same bundled rules file.'], 14)
band(s, 6.2, 1.3, 6.68, 'Methodology')
ins = ['Paste or share', 'Photo or PDF', 'College email', 'WhatsApp group']
for i, (k, c) in enumerate(zip(ins, ('yellow', 'pink', 'orange', 'green'))):
    box(s, 6.2, 1.95 + i * 0.75, 1.75, 0.6, k, None, keycol=INK, edge=PAL[c]['ink'], fill=PAL[c]['mark'], ks=13, center=True, lw=1.25)
    connector(s, 7.95, 2.25 + i * 0.75, 8.45, 3.05)
core = box(s, 8.45, 2.45, 2.0, 1.2, 'Rules engine', 'dates, times, rooms; a reason for every field', keycol=WHITE, edge=NAVY, fill=NAVY, ks=15, ds=12)
for p in core.text_frame.paragraphs[1:]:
    for r in p.runs: r.font.color.rgb = WHITE
box(s, 10.85, 1.95, 2.03, 0.95, 'Nothing uncertain', 'added, with Undo', keycol=GREEN, edge=GREEN, ks=13, ds=12, lw=1.5)
box(s, 10.85, 3.15, 2.03, 0.95, 'An amber field', 'asks only for that one', keycol=AMBER, edge=AMBER, ks=13, ds=12, lw=1.5)
connector(s, 10.45, 2.9, 10.85, 2.42)
connector(s, 10.45, 3.2, 10.85, 3.62)
box(s, 8.45, 4.55, 2.0, 1.0, 'Clash check', 'overlap; a deadline is a point', ks=14, ds=12)
connector(s, 9.45, 3.65, 9.45, 4.55)
box(s, 10.85, 4.55, 2.03, 1.0, 'Calendar', 'Google, phone, class feed, .ics', ks=14, ds=12)
connector(s, 10.45, 5.05, 10.85, 5.05)
text(s, 6.2, 5.8, 6.68, 1.0, ['Re-adding a notice ==updates== the same calendar events instead of copying them (one ID per event).'], 14)

# ---------------------------------------------------------------- 4. feasibility
ACC = PAL['green']
s = S[3]; frame(s, 'FEASIBILITY AND VIABILITY')
band(s, 0.45, 1.3, 5.6, 'Works today')
shot(s, SHOTS / 'phone-amber-top.png', 0.45, 1.85, 2.35)
for i, (k, d) in enumerate([('Live now', 'anki1kr.me/NoticeDecoder'),
                            ('Tested', f'{N_ENGINE + N_WORKER + N_GMAIL + N_APP} tests, {N_BROWSER} browser checks, {N_NOTICES} real notices'),
                            ('₹0 per notice', 'runs on the phone; the class feed fits a free tier')]):
    box(s, 3.0, 1.85 + i * 1.12, 3.05, 0.98, '✓ ' + k, d, keycol=GREEN, edge=GREEN, ks=15, ds=13, lw=1.25)
text(s, 3.0, 5.3, 3.05, 1.5, 'Left: a doubtful date is outlined in amber; export waits until it is fixed or marked "Looks right".', 13, GREY)
band(s, 6.35, 1.3, 6.53, 'Challenges and how we handle them')
pairs = [('Long notice cut off in a notification', 'Share or paste reads the full text'),
         ('Google refreshes a subscribed feed every 12 to 24 h', 'One-tap add writes events at once'),
         ('Reading WhatsApp needs Android (iOS blocks it)', 'On iPhone: paste, or the Gmail script'),
         ('Spelling mistakes ("tset", "Nvo")', 'Date stays empty; export stays locked')]
for i, (risk, fix) in enumerate(pairs):
    y = 1.9 + i * 1.18
    box(s, 6.35, y, 2.85, 0.98, risk, None, keycol=RED, edge=RED, ks=13, lw=1.25)
    connector(s, 9.22, y + 0.49, 9.62, y + 0.49)
    box(s, 9.65, y, 3.23, 0.98, fix, None, keycol=GREEN, edge=GREEN, ks=13, lw=1.25)

# ---------------------------------------------------------------- 5. impact and who pays
ACC = PAL['orange']
s = S[4]; frame(s, 'IMPACT AND WHO PAYS')
band(s, 0.45, 1.3, 6.1, 'Who gains what')
table(s, 0.45, 1.85, 6.1, [1.35, 2.3, 2.45],
      [['Who', 'Today', 'With Notice Decoder'],
       ['Student', 'Reads a paragraph, misses a date', 'Events in the calendar; checks only amber fields'],
       ['Class rep', 'Forwards every notice by hand', 'Publishes once; the class subscribes once'],
       ['Department', 'Clashes found too late', 'A clash report across the term']], 13, 14, 0.62)
text(s, 0.45, 4.6, 6.1, 2.2, ['**For scale:** Fedena, a full college ERP, lists $999 to $1,699 a year for a whole college, so one feature for one department must cost far less.',
                              '**Honest status:** no college has paid yet.'], 14, space=8)
band(s, 6.85, 1.3, 6.03, 'Business model')
headline(s, 6.85, 1.85, 6.03, 0.95, '₹2,999 per department per year', 'proposed price; the first term is free', bs=24, ls=14)
text(s, 6.85, 2.95, 6.03, 3.9, ['**Free for every student:** paste, share or auto-read; clashes; Google Calendar, .ics, class link. Costs us about ₹0.',
                                '**Department plan:** the class rep or a teacher publishes; the HOD signs off. One free-tier Worker and storage.',
                                '**Why pay when WhatsApp is free?** Nobody\'s calendar moves when a date changes; the plan ==moves it for everyone== and catches term-wide clashes.',
                                '**Pilot:** one department, one term; it works if the HOD pays for the next term.'], 14, space=9)

# ---------------------------------------------------------------- 6. research and references
ACC = PAL['lavender']
s = S[5]; frame(s, 'RESEARCH AND REFERENCES')
band(s, 0.45, 1.3, 8.2, 'Other notice tools: we read their code (Oct 2026)')
table(s, 0.45, 1.85, 8.2, [4.6, 1.8, 1.8],
      [['Project', 'Calendar file', 'Clash check'],
       ['7 public notice tools on GitHub, most send text to an AI model', '0 of 7', '0 of 7'],
       ['edt-tamis: university timetable files, not notices', 'Yes', 'Yes'],
       ['Notice Decoder', 'Yes', 'Yes, with the reason']], 13, 14, 0.5)
band(s, 0.45, 4.05, 8.2, 'Why the problem is real')
text(s, 0.45, 4.55, 8.2, 2.3, ['**APSIT Mumbai** moved notices out of WhatsApp groups: "many students miss important notices" (e-notice board post, 23 Sep 2025).',
                               '**Jamia Millia Islamia** keeps academic notices in official class groups run by the class representative (Careers360, 9 Sep 2026).',
                               '**St Agnes College, Mangaluru** set semester exams in the Dasara holidays; students protested (PTI via Careers360, 12 Oct 2026).',
                               '**Price anchor:** fedena.com/pricing-and-plans.  **Problem statement:** SETU 2026 Forge Realm PS-02.'], 13, space=6)
qr(s, LIVE, 9.55, 1.6, 2.4, 'Live demo')
text(s, 9.05, 4.5, 3.4, 1.2, ['**anki1kr.me/NoticeDecoder**', 'Works in any browser; nothing to install.'], 13, GREY, NAVY, PP_ALIGN.CENTER)

OUT.parent.mkdir(exist_ok=True)
prs.save(OUT)
print('saved', OUT)
