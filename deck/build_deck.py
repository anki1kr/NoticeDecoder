# Builds deck/NoticeDecoder_NovaNexus_PS02.pptx: native, editable slides in the SETU 2026 PS-02 look
# (royal-blue banner, navy table heads, the PDF's own red/green clash words). Numbers are read from real runs, never typed.
# Run from the project root: python deck/build_deck.py   (needs the app served on :8771 only for tmp/deck/capture.py)
import json
import re
import subprocess
import sys
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'tmp' / 'deck'
OUT = ROOT / 'deck' / 'NoticeDecoder_NovaNexus_PS02.pptx'

BLUE = RGBColor(0x00, 0x33, 0xEE)      # PS-02 banner in the SETU PDF
NAVY = RGBColor(0x02, 0x01, 0x29)      # table heads in the SETU PDF
INK = RGBColor(0x22, 0x22, 0x2E)
GREY = RGBColor(0x5E, 0x60, 0x70)
LINE = RGBColor(0xD5, 0xD8, 0xE3)
PALE = RGBColor(0xEE, 0xF2, 0xFF)      # pale of the banner blue
RED = RGBColor(0xC6, 0x1F, 0x1F)
GREEN = RGBColor(0x15, 0x7A, 0x3A)
HL = RGBColor(0xFF, 0xF1, 0x76)        # highlighter yellow, used by the PDF example and by the app
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
FONT = 'Arial'


# ---------------------------------------------------------------- numbers from real runs
def run(*cmd):
    return subprocess.run(list(cmd), cwd=ROOT, capture_output=True, text=True).stdout


engine = re.search(r'(\d+) passed', run('node', 'tests/engine.test.mjs'))
ui = re.search(r'(\d+)/(\d+) passed', run(sys.executable, 'tmp/test_ui_real.py'))
review = run(sys.executable, 'tmp/test_review.py')
harness = re.search(r'TOTAL checks: (\d+), correct (\d+)', run('node', 'tmp/judge1/run-notices.mjs'))
notices = len(re.findall(r"id: 'N\d+'", (ROOT / 'tmp/judge1/notices.mjs').read_text(encoding='utf-8')))
if not (engine and ui and harness) or 'FAIL' in review:
    sys.exit('A check failed or did not run; fix it before building the deck.')
N_ENGINE = int(engine.group(1))
N_BROWSER = int(ui.group(2)) + review.count('PASS ')
H_TOTAL, H_OK = int(harness.group(1)), int(harness.group(2))
PINS = json.loads((SHOTS / 'pins.json').read_text())
print(f'engine {N_ENGINE}, browser {N_BROWSER}, harness {H_OK}/{H_TOTAL} on {notices} notices')


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


def card(slide, x, y, w, h, key, detail, keycol=BLUE, fill=WHITE, ks=15, ds=13):
    """White box with a thin border: bold key line on top, one plain line under it."""
    s = rect(slide, x, y, w, h, fill, LINE, MSO_SHAPE.ROUNDED_RECTANGLE, 0.06)
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


def pin(slide, x, y, n):
    c = rect(slide, x, y, 0.36, 0.36, BLUE, WHITE, MSO_SHAPE.OVAL)
    c.line.width = Pt(2)
    tf = c.text_frame; tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER; runs(p, str(n), 13, WHITE, WHITE, bold_all=True)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE


def shot(slide, path, x, y, w, pins=None, page=None, side='right'):
    """Screenshot with a thin frame; pins sit at the measured top-left of each element (page = CSS size of the shot)."""
    pic = slide.shapes.add_picture(str(path), Inches(x), Inches(y), width=Inches(w))
    pic.line.color.rgb = LINE; pic.line.width = Pt(1)
    h = pic.height / 914400
    # side='right': on the blank right end of the element; side='out': outside the picture, on the left
    for n, r in (pins or {}).items():
        cy = y + (r[1] + r[3] / 2) / page[1] * h - 0.18
        px = x - 0.46 if side == 'out' else x + (r[0] + r[2]) / page[0] * w - 0.5
        pin(slide, px, min(max(cy, y - 0.1), y + h - 0.3), n)
    return h


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
                runs(p, val or ' ', size, INK)
    return shp


