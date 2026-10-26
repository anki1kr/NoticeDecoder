// "How would a user break it?" Every way we could think of: double and triple taps, junk input, giant pastes, script in
// a notice, tampered share links, broken and wrong files, the AI answering late or not at all, the class server down,
// a leaked class key. Drives the real page and the REAL Worker (tools/feed-dev.mjs, with a fake Claude).
//   python -m http.server 8771 --bind 127.0.0.1 --directory app
//   node tools/feed-dev.mjs --port 8787 --fake-ai
//   node tools/break-check.mjs            (OCR_CHECKS=1 also reads photos and scans; downloads the OCR model once)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR || process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8771/';
const FEED = process.env.FEED_URL || 'http://127.0.0.1:8787';
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('ok -', name); } else { fail++; console.log('FAIL -', name, extra); } };
const aiCalls = async () => (await (await fetch(`${FEED}/__dev/ai-calls`)).json()).calls;
await fetch(`${FEED}/__dev/reset`, { method: 'POST' }).catch(() => { console.log('start the feed first: node tools/feed-dev.mjs --port 8787 --fake-ai'); process.exit(2); });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
const errors = [];
async function newPage({ ai = true, storage = {}, contextOptions = {} } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true, ...contextOptions });
  await context.addInitScript(([feed, ai, storage]) => {
    window.__ndFeedBase = feed;
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('nd-ai', ai ? '1' : '0');
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    }
  }, [FEED, ai, storage]);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { context, page };
}
const evCount = (page) => page.locator('#event-list .ev').count();
const titles = (page) => page.locator('#event-list .ev').evaluateAll((els) => els.map((e) => e.querySelector('[data-field="title"] input')?.value ?? e.querySelector('.row-title')?.firstChild?.textContent));
const status = (page, sel) => page.locator(sel).innerText();
const waitText = (page, sel, re, timeout = 10000) => page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.innerText || ''), [sel, re.source], { timeout }).catch(() => {});
const PDF_NOTICE = fs.readFileSync('examples/01-pdf-sample.txt', 'utf8');

// ---------------------------------------------------------------- 1. taps, double taps, junk
{
  const { context, page } = await newPage({ ai: false });
  await page.locator('#decode-btn').dblclick();
  ok(await page.locator('#input-error').isVisible() && await page.locator('#results').isHidden(), 'empty box + double tap Decode: one clear message, no results');
  await page.locator('#notice-input').fill('Test on 13');
  await page.locator('#decode-btn').click();
  ok(await page.locator('#results').isVisible() && /too short/.test(await page.locator('#warnings').innerText()), 'a 10-letter "notice": told it is too short');
  await page.locator('#notice-input').fill('🚀🤖📅 '.repeat(40));
  await page.locator('#decode-btn').click();
  ok(await evCount(page) === 0 && /No dates or times found/.test(await page.locator('#warnings').innerText()), 'emoji only: "no dates or times found", no crash');
  await page.locator('#notice-input').fill(PDF_NOTICE);
  for (let i = 0; i < 5; i++) await page.locator('#decode-btn').click({ delay: 0 });
  ok(await evCount(page) === 3, 'Decode tapped 5 times fast: still exactly 3 events', String(await evCount(page)));
  await page.locator('#add-btn').click(); await page.locator('#add-btn').click(); await page.locator('#add-btn').click();
  const ids = await page.locator('#event-list .ev').evaluateAll((els) => els.map((e) => e.dataset.id));
  ok(ids.length === 6 && new Set(ids).size === 6, 'three quick "+ Add event": three cards, no shared id', ids.join(','));
  ok(/Add a date/.test(await status(page, '#export-status')) && await page.locator('#export-btn').isDisabled(), 'undated manual events lock the export with the reason');
  for (let i = 0; i < 3; i++) await page.locator('#event-list .ev').last().getByRole('button', { name: /^Delete/ }).click();
  ok(await evCount(page) === 3 && await page.locator('#export-btn').isEnabled(), 'deleting the empty cards opens the export again');

  // a paste decodes once; an edit made right after it survives (it used to be wiped by a second decode 0.9 s later)
  await page.locator('#clear-btn').click();
  await page.evaluate((t) => { const box = document.querySelector('#notice-input'); box.focus(); const dt = new DataTransfer(); dt.setData('text/plain', t); box.value = t; box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); box.dispatchEvent(new Event('input', { bubbles: true })); }, 'Guest lecture on 20 Nov 2026 at 11 AM in Seminar Hall.​');
  await page.waitForSelector('#event-list .ev');
  await page.locator('#event-list .ev').first().getByRole('button', { name: /^Edit/ }).click();
  await page.locator('#event-list .ev [data-field="venue"] input').fill('Auditorium');
  await page.waitForTimeout(1500);
  ok(await page.locator('#event-list .ev [data-field="venue"] input').inputValue() === 'Auditorium', 'a paste is decoded once: an edit made right after it is not wiped');

  // script and HTML in a notice are text, never markup
  let dialog = false;
  page.on('dialog', async (d) => { dialog = true; await d.dismiss(); });
  await page.locator('#notice-input').fill('<img src=x onerror="alert(1)"><script>alert(2)</script> Internal Test on 13 Nov 2026 at 10 AM in Room <b>204</b>.');
  await page.locator('#decode-btn').click();
  await page.waitForTimeout(400);
  ok(!dialog && await page.locator('#notice-text img, #notice-text script, #notice-text b, #event-list img').count() === 0, 'script and HTML inside a notice render as plain text');

  // a 200 KB paste (a whole PDF dumped in) stays usable
  const huge = `${PDF_NOTICE}\n`.repeat(Math.ceil(200000 / PDF_NOTICE.length));
  // Set like a paste (Playwright's fill() types 200 KB slowly; that is the test tool, not the app), time the decode.
  const ms = await page.evaluate((text) => {
    const box = document.querySelector('#notice-input');
    box.value = text;
    const t = performance.now();
    document.querySelector('#decode-btn').click();
    return Math.round(performance.now() - t);
  }, huge);
  ok(ms < 3000 && await evCount(page) >= 3, `200 KB paste: decode + render in ${ms} ms, page still usable`);
  await context.close();
}

