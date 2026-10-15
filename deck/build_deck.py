# Builds deck/NoticeDecoder_NovaNexus_PS02.pptx (+ .pdf via LibreOffice when present): six native, editable slides in
# the SETU 2026 PS-02 look (royal-blue banner, navy table heads, the PDF's own red/green clash words).
# Numbers are read from real test runs, never typed. Screenshots come from the live app (tools/deck-shots.mjs).
# Run from the project root with the app served on :8771:
#   node tools/deck-shots.mjs && python deck/build_deck.py
import os
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'tmp' / 'deck'
OUT = ROOT / 'deck' / 'NoticeDecoder_NovaNexus_PS02.pptx'
LIVE = 'https://anki1kr.me/NoticeDecoder/app/'
try:
    import segno
except ImportError:
    sys.exit('pip install segno (QR code for the live link)')

BLUE = RGBColor(0x00, 0x33, 0xEE)      # PS-02 banner in the SETU PDF
NAVY = RGBColor(0x02, 0x01, 0x29)      # table heads in the SETU PDF
INK = RGBColor(0x22, 0x22, 0x2E)
GREY = RGBColor(0x5E, 0x60, 0x70)
LINE = RGBColor(0xD5, 0xD8, 0xE3)
PALE = RGBColor(0xEE, 0xF2, 0xFF)      # pale of the banner blue
RED = RGBColor(0xC6, 0x1F, 0x1F)
GREEN = RGBColor(0x15, 0x7A, 0x3A)
AMBER = RGBColor(0xB4, 0x53, 0x09)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
FONT = 'Arial'


# ---------------------------------------------------------------- numbers from real runs
def run(*cmd, cwd=ROOT, env=None):
    e = dict(os.environ)
    if env:
        e.update(env)
    # utf-8: the test output contains Hindi notices, which Windows' cp1252 console encoding cannot decode
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
for f in ('summary.png', 'notice.png', 'rows.png', 'export.png', 'phone-amber.png'):
    if not (SHOTS / f).exists():
        sys.exit(f'missing {SHOTS / f}: run node tools/deck-shots.mjs with the app served on :8771')
# Composite for slide 3 (answer line + notice + rows, stacked) and the crops the slides use.
parts = [Image.open(SHOTS / f'{n}.png') for n in ('summary', 'notice', 'rows')]
gap = 28
comp = Image.new('RGB', (max(p.width for p in parts), sum(p.height for p in parts) + gap * 2), (239, 238, 242))
ypos, PART_Y = 0, []
for p in parts:
    comp.paste(p, (0, ypos)); PART_Y.append(ypos); ypos += p.height + gap
comp.save(SHOTS / 'shot-solution.png')
ex = Image.open(SHOTS / 'export.png'); ex.crop((0, 0, ex.width, int(ex.height * 0.56))).save(SHOTS / 'export-top.png')
am = Image.open(SHOTS / 'phone-amber.png'); am.crop((0, int(am.height * 0.025), am.width, int(am.height * 0.2))).save(SHOTS / 'phone-amber-top.png')
print(f'engine {N_ENGINE}, worker {N_WORKER}, gmail {N_GMAIL}, companion {N_APP}, browser {N_BROWSER}, notices {N_NOTICES}')


# ---------------------------------------------------------------- helpers
prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
BLANK = prs.slide_layouts[6]


def runs(p, text, size, color=INK, hl=BLUE, bold_all=False):
    """**word** becomes bold in `hl`, so a judge reading only the bold words gets the line."""
    for k, part in enumerate(text.split('**')):
        if not part:
            continue
        r = p.add_run(); r.text = part
        f = r.font; f.name = FONT; f.size = Pt(size)
        f.bold = bool(k % 2) or bold_all
        f.color.rgb = hl if k % 2 else color


