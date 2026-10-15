// Element screenshots for deck/build_deck.py. Needs the app served on 8771 (python -m http.server 8771 --bind 127.0.0.1 --directory app).
// Run from the repo root: PLAYWRIGHT_DIR=<project with playwright> node tools/deck-shots.mjs   -> tmp/deck/*.png
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR || process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8771/';
fs.mkdirSync('tmp/deck', { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });

// Desktop: notice with highlights, event rows, clash timeline + table
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
// Show the export section as a signed-in copy sees it (no real Google call is made for a screenshot).
await ctx.addInitScript(() => { window.__ndGcalDeps = { token: 'deck', fetch: async () => new Response('{}', { status: 200 }) }; });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Exam day clash (PDF sample)' }).click();
await page.waitForSelector('#event-list .ev');
await page.waitForTimeout(3500); // highlighter strokes finish drawing
await page.locator('#notice-card').screenshot({ path: 'tmp/deck/notice.png' });
await page.locator('#event-list').screenshot({ path: 'tmp/deck/rows.png' });
await page.locator('#clash-days').screenshot({ path: 'tmp/deck/timeline.png' });
await page.locator('#clash-table-wrap').screenshot({ path: 'tmp/deck/clashtable.png' });
await page.locator('#event-list .row').first().getByRole('button', { name: /^Edit/ }).click();
await page.locator('#event-list article.card').first().screenshot({ path: 'tmp/deck/card.png' });
await page.locator('#summary').screenshot({ path: 'tmp/deck/summary.png' });
await page.locator('section[aria-labelledby="export-title"]').screenshot({ path: 'tmp/deck/export.png' });
await ctx.close();

// Phone: header + paste box, the timetable amber card, the shared/class view
const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const p = await ph.newPage();
await p.goto(BASE, { waitUntil: 'networkidle' });
await p.screenshot({ path: 'tmp/deck/phone-home.png' });
await p.getByRole('button', { name: 'Exam timetable' }).click();
await p.waitForSelector('#event-list .ev');
await p.locator('#event-list article.card').first().screenshot({ path: 'tmp/deck/phone-amber.png' });
await p.locator('#summary').scrollIntoViewIfNeeded();
await p.screenshot({ path: 'tmp/deck/phone-results.png' });
await ph.close();
await browser.close();
console.log(fs.readdirSync('tmp/deck').join(', '));