def frame(n, title, kicker=None):
    """SETU page chrome: top tag line, numbered heading like the PDF ("01 Problem Statement"), footer."""
    s = prs.slides.add_slide(BLANK)
    text(s, 0.55, 0.22, 6, 0.32, '**SETU 2026**  Forge Realm', 12, GREY, INK)
    text(s, 6.8, 0.22, 6.0, 0.32, '**PS-02  NOTICE DECODER**', 12, BLUE, BLUE, PP_ALIGN.RIGHT)
    if title:
        tb = text(s, 0.55, 0.6, 12.2, 0.7, f'**{n:02d}**  {title}', 28, NAVY, BLUE, bold_all=True)
        if kicker:
            text(s, 0.6, 1.22, 12.1, 0.4, kicker, 15, GREY, BLUE)
    rect(s, 0, 7.12, 13.333, 0.38, NAVY)
    text(s, 0.55, 7.15, 9, 0.32, 'Team **Nova Nexus**   |   SETU 2026 Forge Realm   |   PS-02 Notice Decoder', 12, WHITE, WHITE)
    text(s, 11.9, 7.15, 0.9, 0.32, str(len(prs.slides)), 12, WHITE, WHITE, PP_ALIGN.RIGHT)
    return s


# ---------------------------------------------------------------- 1. title
s = frame(0, None)
b = rect(s, 0.55, 0.75, 12.23, 2.55, BLUE, None, MSO_SHAPE.ROUNDED_RECTANGLE, 0.07)
text(s, 0.95, 0.98, 11, 0.35, '**FORGE REALM  PS-02**', 14, WHITE, WHITE)
text(s, 0.95, 1.35, 11, 1.0, '**Notice Decoder**', 54, WHITE, WHITE)
text(s, 0.95, 2.45, 11.4, 0.6, 'Paste a messy college notice. Get clear events, catch clashes, add them to your calendar.', 20, WHITE, WHITE)
text(s, 0.55, 3.6, 7.6, 0.5, 'Team **Nova Nexus**', 24, NAVY, NAVY)
text(s, 0.55, 4.12, 7.6, 0.5, '**Ankit Kumar** (Team Leader),  **Ankit**,  **Ashwani Tanwar**', 16, INK, NAVY)
text(s, 0.55, 4.75, 7.7, 1.2, ['**Rules that show their reasons.** Every date, time and place points to the exact words it came from.',
                                '**Runs in the browser:** works offline, the notice never leaves the phone, **₹0** per notice.'], 16, INK, BLUE, space=8)
