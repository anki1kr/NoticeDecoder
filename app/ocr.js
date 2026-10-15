// Photo -> text, in the browser, with tesseract.js (pinned; the worker, the wasm core and the language model come from
// jsDelivr / tessdata on first use and are cached by the service worker, so later photos work offline). The image never
// leaves the device. Before recognition the photo is cleaned up on a canvas: notice-board photos are dim, tinted and
// slightly skewed, and plain Tesseract does much better on a scaled, grey, contrast-stretched copy.
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
const LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0_fast';
const LOW_CONFIDENCE = 60;
const LONG_SIDE = 1800;

let loading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  loading = loading || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT; s.async = true;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error('The text reader did not load (offline on first use?). Try again with internet once; after that it works offline.'));
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

// Returns { text, confidence, lowLines: [{ text, confidence }], lang }.
export async function ocrImage(src, { hindi = false, onProgress } = {}) {
  const T = await loadTesseract();
  const canvas = preprocess(await toCanvas(src));
  const lang = hindi ? 'hin+eng' : 'eng';
  const worker = await T.createWorker(lang, 1, {
    langPath: LANG_PATH,
    logger: (m) => { if (m.status === 'recognizing text') onProgress?.({ stage: 'read', progress: m.progress }); else onProgress?.({ stage: m.status, progress: m.progress || 0 }); },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const lines = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) lines.push({ text: l.text.replace(/\s+$/, ''), confidence: l.confidence });
    const text = lines.length ? lines.map((l) => l.text).join('\n') : data.text;
    const lowLines = lines.filter((l) => l.confidence < LOW_CONFIDENCE && l.text.trim().length > 3);
    return { text, confidence: data.confidence, lowLines, lang };
  } finally {
    await worker.terminate();
  }
}
