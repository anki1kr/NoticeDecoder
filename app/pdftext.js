// PDF -> text, in the browser, with pdf.js (pinned, loaded on first use from jsDelivr; the service worker caches it so
// the second PDF works offline). Text items are rebuilt into LINES by their y position, so "Date: ..." / "Time: ..."
// stay on separate lines and timetable rows stay rows (the engine depends on that). A page with no text layer (a scan)
// is rendered to a canvas and handed back for OCR.
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs';
const MAX_PAGES = 5;
const MIN_TEXT_CHARS = 20;

let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = await import(/* @vite-ignore */ PDFJS);
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  return lib;
}

// Items -> lines. Items whose baselines are within half a line height belong to one line; within a line, a gap wider
// than ~2 spaces becomes a cell separator (two spaces + " - " is what tableRow() in parse.js splits on).
function linesFrom(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str) continue;
    const [, , , d, x, y] = it.transform;
    const h = Math.abs(d) || it.height || 10;
    const row = rows.find((r) => Math.abs(r.y - y) <= h * 0.5);
    const cell = { x, str: it.str, w: it.width || 0, h, eol: it.hasEOL };
    if (row) row.cells.push(cell); else rows.push({ y, cells: [cell] });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    r.cells.sort((a, b) => a.x - b.x);
    let out = '', last = null;
    for (const c of r.cells) {
      if (last) {
        const gap = c.x - (last.x + last.w);
        out += gap > last.h * 1.2 ? '  -  ' : gap > last.h * 0.25 ? ' ' : '';
      }
      out += c.str;
      last = c;
    }
    return out.replace(/\s+-\s+-\s+/g, '  -  ').trim();
  }).filter(Boolean);
}

// Returns { text, pages, scanned: [canvas...], truncated }. `scanned` holds pages that need OCR.
export async function pdfToText(file, { onProgress } = {}) {
  const { getDocument } = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await getDocument({ data }).promise;
  const n = Math.min(doc.numPages, MAX_PAGES);
  const chunks = [], scanned = [];
  for (let i = 1; i <= n; i++) {
    onProgress?.({ page: i, pages: n });
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = linesFrom(content.items);
    const text = lines.join('\n');
    if (text.replace(/\s/g, '').length >= MIN_TEXT_CHARS) {
      chunks.push(text);
    } else {
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      scanned.push(canvas);
    }
  }
  return { text: chunks.join('\n\n'), pages: doc.numPages, scanned, truncated: doc.numPages > MAX_PAGES };
}