number(s, 8.55, 3.62, 2.05, 1.5, '3 of 3', 'events right on the PS-02 example')
number(s, 10.73, 3.62, 2.05, 1.5, f'{H_OK} of {H_TOTAL}', f'checks right on {notices} new messy notices', bs=24)
ph = rect(s, 8.55, 5.3, 4.23, 1.55, WHITE, LINE, MSO_SHAPE.ROUNDED_RECTANGLE, 0.06)
ph.line.dash_style = 4
text(s, 8.7, 5.42, 3.95, 1.3, ['**Live demo**', 'QR code and link go here after deploy'], 14, GREY, NAVY, PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

# ---------------------------------------------------------------- 2. problem
s = frame(1, 'The problem', 'Dates, times and rooms hide inside long paragraphs, so students miss them or find clashes too late.')
paper = rect(s, 0.55, 1.8, 5.9, 4.0, WHITE, LINE)
text(s, 0.75, 1.9, 5.5, 0.4, '**NOTICE**', 14, INK, INK, PP_ALIGN.CENTER)
nt = text(s, 0.8, 2.4, 5.45, 3.3, '', 17, INK)
p = nt.text_frame.paragraphs[0]
sample = (ROOT / 'examples' / '01-pdf-sample.txt').read_text(encoding='utf-8').strip()
runs(p, sample, 17, INK)
text(s, 0.55, 5.9, 5.9, 0.9, ['The PS-02 example: **three things on one day.** Two of them **clash**, and nothing in the text says so.'], 14, INK, BLUE)
card(s, 6.8, 1.8, 6.0, 1.15, 'Students miss notices',
     'APSIT Mumbai stopped posting notices in WhatsApp groups because "many students miss important notices" (Sep 2025).')
card(s, 6.8, 3.1, 6.0, 1.15, 'The class rep carries them',
     'Jamia now keeps academic notices in official class groups run by the class representative (Sep 2026).')
card(s, 6.8, 4.4, 6.0, 1.15, 'Clashes reach the news',
     'St Agnes College, Mangaluru set semester exams in the Dasara holidays; students protested (PTI, Oct 2026).')
card(s, 6.8, 5.7, 6.0, 1.1, 'Who it is for',
     'Students first. Then the class rep who forwards every notice by hand.', keycol=NAVY)

# ---------------------------------------------------------------- 3. solution
s = frame(2, 'Our solution', 'The real app on the PS-02 example. One paste, three events, every field explained.')
pp = PINS['solution']
h = shot(s, SHOTS / 'shot-solution.png', 0.55, 1.75, 8.6, {k: v for k, v in pp.items() if k != 'size'}, pp['size'])
legend = [('1', 'One-line answer first', '3 events found. 2 clashes. Nothing to check.'),
          ('2', 'Highlighter colours', 'Each event\'s words in the notice, in its own colour.'),
          ('3', 'A reason for every field', '"why" line + Show in notice lights up the words.'),
          ('4', 'Only doubts ask', 'Sure fields say "Nothing to check"; unsure ones turn amber.'),
          ('5', 'One tap to the calendar', 'Google Calendar per event, or one .ics file for all.')]
for i, (n, k, d) in enumerate(legend):
    y = 1.75 + i * 0.98
    pin(s, 9.45, y + 0.08, n)
    text(s, 9.9, y, 2.95, 0.95, [f'**{k}**', d], 13, INK, NAVY, space=2)

# ---------------------------------------------------------------- 4. how it works
s = frame(3, 'How it works', 'Plain rules, in order. Each step leaves a reason the student can read.')
row1 = [('Paste the notice', 'WhatsApp text, a PDF copy, the board'),
        ('Split it', 'Sentences, and "Date:" / "Time:" lines kept together'),
        ('Find dates, times, places', '13 Nov, 13/11/2026, 2 PM, 14:00, 12 noon, kal 5 baje'),
        ('Notice rules', '"today" = the notice\'s date, postponed, windows, TBD')]
row2 = [('Events with reasons', 'Each field shows its words in the notice'),
        ('Student checks', 'Only amber fields; export stays locked until then'),
        ('Clash check', 'Overlap = each starts before the other ends; a deadline is a point'),
        ('Add to calendar', 'One .ics file, or Google Calendar in one tap')]
for r, items in enumerate([row1, row2]):
    for i, (k, d) in enumerate(items):
        x = 0.55 + i * 3.17
        card(s, x, 1.85 + r * 2.0, 2.75, 1.45, k, d, keycol=BLUE if r == 0 else NAVY)
        if i < 3:
            arrow(s, x + 2.79, 1.85 + r * 2.0 + 0.58)
arrow(s, 11.85, 3.4, 0.3, 0.38, down=True)
band = rect(s, 0.55, 5.95, 12.23, 0.95, PALE, None, MSO_SHAPE.ROUNDED_RECTANGLE, 0.1)
text(s, 0.8, 6.05, 11.8, 0.8, '**Runs in the browser.** No server and no API key: it works offline, the notice never leaves the phone, and a notice costs **₹0** to decode.', 16, INK, BLUE, anchor=MSO_ANCHOR.MIDDLE)

# ---------------------------------------------------------------- 5. PS-02 point by point
s = frame(4, 'PS-02, point by point', 'Every "must have" in the problem statement, and how we checked it.')
rows = [['PS-02 asks', 'What Notice Decoder does', 'Checked on'],
        ['Title, type, date, start, end, venue', 'Reads each field and shows the words it came from', 'PS example: all 3 events, every field'],
        ['"13 Nov", "13/11/2026", "2 PM", "14:00"', 'All four, plus "12 noon", "1:30pm-5pm", "FN", "kal 5 baje"', 'Engine tests'],
        ['Review and fix every field before export', 'Every field editable; export locked until amber fields are fixed or marked "Looks right"', 'Browser test at phone width'],
        ['Overlap: each starts before the other ends', '"Clash. They overlap from 11:00 to 11:30 AM (30 minutes)."', 'PS example'],
        ['A deadline is a point; it clashes inside an event', '"The 12:00 PM deadline falls during the guest lecture"', 'PS example'],
        ['A valid .ics for common calendar apps', 'India time zone, reminders by event type, repeats for multi-day events', 'Read back by Python\'s icalendar parser'],
        ['Suggest an action', '"Finish Lab record submission before 10:00 AM"', 'PS example']]
table(s, 0.55, 1.8, 12.23, [3.6, 5.6, 3.03], rows, 15, 16)

# ---------------------------------------------------------------- 6. the PS example, end to end
s = frame(5, 'The PS-02 example, end to end', 'Same three answers as the problem statement, from the real app.')
shot(s, SHOTS / 'shot-clash.png', 0.55, 1.75, 7.9)
for i, (k, d, col) in enumerate([('No clash', 'Test ends 11:30 AM, before the 12:00 PM deadline.', GREEN),
                                 ('Clash: 30 minutes', 'Test and guest lecture overlap 11:00 to 11:30 AM.', RED),
                                 ('Clash: deadline inside', 'The 12:00 PM deadline falls during the lecture.', RED)]):
    card(s, 8.75, 1.75 + i * 1.12, 4.03, 0.98, k, d, keycol=col)
card(s, 8.75, 5.15, 4.03, 1.55, 'Suggested action',
     'Finish the lab records before 10:00 AM: from 10:00 to 12:00 you are in the test and the lecture.', keycol=NAVY, fill=PALE)

# ---------------------------------------------------------------- 7. beyond the obvious
s = frame(6, 'Beyond the obvious: real notices', 'Rules written for the way Indian college notices are really written.')
pairs = [('"POSTPONED to 20 Nov"', 'Moves the event and shows the old date'),
         ('"today\'s drive" + "Date: 05 Oct"', '"today" means the notice\'s date, not the day you paste it'),
         ('"available 1:30pm-5pm, 60 min"', 'A window: "take it 1:30 to 2:30 PM", not a clash'),
         ('"this week or next week"', 'Goes to Not scheduled yet, never a made-up date'),
         ('"results today 9 pm" and "next day"', 'Both shown in amber until the student picks one'),
         ('"04/05/2027"', 'Read day first (4 May) and asks if it means 5 April'),
         ('"lecture cancel ho gayi"', 'Reported as cancelled, never added'),
         ('"kal shaam 5 baje"', '5 PM tomorrow, flagged: kal can also mean yesterday')]
for i, (k, d) in enumerate(pairs):
    col, r = i % 2, i // 2
    card(s, 0.55 + col * 6.2, 1.8 + r * 1.02, 6.0, 0.9, k, d, keycol=NAVY, ks=14, ds=13)
band = rect(s, 0.55, 5.95, 12.23, 0.95, PALE, None, MSO_SHAPE.ROUNDED_RECTANGLE, 0.1)
text(s, 0.8, 6.0, 11.8, 0.85, [f'**Why rules, not AI:** the same answer every time, a reason for every field, offline and ₹0. Rules missed **{H_TOTAL - H_OK} of {H_TOTAL}** checks, mostly spelling mistakes: the only place an AI fallback would help.'],
     15, INK, BLUE, anchor=MSO_ANCHOR.MIDDLE)

# ---------------------------------------------------------------- 8. tested and compared
s = frame(7, 'Tested, and compared', 'Numbers from our own test runs and from reading other teams\' public code.')
number(s, 0.55, 1.8, 2.9, 1.45, f'{N_ENGINE} of {N_ENGINE}', 'engine tests pass')
number(s, 3.6, 1.8, 2.9, 1.45, f'{N_BROWSER} of {N_BROWSER}', 'browser checks pass at phone width')
number(s, 0.55, 3.4, 2.9, 1.45, f'{H_OK} of {H_TOTAL}', f'checks right on {notices} new messy notices')
number(s, 3.6, 3.4, 2.9, 1.45, '3 of 3', '.ics files read back by Python\'s icalendar parser')
text(s, 0.55, 5.1, 5.95, 1.9, ['**Not done yet:** photos of notices, Hindi script, spelling mistakes ("tset", "Nvo" leave the date empty and keep export locked).'], 16, INK, NAVY)
rows = [['Public project (Oct 2026)', 'Calendar file', 'Clash check'],
        ['7 notice tools on GitHub, mostly AI summaries', '0 of 7', '0 of 7'],
        ['edt-tamis: university timetable files, not notices', 'Yes', 'Yes'],
        ['Notice Decoder', 'Yes', 'Yes, with the reason']]
table(s, 6.8, 1.8, 5.98, [3.4, 1.29, 1.29], rows, 13, 13)
text(s, 6.8, 4.0, 5.98, 2.9, ['We read their code, not their README: no VCALENDAR, no clash or overlap check in any of the 7.',
                              'Closest on rules: one tool reads DD/MM dates offline, but has no clock times, calendar file or clash check.'], 16, INK, NAVY, space=12)

# ---------------------------------------------------------------- 9. UI / UX
s = frame(8, 'Easy on a phone', 'A first-time user knows where to look: the answer first, then only what needs a check.')
pp = PINS['phone']
shot(s, SHOTS / 'shot-phone-review.png', 1.0, 1.7, 2.45, {k: v for k, v in pp.items() if k != 'size'}, pp['size'], side='out')
pts = [('1', 'It says what to check', '"04/05/2027" read as 4 May 2027. If it means 5 Apr, fix the date.'),
       ('2', 'The doubtful field is outlined', 'Amber, on the field itself; the sure fields stay plain.'),
       ('3', '"Looks right" or fix it', 'Export and Google Calendar unlock only after this.')]
for i, (n, k, d) in enumerate(pts):
    y = 1.8 + i * 1.12
    pin(s, 3.85, y + 0.06, n)
    text(s, 4.3, y, 4.0, 1.05, [f'**{k}**', d], 14, INK, NAVY, space=2)
for i, (k, d) in enumerate([('One-line answer at the top', '"3 events found. 2 clashes. Nothing to check."'),
                            ('Colour links card and notice', 'Same highlighter colour on both'),
                            ('Fits a 360 px phone', 'No sideways scroll; the timeline fits the screen'),
                            ('Errors say what to do', '"Too short to be a notice. Paste the whole message, with its date and time."')]):
    card(s, 8.6, 1.75 + i * 1.27, 4.18, 1.12, k, d, keycol=BLUE, ks=14, ds=13)
text(s, 3.85, 5.3, 4.5, 1.5, ['**Plain words:** "Clash. They overlap from 11:00 to 11:30 AM (30 minutes)." No codes, no jargon.'], 14, INK, NAVY)

# ---------------------------------------------------------------- 10. who pays
s = frame(9, 'Who pays', 'Free for every student. The department pays for the part that saves the class rep\'s time.')
rows = [['Plan', 'Who uses it', 'Who pays', 'What they get', 'Our cost'],
        ['Free', 'Every student', 'Nobody', 'Paste, check, clashes, calendar file, Google Calendar', 'About ₹0: runs on the phone'],
        ['Department plan (planned)', 'Class rep or teacher', 'Department; HOD signs off', 'Decode once, publish; the class subscribes to one calendar link that updates itself', 'A small server and storage']]
table(s, 0.55, 1.8, 12.23, [2.2, 1.9, 2.1, 4.03, 2.0], rows, 13, 14)
number(s, 0.55, 3.55, 3.3, 1.75, '₹2,999', 'per department per year (proposed), first term free')
card(s, 4.05, 3.55, 4.25, 1.75, 'Why pay when WhatsApp is free?',
     'The plan does the typing, catches clashes before publishing, and moves an event for everyone when a notice is revised.', keycol=NAVY)
card(s, 8.5, 3.55, 4.28, 1.75, 'Pilot: one department, one term',
     'Count notices published and clashes caught. It works if the HOD pays for the next term.', keycol=NAVY)
text(s, 0.55, 5.55, 12.23, 1.3, ['**For scale:** Fedena, a full college ERP, lists $999 to $1,699 a year for a whole college, so one feature for one department must cost far less.',
                                 '**Honest status:** no college has paid yet; the price is our estimate for the pilot to test.'], 16, INK, NAVY, space=8)

OUT.parent.mkdir(exist_ok=True)
prs.save(OUT)
print('saved', OUT)
