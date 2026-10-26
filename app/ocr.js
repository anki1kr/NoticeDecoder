// Photo -> text, in the browser, with tesseract.js (pinned; the worker, the wasm core and the language model come from
// jsDelivr / tessdata on first use and are cached by the service worker, so later photos work offline). The image never
// leaves the device. Before recognition the photo is cleaned up on a canvas: notice-board photos are dim, tinted and
// slightly skewed, and plain Tesseract does much better on a scaled, grey, contrast-stretched copy.
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
const LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0_fast';
const LOW_CONFIDENCE = 60;
const LONG_SIDE = 1800;
const LOAD_TIMEOUT_MS = 120000;
const READ_TIMEOUT_MS = 180000;

let loading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  loading = loading || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT; s.async = true;
    s.onload = () => resolve(window.Tesseract);
    // Forget the failure, so the next photo (back online) tries again instead of failing forever until a reload.
    s.onerror = () => { loading = null; s.remove(); reject(new Error('The text reader did not load (offline on first use?). Try again with internet once; after that it works offline.')); };
    document.head.append(s);
  });
  return loading;
}

// Devanagari likely? (the user toggle wins; this is the default guess from the file name / previous text)
export const DEVANAGARI = /[ऀ-ॿ]/;

async function toCanvas(src) {
  if (src instanceof HTMLCanvasElement) return src;
  const bmp = await createImageBitmap(src);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

// Scale to a sane size, grey, stretch contrast between the 2nd and 98th percentile, mild sharpen via threshold-free gamma.
export function preprocess(canvas) {
  const scale = Math.min(1, LONG_SIDE / Math.max(canvas.width, canvas.height)) * (Math.max(canvas.width, canvas.height) < 900 ? 2 : 1);
  const w = Math.round(canvas.width * scale), h = Math.round(canvas.height * scale);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = d[i + 1] = d[i + 2] = g;
    hist[g | 0]++;
  }
  const total = w * h;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    let g = ((d[i] - lo) / span) * 255;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    g = 255 * Math.pow(g / 255, 1.15); // push paper towards white, ink stays dark
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

// A promise that gives up after `ms` with a message the student can act on.
function within(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}

// Returns { text, confidence, lowLines: [{ text, confidence }], lang }.
export async function ocrImage(src, { hindi = false, onProgress } = {}) {
  const T = await loadTesseract();
  const canvas = preprocess(await toCanvas(src));
  const lang = hindi ? 'hin+eng' : 'eng';
  // A dropped or stalled download of the language data used to leave "Preparing the reader…" on screen forever, with an
  // uncaught error from inside tesseract.js. Now it has a handler and a deadline.
  // tesseract.js reports a failed download only to errorHandler; its own promise may never settle, so we fail it here.
  let failLoad;
  const loadFailed = new Promise((_, reject) => { failLoad = reject; });
  loadFailed.catch(() => {});
  const starting = T.createWorker(lang, 1, {
    langPath: LANG_PATH,
    errorHandler: (e) => { console.warn('OCR worker:', e); failLoad(new Error(String(e))); },
    logger: (m) => { if (m.status === 'recognizing text') onProgress?.({ stage: 'read', progress: m.progress }); else onProgress?.({ stage: m.status, progress: m.progress || 0 }); },
  });
  let worker;
  try {
    worker = await within(Promise.race([starting, loadFailed]), LOAD_TIMEOUT_MS, 'The text reader is taking too long to download (slow internet?). Try again, or paste the text instead.');
  } catch (err) {
    starting.then((w) => w.terminate()).catch(() => {});
    throw new Error(/too long/.test(err?.message) ? err.message : 'The text reader could not download its language data (offline or a weak connection?). Try once with internet; after that it works offline.');
  }
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const { data } = await within(worker.recognize(canvas, {}, { blocks: true }), READ_TIMEOUT_MS, 'Reading this picture took too long. Crop it to the notice and try again.');
    const lines = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) lines.push({ text: l.text.replace(/\s+$/, ''), confidence: l.confidence });
    const text = lines.length ? lines.map((l) => l.text).join('\n') : data.text;
    const lowLines = lines.filter((l) => l.confidence < LOW_CONFIDENCE && l.text.trim().length > 3);
    return { text, confidence: data.confidence, lowLines, lang };
  } finally {
    await worker.terminate();
  }
}