def text(slide, x, y, w, h, lines, size=16, color=INK, hl=BLUE, align=PP_ALIGN.LEFT, space=6, anchor=MSO_ANCHOR.TOP, bold_all=False):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = True; tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Inches(0.05); tf.margin_top = tf.margin_bottom = Inches(0.03)
    for i, line in enumerate([lines] if isinstance(lines, str) else lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align; p.space_after = Pt(space)
        runs(p, line, size, color, hl, bold_all)
    return tb


def rect(slide, x, y, w, h, fill, line=None, shape=MSO_SHAPE.RECTANGLE, radius=None):
    s = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if radius is not None:
        s.adjustments[0] = radius
    s.fill.solid(); s.fill.fore_color.rgb = fill
    if line:
        s.line.color.rgb = line; s.line.width = Pt(1)
    else:
        s.line.fill.background()
    s.shadow.inherit = False
    return s


def card(slide, x, y, w, h, key, detail, keycol=BLUE, fill=WHITE, ks=15, ds=13, line=LINE):
    """White box with a thin border: bold key line on top, one plain line under it."""
    s = rect(slide, x, y, w, h, fill, line, MSO_SHAPE.ROUNDED_RECTANGLE, 0.06)
    tf = s.text_frame; tf.word_wrap = True; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.margin_left = tf.margin_right = Inches(0.14); tf.margin_top = tf.margin_bottom = Inches(0.06)
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.LEFT; runs(p, key, ks, keycol, keycol, bold_all=True)
    if detail:
        p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.LEFT; p2.space_before = Pt(3); runs(p2, detail, ds, INK)
    return s


def number(slide, x, y, w, h, big, label, col=BLUE, bs=30):
    s = rect(slide, x, y, w, h, PALE, None, MSO_SHAPE.ROUNDED_RECTANGLE, 0.08)
    tf = s.text_frame; tf.word_wrap = True; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.margin_left = tf.margin_right = Inches(0.12)
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER; runs(p, big, bs, col, col, bold_all=True)
    p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.CENTER; runs(p2, label, 13, INK)
    return s


def arrow(slide, x, y, w=0.34, h=0.3, down=False):
    a = slide.shapes.add_shape(MSO_SHAPE.DOWN_ARROW if down else MSO_SHAPE.RIGHT_ARROW, Inches(x), Inches(y), Inches(w), Inches(h))
    a.fill.solid(); a.fill.fore_color.rgb = RGBColor(0x9A, 0xA3, 0xC4); a.line.fill.background(); a.shadow.inherit = False


def qr_code(slide, url, x, y, size):
    """QR made from the link itself, so it cannot point anywhere else; clickable in the PDF too."""
    path = SHOTS / 'qr-live.png'
    segno.make(url, error='m').save(str(path), scale=12, border=2)
    pic = slide.shapes.add_picture(str(path), Inches(x), Inches(y), Inches(size), Inches(size))
    pic.line.color.rgb = LINE; pic.line.width = Pt(0.75)
    pic.click_action.hyperlink.address = url


def pin(slide, x, y, n):
    c = rect(slide, x, y, 0.36, 0.36, BLUE, WHITE, MSO_SHAPE.OVAL)
    c.line.width = Pt(2)
    tf = c.text_frame; tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER; runs(p, str(n), 13, WHITE, WHITE, bold_all=True)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE


def shot(slide, path, x, y, w=None, h=None, pins=None):
    """Screenshot with a thin frame; pins are (n, fx, fy): fractions of the picture's width and height."""
    img = Image.open(path)
    if w is None:
        w = h * img.width / img.height
    pic = slide.shapes.add_picture(str(path), Inches(x), Inches(y), width=Inches(w))
    pic.line.color.rgb = LINE; pic.line.width = Pt(1)
    ph = pic.height / 914400
    for n, fx, fy in pins or []:
        pin(slide, x + fx * w - 0.18, y + fy * ph - 0.18, n)
    return ph


def table(slide, x, y, w, col_w, rows, size=12, head_size=13):
    shp = slide.shapes.add_table(len(rows), len(rows[0]), Inches(x), Inches(y), Inches(w), Inches(0.4 * len(rows)))
    t = shp.table
    for j, cw in enumerate(col_w):
        t.columns[j].width = Inches(cw)
    for i, row in enumerate(rows):
        for j, val in enumerate(row):
            c = t.cell(i, j); c.margin_left = c.margin_right = Inches(0.08); c.margin_top = c.margin_bottom = Inches(0.04)
            c.fill.solid(); c.fill.fore_color.rgb = NAVY if i == 0 else (WHITE if i % 2 else RGBColor(0xF6, 0xF7, 0xFB))
            tf = c.text_frame; tf.word_wrap = True
            p = tf.paragraphs[0]
            if i == 0:
                runs(p, val, head_size, WHITE, WHITE, bold_all=True)
            else:
                runs(p, val or ' ', size, INK)
    return shp


def frame(n, title, kicker=None):
    """SETU page chrome: top tag line, numbered heading like the PDF ("01 Problem Statement"), footer."""
    s = prs.slides.add_slide(BLANK)
    text(s, 0.55, 0.22, 6, 0.32, '**SETU 2026**  Forge Realm', 12, GREY, INK)
    text(s, 6.8, 0.22, 6.0, 0.32, '**PS-02  NOTICE DECODER**', 12, BLUE, BLUE, PP_ALIGN.RIGHT)
    if title:
        text(s, 0.55, 0.6, 12.2, 0.7, f'**{n:02d}**  {title}', 28, NAVY, BLUE, bold_all=True)
        if kicker:
            text(s, 0.6, 1.22, 12.1, 0.4, kicker, 15, GREY, BLUE)
    rect(s, 0, 7.12, 13.333, 0.38, NAVY)
    text(s, 0.55, 7.15, 9, 0.32, 'Team **Nova Nexus**   |   SETU 2026 Forge Realm   |   PS-02 Notice Decoder', 12, WHITE, WHITE)
    text(s, 11.9, 7.15, 0.9, 0.32, str(len(prs.slides)), 12, WHITE, WHITE, PP_ALIGN.RIGHT)
    return s


# ---------------------------------------------------------------- 1. title
s = frame(0, None)
rect(s, 0.55, 0.75, 12.23, 2.55, BLUE, None, MSO_SHAPE.ROUNDED_RECTANGLE, 0.07)
text(s, 0.95, 0.98, 11, 0.35, '**FORGE REALM  PS-02**', 14, WHITE, WHITE)
text(s, 0.95, 1.35, 11, 1.0, '**Notice Decoder**', 54, WHITE, WHITE)
text(s, 0.95, 2.45, 11.4, 0.6, 'A notice lands in the class group. It is in your calendar before you open the chat.', 20, WHITE, WHITE)
text(s, 0.55, 3.6, 7.6, 0.5, 'Team **Nova Nexus**', 24, NAVY, NAVY)
text(s, 0.55, 4.12, 7.6, 0.5, '**Ankit Kumar** (Team Leader),  **Ankit**,  **Ashwani Tanwar**', 16, INK, NAVY)
text(s, 0.55, 4.75, 7.7, 2.1, ['**Rules that show their reasons.** Every date, time and place points to the exact words it came from.',
                                '**Zero-touch.** WhatsApp group, college email or the share sheet feed the same rules; certain events go straight into the calendar, the student is asked only about an uncertain field.',
                                '**Runs on the device:** offline, the notice never leaves the phone, **₹0** per notice.'], 15, INK, BLUE, space=7)
number(s, 8.55, 3.62, 2.05, 1.5, '3 of 3', 'events right on the PS-02 example')
number(s, 10.73, 3.62, 2.05, 1.5, f'{N_BROWSER} of {N_BROWSER}', 'browser checks pass at phone width', bs=26)
qr_code(s, LIVE, 8.75, 5.22, 1.45)
text(s, 10.35, 5.3, 2.5, 1.4, ['**Live demo**', 'Scan, or open:'], 14, INK, NAVY, space=2)
link = s.shapes[-1].text_frame.add_paragraph()
r = link.add_run(); r.text = 'anki1kr.me/NoticeDecoder/app'; r.hyperlink.address = LIVE
r.font.name, r.font.size, r.font.bold, r.font.color.rgb = FONT, Pt(13), True, BLUE
link.add_run().text = ' '   # a plain run after the link keeps PowerPoint's PDF export from dropping it

# ---------------------------------------------------------------- 2. problem + the PS-02 answer
s = frame(1, 'The problem, and the PS-02 example answered', 'Dates, times and rooms hide inside paragraphs. Students miss them, or find the clash too late.')
rect(s, 0.55, 1.75, 5.9, 3.5, WHITE, LINE)
text(s, 0.75, 1.85, 5.5, 0.4, '**NOTICE**', 14, INK, INK, PP_ALIGN.CENTER)
nt = text(s, 0.8, 2.3, 5.45, 2.9, '', 16, INK)
runs(nt.text_frame.paragraphs[0], (ROOT / 'examples' / '01-pdf-sample.txt').read_text(encoding='utf-8').strip(), 16, INK)
card(s, 0.55, 5.4, 2.85, 1.5, 'Students miss notices', 'APSIT Mumbai pulled notices out of WhatsApp groups: "many students miss important notices".', keycol=NAVY, ks=13, ds=12)
card(s, 3.6, 5.4, 2.85, 1.5, 'The class rep carries them', 'Jamia keeps academic notices in official class groups run by the class representative.', keycol=NAVY, ks=13, ds=12)
rows = [['Detected event', 'Type', 'Date', 'Time', 'Venue'],
        ['Internal Test 2', 'Test', '13 Nov 2026', '10:00 AM – 11:30 AM', 'Room 204'],
        ['Lab record submission', 'Deadline', '13 Nov 2026', 'by 12:00 PM', 'Department office'],
        ['Guest lecture: AI in Healthcare', 'Lecture', '13 Nov 2026', '11:00 AM – 12:30 PM', 'Seminar Hall']]
table(s, 6.8, 1.75, 5.98, [2.0, 0.85, 1.0, 1.18, 0.95], rows, 11, 12)
for i, (k, d, col) in enumerate([('Clash: 30 minutes', 'Test and guest lecture overlap 11:00 to 11:30 AM.', RED),
                                 ('Clash: deadline inside', 'The 12:00 PM deadline falls during the lecture.', RED),
                                 ('No clash', 'The test ends at 11:30 AM, before the deadline.', GREEN)]):
    card(s, 6.8, 3.75 + i * 0.86, 5.98, 0.76, k, d, keycol=col, ks=13, ds=12)
card(s, 6.8, 6.38, 5.98, 0.55, 'Action: finish the lab record before 10:00 AM, or ask the coordinator about the lecture.', None, keycol=NAVY, fill=PALE, ks=12, line=None)

# ---------------------------------------------------------------- 3. solution
s = frame(2, 'Our solution', 'The real app on the PS-02 example. The answer first, a reason for every field, a form only where there is a doubt.')
sol = Image.open(SHOTS / 'shot-solution.png')
sw, shh = sol.size
pins = [(1, 0.985, (PART_Y[0] + 52) / shh), (2, 0.985, (PART_Y[1] + 300) / shh), (3, 0.985, (PART_Y[2] + 60) / shh), (4, 0.955, (PART_Y[2] + 300) / shh)]
shot(s, SHOTS / 'shot-solution.png', 0.55, 1.75, w=7.7, pins=pins)
legend = [('1', 'One-line answer first', '3 events found. 2 clashes. Nothing to check.'),
          ('2', 'Highlighter colours', 'Each event\'s words in the notice, in its own colour; "Show in notice" lights them up.'),
          ('3', 'Clean events are one line', 'Nothing to fill in. Edit opens the full card if you want it.'),
          ('4', 'Only doubts open a form', 'An amber field blocks export until fixed or marked "Looks right".'),
          ('5', 'One tap to the calendar', '"Add all to Google Calendar" writes them in; .ics and the class link stay as backups.')]
for i, (n, k, d) in enumerate(legend):
    y = 1.75 + i * 0.84
    pin(s, 8.55, y + 0.06, n)
    text(s, 9.0, y, 3.85, 0.8, [f'**{k}**', d], 12.5, INK, NAVY, space=1)
shot(s, SHOTS / 'export-top.png', 8.55, 6.0, w=4.25, pins=[(5, 0.4, 0.6)])

# ---------------------------------------------------------------- 4. zero-touch
s = frame(3, 'Zero-touch: four ways in, one engine', 'Pasting was three steps too many. The student is asked only for the one field that is uncertain.')
ways = [('WhatsApp class group', 'Android companion reads the group\'s notifications, decodes on the phone, writes the phone calendar.'),
        ('College email', 'Apps Script in the student\'s own Gmail, every 15 min, straight into Google Calendar.'),
        ('Share or paste', 'Installed web app sits in WhatsApp\'s share sheet; decodes on arrival; one tap to Google Calendar.'),
        ('Class rep publishes', 'The class subscribes once to a calendar link that updates itself when a notice is revised.')]
for i, (k, d) in enumerate(ways):
    card(s, 0.55, 1.8 + i * 1.08, 4.3, 0.96, k, d, keycol=BLUE, ks=14, ds=12)
arrow(s, 5.0, 3.75, 0.4, 0.34)
rect(s, 5.55, 2.6, 2.6, 2.6, BLUE, None, MSO_SHAPE.ROUNDED_RECTANGLE, 0.08)
text(s, 5.7, 2.75, 2.3, 2.3, ['**Same rules engine**', 'Dates, times, venues, clashes, a "why" for every field. One mapping to calendar UIDs, so adding twice updates, never duplicates.'], 12.5, WHITE, WHITE, space=5)
arrow(s, 8.3, 3.75, 0.4, 0.34)
card(s, 8.85, 1.8, 3.93, 1.5, 'Nothing uncertain → added, with Undo', 'Notification: "Added 3 events". Google Calendar, the phone calendar or the class feed.', keycol=GREEN, ks=14, ds=12)
card(s, 8.85, 3.45, 3.93, 1.5, 'An amber field → ask for that one only', '"Thursday, but 13 Nov 2026 is a Friday." Looks right, or fix it. PS-02\'s review rule, kept.', keycol=AMBER, ks=14, ds=12)
shot(s, SHOTS / 'phone-amber-top.png', 8.85, 5.1, w=3.93)
text(s, 0.55, 6.2, 7.6, 0.85, ['**Honest limits:** a notification can truncate a very long notice (the share sheet is the fallback); Google refreshes subscribed feeds in 12 to 24 hours; the companion app is Android only.'], 12.5, INK, NAVY)

# ---------------------------------------------------------------- 5. real notices, tested
s = frame(4, 'Rules for real notices, tested', 'Written for the way Indian college notices are really written. Each line below is a test that runs on every push.')
pairs = [('"04/05/2027"', 'Day first, 4 May; asks if it means 5 April'),
         ('"Thursday, 13 Nov 2026"', '13 Nov is a Friday: asks which one is right'),
         ('"today\'s drive" + "Date: 05 Oct"', '"today" is the notice\'s date, not paste day'),
         ('Two exams, both at 10 AM', 'Two events and a clash, never one merged card'),
         ('"POSTPONED to 20 Nov"', 'Moves the event, shows the old date'),
         ('"13 Nov - DBMS - 10 AM to 1 PM - Room 101"', 'Timetable rows: subject, kind, room'),
         ('"available 1:30pm-5pm, 60 min"', 'A window: "take it 1:30 to 2:30 PM", not a clash'),
         ('"7/10 marks", "Unit 3/4"', 'Not dates. "2026-11-20", "0700 hrs", "by EOD" are'),
         ('"this week or next week"', 'Not scheduled yet; never a made-up date'),
         ('गणित की परीक्षा 13 नवंबर सुबह 10 बजे', 'Hindi months, times, event words and rooms')]
for i, (k, d) in enumerate(pairs):
    col, r = i % 2, i // 2
    card(s, 0.55 + col * 4.1, 1.8 + r * 0.86, 3.95, 0.76, k, d, keycol=NAVY, ks=12.5, ds=11.5)
number(s, 8.85, 1.8, 1.9, 1.3, f'{N_ENGINE}', 'engine tests', bs=28)
number(s, 10.88, 1.8, 1.9, 1.3, f'{N_BROWSER}', 'browser checks', bs=28)
number(s, 8.85, 3.25, 1.9, 1.3, f'{N_WORKER}+{N_GMAIL}+{N_APP}', 'feed, Gmail, app tests', bs=24)
number(s, 10.88, 3.25, 1.9, 1.3, f'{N_NOTICES}', 'real notices as fixtures', bs=28)
card(s, 8.85, 4.75, 3.93, 1.35, 'Why rules, not AI', 'Same answer every time, a reason for every field, nothing sent anywhere, ₹0 per notice. Seven public notice tools we read send the text to a model and check no clashes.', keycol=NAVY, fill=PALE, ks=13, ds=11.5, line=None)
text(s, 0.55, 6.2, 12.2, 0.8, ['**Not done yet:** photos of notices, spelling mistakes ("tset", "Nvo" leave the date empty and keep export locked), iPhone notification reading (iOS does not allow it).'], 12.5, INK, NAVY)

# ---------------------------------------------------------------- 6. who pays
s = frame(5, 'Who pays', 'Free for every student. The department pays for the class calendar that saves the class rep\'s time.')
rows = [['Plan', 'Who uses it', 'Who pays', 'What they get', 'Our cost'],
        ['Free', 'Every student', 'Nobody', 'Paste, share or auto-read from a group; check only amber fields; clashes; Google Calendar one tap, .ics, class link', 'About ₹0: runs on the phone'],
        ['Department plan', 'Class rep or teacher', 'Department; HOD signs off', 'Publish once; the class subscribes once; the calendar updates itself when a notice is revised; clash report across the term', 'One free-tier Worker and storage']]
table(s, 0.55, 1.8, 12.23, [1.7, 1.8, 2.0, 4.73, 2.0], rows, 12, 13)
number(s, 0.55, 3.85, 3.3, 1.6, '₹2,999', 'per department per year (proposed), first term free')
card(s, 4.05, 3.85, 4.25, 1.6, 'Why pay when WhatsApp is free?', 'Today the class rep forwards every notice by hand and nobody\'s calendar moves when a date changes. The plan publishes once, moves it for everyone, and catches term-wide clashes.', keycol=NAVY, ds=12)
card(s, 8.5, 3.85, 4.28, 1.6, 'Pilot: one department, one term', 'Count notices published and clashes caught. It works if the HOD pays for the next term. The free link version already works today.', keycol=NAVY, ds=12)
text(s, 0.55, 5.7, 12.23, 1.3, ['**For scale:** Fedena, a full college ERP, lists $999 to $1,699 a year for a whole college, so one feature for one department must cost far less.',
                                 f'**Honest status:** no college has paid yet. Built and tested: web app, class feed, Gmail script, Android companion; {N_ENGINE} + {N_WORKER} + {N_GMAIL} + {N_APP} engine and integration tests, {N_BROWSER} browser checks, CI on every push.'], 14, INK, NAVY, space=8)

OUT.parent.mkdir(exist_ok=True)
prs.save(OUT)
print('saved', OUT)
soffice = Path('C:/Program Files/LibreOffice/program/soffice.exe')
if soffice.exists():
    subprocess.run([str(soffice), '--headless', '--convert-to', 'pdf', '--outdir', str(OUT.parent), str(OUT)], capture_output=True)
    print('saved', OUT.with_suffix('.pdf'))