// ---------------------------------------------------------------- 2. what a student types into the fields
{
  const { context, page } = await newPage({ ai: false });
  await page.locator('#notice-input').fill('Internal Test 2 on 13 Nov 2026 from 10 AM to 11:30 AM in Room 204.');
  await page.locator('#decode-btn').click();
  await page.locator('#event-list .ev').first().getByRole('button', { name: /^Edit/ }).click();
  const card = page.locator('#event-list article.card').first();
  await card.locator('[data-field="title"] input').fill('X'.repeat(5000));
  ok((await card.locator('[data-field="title"] input').inputValue()).length === 120, 'a 5000-letter title is cut to 120');
  await card.locator('[data-field="title"] input').fill('Internal Test 2');
  await card.locator('[data-field="link"] input').fill('javascript:alert(document.cookie)');
  ok(/not a web link/.test(await card.innerText()) && await page.locator('#export-btn').isDisabled(), 'a javascript: link is flagged and locks the export');
  ok(await card.locator('.open-link').isHidden(), 'and is never offered as a link to open');
  await card.getByRole('button', { name: 'Looks right' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#export-btn').click()]);
  const ics = fs.readFileSync(await dl.path(), 'utf8');
  ok(!/javascript:/i.test(ics) && /BEGIN:VEVENT/.test(ics), '"Looks right" on a bad link: the .ics still never carries it');
  await card.locator('[data-field="link"] input').fill('');
  await page.evaluate(() => { const i = document.querySelector('#event-list article.card [data-field="date"] input'); i.type = 'text'; i.value = '20260-10-28'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(/real date/.test(await card.innerText()) && /Add a date/.test(await status(page, '#export-status')), 'a 5-digit year (a date picker allows it) is refused');
  await page.evaluate(() => { const i = document.querySelector('#event-list article.card [data-field="date"] input'); i.value = '2026-02-31'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(/Add a date/.test(await status(page, '#export-status')), '31 Feb is refused');
  await page.evaluate(() => { const i = document.querySelector('#event-list article.card [data-field="date"] input'); i.value = '2026-11-13'; i.type = 'date'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await card.locator('[data-field="end"] input').fill('09:00');
  ok(/End time is before the start/.test(await card.innerText()) && await page.locator('#export-btn').isDisabled(), 'end before start: flagged, export locked');
  await card.locator('[data-field="end"] input').fill('11:30');
  await card.locator('[data-field="durationMin"] input').fill('-50');
  ok(await page.locator('#export-btn').isEnabled(), 'a negative duration is ignored, nothing breaks');
  ok(errors.length === 0, 'fields: no page errors', errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- 3. tampered links
{
  const { context, page } = await newPage({ ai: false });
  for (const hash of ['#s=%%%garbage', '#s=e30', '#c=../../etc/passwd', '#cr=abc.def', '#c=', '#s=' + 'A'.repeat(20000)]) {
    await page.goto(BASE + hash, { waitUntil: 'networkidle' });
    await page.waitForTimeout(200);
  }
  ok(errors.length === 0 && await page.locator('#decode-btn').isVisible(), 'garbage share/class/key links: the page just opens normally', errors.join(' | '));
  const evil = { v: 1, on: '2026-10-26', e: [{ t: '<img src=x onerror=alert(1)>', k: 'evil', d: '2026-02-31', s: '25:00', l: 'javascript:alert(1)', v: '<b>x</b>' }, ...Array.from({ length: 499 }, (_, i) => ({ t: `Spam ${i}`, k: 'test', d: '2026-11-13', s: '10:00' }))] };
  const b64 = Buffer.from(JSON.stringify(evil)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await page.goto(`${BASE}#s=${b64}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#event-list .ev');
  ok(await evCount(page) === 50, 'a share link with 500 events shows at most 50', String(await evCount(page)));
  ok(await page.locator('#event-list img, #event-list b').count() === 0 && /Add a date/.test(await status(page, '#export-status')), 'its fake date, script title and bad type are neutralised');
  ok(await page.locator('#event-list .open-link:visible').count() === 0, 'its javascript: link is dropped');
  await context.close();
}

// ---------------------------------------------------------------- 4. files: good, broken, wrong, two at once
{
  const { context, page } = await newPage({ ai: false });
  await page.locator('#file-input').setInputFiles('examples/14-word-notice.docx');
  await page.waitForSelector('#event-list .ev', { timeout: 15000 }).catch(() => {});
  const t = await titles(page);
  ok(['Operating Systems', 'DBMS', 'Computer Networks'].every((s) => t.some((x) => (x || '').includes(s))) && t.some((x) => /record/i.test(x || '')), 'Word file: the 3 exams from its table + the record deadline', JSON.stringify(t));
  ok(/^Read 14-word-notice\.docx/.test(await status(page, '#file-status')), 'Word file: status names it', await status(page, '#file-status'));
  ok(!/photo/i.test(await page.locator('#event-list').innerText()), 'Word file: typed text, so no "read from a photo" check');
  const cases = [
    ['tests/fixtures/truncated.docx', /damaged/], ['tests/fixtures/not-really.docx', /not a Word document/], ['tests/fixtures/old-word.doc', /old Word file/],
    ['tests/fixtures/zip-bomb.docx', /too large/], ['tests/fixtures/empty.png', /empty \(0 bytes\)/], ['tests/fixtures/corrupt.pdf', /not a readable PDF/],
    ['tests/fixtures/password.pdf', /password-protected/],
  ];
  for (const [file, re] of cases) {
    await page.locator('#file-input').setInputFiles(file);
    await page.waitForFunction(() => document.querySelector('#file-status').dataset.kind === 'error', null, { timeout: 30000 }).catch(() => {});
    const s = await status(page, '#file-status');
    ok(re.test(s), `${path.basename(file)}: "${s.slice(0, 90)}"`);
  }
  await page.setInputFiles('#file-input', { name: 'setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  ok(/not a PDF, a Word file/.test(await status(page, '#file-status')), 'an .exe is refused by name and type');
  await page.setInputFiles('#file-input', { name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: Buffer.from('....ftypheic') });
  ok(/HEIC/.test(await status(page, '#file-status')), 'an iPhone HEIC photo gets a "send a JPG" message');
  // two files back to back: the second one wins, the slower first one never overwrites it
  await page.locator('#clear-btn').click();
  await page.locator('#file-input').setInputFiles('examples/08-pdf-timetable.pdf');
  await page.locator('#file-input').setInputFiles('examples/14-word-notice.docx');
  await page.waitForTimeout(6000);
  ok(/^Read 14-word-notice\.docx/.test(await status(page, '#file-status')) && (await page.locator('#notice-input').inputValue()).includes('Operating Systems'), 'PDF then Word file at once: the Word file wins', await status(page, '#file-status'));
  ok(errors.length === 0, 'files: no page errors', errors.join(' | '));

  if (process.env.OCR_CHECKS === '1') {
    // the OCR language data cannot be downloaded (weak network): a message, not "Preparing the reader…" forever
    const { context: cx, page: px } = await newPage({ ai: false, contextOptions: { serviceWorkers: 'block' } }); // so the route sees the download
    await cx.route('**/tessdata.projectnaptha.com/**', (r) => r.abort('connectionreset'));
    await px.locator('#file-input').setInputFiles('tests/fixtures/blank.png');
    await px.waitForFunction(() => ['error', 'ok'].includes(document.querySelector('#file-status').dataset.kind), null, { timeout: 150000 }).catch(() => {});
    ok(/could not download|taking too long/.test(await status(px, '#file-status')), 'OCR model download fails: a plain message instead of a hang', await status(px, '#file-status'));
    await cx.unroute('**/tessdata.projectnaptha.com/**');
    await px.locator('#file-input').setInputFiles('examples/07-photo-notice.png');
    await px.waitForFunction(() => ['error', 'ok'].includes(document.querySelector('#file-status').dataset.kind) && !/could not download/.test(document.querySelector('#file-status').innerText), null, { timeout: 240000 }).catch(() => {});
    ok(/^Read 07-photo-notice\.png/.test(await status(px, '#file-status')), 'and once the network is back, the next photo works without a reload', await status(px, '#file-status'));
    await cx.close();
    for (const [file, expect] of [['tests/fixtures/blank.png', /Nothing readable/], ['tests/fixtures/huge.png', /Nothing readable|could not be opened|too/i], ['tests/fixtures/scanned-notice.pdf', /^Read scanned-notice\.pdf from the picture/]]) {
      await page.locator('#clear-btn').click();
      await page.locator('#file-input').setInputFiles(file);
      await page.waitForFunction(() => ['error', 'ok'].includes(document.querySelector('#file-status').dataset.kind), null, { timeout: 240000 }).catch(() => {});
      const s = await status(page, '#file-status');
      ok(expect.test(s), `OCR ${path.basename(file)}: "${s.slice(0, 100)}"`);
    }
    if (fs.existsSync('tmp/iic-poster.png')) {
      await page.locator('#clear-btn').click();
      await page.locator('#file-input').setInputFiles('tmp/iic-poster.png');
      await page.waitForFunction(() => ['error', 'ok'].includes(document.querySelector('#file-status').dataset.kind), null, { timeout: 240000 }).catch(() => {});
      console.log('   poster OCR:', (await page.locator('#notice-input').inputValue()).slice(0, 400).replace(/\n/g, ' / '));
      const ev = await page.locator('#event-list').innerText();
      ok(/28 Oct/.test(ev) && /2:20 PM/.test(ev), 'the real IIC poster photo: 28 Oct at 2:20 PM read from the picture', ev.slice(0, 300));
    }
  }
  await context.close();
}

// ---------------------------------------------------------------- 5. the AI check (fake Claude behind the real Worker)
{
  const weak = 'Dear students,\nThe IIC Club invites you to the Innovation Mela 2026.\nBring your ideas.\nDate: 28 October 2026\nTime: 2:20 PM\nVenue: Room 208';
  const { context, page } = await newPage({ ai: true });
  await page.waitForFunction(() => !document.querySelector('#ai-row').hidden, null, { timeout: 8000 }).catch(() => {});
  ok(await page.locator('#ai-row').isVisible(), 'AI: the switch shows because the server has a key');
  let calls = await aiCalls();
  await page.getByRole('button', { name: 'Exam day clash (PDF sample)' }).click();
  await page.waitForTimeout(1200);
  ok(await aiCalls() === calls, 'AI: a notice the rules read cleanly costs no call');
  await page.locator('#notice-input').fill(weak);
  await page.locator('#decode-btn').click();
  ok(/Checking the names/.test(await status(page, '#ai-status')), 'AI: a weak title ("Event") starts a check, and says so');
  await waitText(page, '#ai-status', /AI check:/);
  ok((await titles(page)).includes('Innovation Mela'), 'AI: "Event" became "Innovation Mela"', JSON.stringify(await titles(page)));
  ok(/renamed 1/.test(await status(page, '#ai-status')) && await aiCalls() === calls + 1, 'AI: one call, the status line says what changed');
  const row = await page.locator('#event-list').innerText();
  ok(/28 Oct/.test(row) && /2:20 PM/.test(row), 'AI: the date and time are still the rules\' ones');
  await page.locator('#ai-status').getByRole('button', { name: 'Undo AI changes' }).click();
  ok((await titles(page)).includes('Event'), 'AI: Undo puts the rules\' result back');
  calls = await aiCalls();
  await page.locator('#ai-btn').dblclick();
  await waitText(page, '#ai-status', /AI check:/);
  ok(await aiCalls() === calls + 1, 'AI: "Check names with AI" double-tapped = one call');
  // a missed event comes back amber, dated by the rules from the quoted words
  await page.locator('#notice-input').fill(`${weak}\nAlso: Alumni Meetup on 30 October 2026.`); // no event word, no time: the rules skip it
  await page.locator('#decode-btn').click();
  await waitText(page, '#ai-status', /AI check:/);
  const all = await page.locator('#event-list').innerText();
  ok(/Alumni Meetup/.test(all) && /30 Oct/.test(all) && /Found by the AI check/.test(all) && await page.locator('#export-btn').isDisabled(), 'AI: an event the rules missed comes in amber and locks the export until checked');
  // the student clears the box while the AI is thinking: its late answer must not come back
  await page.locator('#notice-input').fill(weak);
  await page.locator('#decode-btn').click();
  await page.locator('#clear-btn').click();
  await page.waitForTimeout(1200);
  ok(await page.locator('#results').isHidden() && await evCount(page) === 0, 'AI: an answer that arrives after Clear is dropped');
  // the switch off: no call at all
  await page.locator('#ai-toggle').uncheck();
  calls = await aiCalls();
  await page.locator('#notice-input').fill(weak);
  await page.locator('#decode-btn').click();
  await page.waitForTimeout(1000);
  ok(await aiCalls() === calls && (await titles(page)).includes('Event'), 'AI: switched off = no call, the rules\' result stands');
  await page.locator('#ai-toggle').check();
  // the AI server unreachable: a plain message, the events untouched
  await context.route('**/api/ai/refine', (r) => r.abort('connectionrefused'));
  await page.locator('#ai-btn').click();
  await waitText(page, '#ai-status', /rules result stands/);
  ok(/Could not reach the server.*rules result stands/.test(await status(page, '#ai-status')) && (await titles(page)).includes('Event'), 'AI: server down = "the rules result stands", nothing lost', await status(page, '#ai-status'));
  await context.unroute('**/api/ai/refine');
  ok(errors.length === 0, 'AI: no page errors', errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- 6. class calendar v2, the CR side
let classId, keyLink;
{
  const { context, page } = await newPage({ ai: false });
  const reqs = [];
  page.on('request', (r) => { if (r.url().startsWith(FEED) && r.method() !== 'OPTIONS') reqs.push(`${r.method()} ${r.url().slice(FEED.length)}`); });
  await page.getByRole('button', { name: 'Exam day clash (PDF sample)' }).click();
  let prompts = 0;
  page.on('dialog', async (d) => { if (d.type() === 'prompt') { prompts++; await d.accept('III CSE A'); } else await d.accept(); });
  await page.locator('#class-publish-btn').click({ clickCount: 3, delay: 0 });
  await page.waitForSelector('#class-preview:not([hidden])', { timeout: 8000 }).catch(() => {});
  ok(prompts === 1 && reqs.filter((r) => r === 'POST /api/class').length === 1, 'triple tap on "Publish to class": one name prompt, one class', reqs.join(', '));
  await page.locator('#class-confirm-btn').dblclick();
  await waitText(page, '#class-result', /Published:/);
  ok(reqs.filter((r) => /\/publish$/.test(r)).length === 1, 'double tap on "Publish": published once', reqs.join(', '));
  classId = (await page.evaluate(() => JSON.parse(localStorage.getItem('nd-class')))).id;

  // a second quiz on another date is NEW; the CR can say it is the first one moved
  await page.locator('#notice-input').fill('Quiz on 5 Nov 2026 at 10 AM in Room 4.');
  await page.locator('#decode-btn').click();
  await page.locator('#class-publish-btn').click();
  await page.waitForSelector('#class-preview:not([hidden])');
  await page.locator('#class-confirm-btn').click();
  await waitText(page, '#class-result', /Published: 1 new/);
  await page.locator('#notice-input').fill('Quiz on 12 Nov 2026 at 10 AM in Room 4.');
  await page.locator('#decode-btn').click();
  await page.locator('#class-publish-btn').click();
  await waitText(page, '#class-preview-list', /NEW/i);
  ok(/^new\b/im.test(await page.locator('#class-preview-list').innerText()), 'a second "Quiz" on another date is shown as NEW (v1 silently moved the first)');
  await page.locator('#class-preview-list').getByRole('button', { name: /moved/ }).click();
  await waitText(page, '#class-preview-list', /Moves/i);
  ok(/Moves[\s\S]*Thu 5 Nov[\s\S]*→[\s\S]*Thu 12 Nov/i.test(await page.locator('#class-preview-list').innerText()), 'one tap turns it into "moves 5 Nov → 12 Nov"', await page.locator('#class-preview-list').innerText());
  await page.locator('#class-confirm-btn').click();
  await waitText(page, '#class-result', /1 moved/);
  ok(/1 moved/.test(await status(page, '#class-result')), 'published as a move');

  // console: edit a time, cancel, bring back
  await page.locator('#class-refresh-btn').click();
  await waitText(page, '#class-console-hint', /upcoming events in III CSE A/);
  const quiz = page.locator('#class-console-list > li').filter({ hasText: 'Quiz' });
  await quiz.getByRole('button', { name: /^Edit Quiz/ }).click();
  await quiz.locator('input[name="start"]').fill('14:00');
  await quiz.locator('input[name="end"]').fill('13:00');
  await quiz.getByRole('button', { name: 'Save for the class' }).click();
  ok(/end time is before the start/i.test(await status(page, '#class-result')), 'console edit: end before start is refused before it leaves the phone');
  await quiz.locator('input[name="end"]').fill('15:00');
  await quiz.getByRole('button', { name: 'Save for the class' }).dblclick();
  await waitText(page, '#class-result', /Saved/);
  ok(/Saved: "Quiz" is now Thu 12 Nov, 2:00 PM/.test(await status(page, '#class-result')), 'console edit: the quiz moved to 2 PM for the whole class', await status(page, '#class-result'));
  await page.locator('#class-console-list > li').filter({ hasText: 'Quiz' }).getByRole('button', { name: /^Cancel Quiz/ }).click();
  await waitText(page, '#class-console-list', /\(cancelled\)/);
  await page.locator('#class-console-list > li').filter({ hasText: 'Quiz' }).getByRole('button', { name: /^Bring back/ }).click();
  await waitText(page, '#class-result', /back on/);
  ok(/back on/.test(await status(page, '#class-result')) && !/Quiz[^\n]*\(cancelled\)/.test(await page.locator('#class-console-list').innerText()), 'cancel, then "Bring back": the quiz is on again');
  await page.locator('#class-changes-wrap summary').click();
  ok(/Moved: Quiz/.test(await page.locator('#class-changes').innerText()), 'console: "What changed lately" lists the move');

  // QR, WhatsApp, key link for another phone
  await page.locator('#class-qr-btn').click();
  await page.waitForSelector('#class-qr svg', { timeout: 15000 }).catch(() => {});
  ok(await page.locator('#class-qr svg').count() === 1, 'QR code of the subscribe page for the projector');
  await page.locator('#class-manage summary').click();
  await page.locator('#class-backup-btn').click();
  keyLink = await page.evaluate(() => navigator.clipboard.readText());
  ok(new RegExp(`#cr=${classId}\\.[a-z0-9]{32}$`).test(keyLink), '"Use on another phone" copies a key link (in the #hash, never sent to a server)');
  ok(errors.length === 0, 'class (CR): no page errors', errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- 7. a second phone, a leaked key, a student
{
  const { context, page } = await newPage({ ai: false });
  page.on('dialog', (d) => d.accept());
  await page.goto(keyLink, { waitUntil: 'networkidle' });
  await waitText(page, '#class-result', /publishes to III CSE A/);
  ok(/This phone now publishes to III CSE A/.test(await status(page, '#class-result')) && !page.url().includes('#cr='), 'key link on a second phone: it can publish, and the key leaves the address bar');
  ok(await page.locator('#class-section').isVisible() && await page.locator('#results').isHidden(), 'the class can be managed without decoding a notice first');
  await page.locator('#class-manage summary').click();
  await page.locator('#class-rotate-btn').click();
  await waitText(page, '#class-result', /New class key made/);
  const { context: c3, page: p3 } = await newPage({ ai: false });
  let alerted = '';
  p3.on('dialog', async (d) => { alerted = d.message(); await d.accept(); });
  await p3.goto(keyLink, { waitUntil: 'networkidle' });
  await p3.waitForTimeout(1500);
  ok(/out of date/.test(alerted) && await p3.evaluate(() => !localStorage.getItem('nd-class')), 'after "New class key" the leaked old link is useless', alerted);
  await c3.close();
  await page.locator('#class-forget-btn').click();
  ok(/No class yet/.test(await status(page, '#class-status')) || await page.locator('#class-section').isHidden(), '"Forget on this device" removes the key from this phone');
  await context.close();

  // the student
  const { context: s, page: st } = await newPage({ ai: false });
  await st.goto(`${BASE}#c=${classId}`, { waitUntil: 'networkidle' });
  await st.waitForSelector('#event-list .ev', { timeout: 8000 }).catch(() => {});
  ok(await evCount(st) === 4 && /Moved: Quiz/.test(await st.locator('#shared-changes').innerText()), 'student: the class opens with what changed on top', await st.locator('#shared-changes').innerText());
  await st.goto(BASE, { waitUntil: 'networkidle' });
  await st.waitForSelector('#follow-row:not([hidden])', { timeout: 8000 }).catch(() => {});
  ok(/Your class: III CSE A/.test(await st.locator('#follow-row').innerText()), 'student: next visit, the class is one tap away');
  await st.locator('#follow-open-btn').click();
  await st.waitForSelector('#event-list .ev', { timeout: 8000 }).catch(() => {});
  ok(await evCount(st) === 4, 'student: "Open" loads the class');
  const sub = await st.request.get(`${FEED}/c/${classId}`);
  const html = await sub.text();
  ok(sub.status() === 200 && /III CSE A/.test(html) && /What changed/.test(html) && /Moved/.test(html), 'subscribe page: name, upcoming list, what changed');
  await st.goto(`${FEED}/c/${classId}`, { waitUntil: 'networkidle' });
  await st.locator('#qr-btn').click().catch(() => {});
  ok(await st.locator('#qr svg').count() === 1, 'subscribe page: the QR code draws (pinned library with an integrity hash)');
  // offline: the class calls say so plainly
  await s.setOffline(true);
  await st.goto(BASE, { waitUntil: 'load' });
  await st.locator('#class-join').fill(classId);
  await st.locator('#class-join-btn').click();
  await waitText(st, '#class-open-result', /Opened|offline/i);
  ok(/Opened III CSE A/.test(await status(st, '#class-open-result')), 'offline: a class opened before still opens (from the browser cache)', await status(st, '#class-open-result'));
  await st.locator('#class-join').fill('zzzz2345');
  await st.locator('#class-join-btn').click();
  await waitText(st, '#class-open-result', /offline|reach/i);
  ok(/offline/i.test(await status(st, '#class-open-result')), 'offline: a new class says "You are offline", not a raw error', await status(st, '#class-open-result'));
  await s.setOffline(false);
  await s.close();
}

ok(errors.length === 0, 'no console or page errors anywhere', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
