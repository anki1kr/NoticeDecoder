// .docx -> text in the browser, no library and no download: a .docx is a zip, and word/document.xml holds the
// paragraphs (w:p), the text runs (w:t), tabs, line breaks and tables (w:tbl > w:tr > w:tc). Table rows come out as
// "cell | cell | cell", so a timetable row stays one line and the engine's timetable rules read it.
// Works in Node 18+ too (DecompressionStream is global there), which is how tests/files.test.mjs runs it.
const MAX_XML = 20 * 1024 * 1024;

export async function docxToText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.length < 22 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error(buf[0] === 0xd0 && buf[1] === 0xcf ? 'This is an old Word file (.doc). Open it and save it as .docx or PDF, then upload that.' : 'This file is not a Word document (.docx).');
  }
  const xml = await unzipEntry(buf, 'word/document.xml');
  if (xml === null) throw new Error('This file is a zip but not a Word document (no word/document.xml).');
  return xmlToText(xml);
}

async function unzipEntry(buf, name) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This Word file is damaged (its zip directory is missing). Open and save it again.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let k = 0; k < count && p + 46 <= buf.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
    const fname = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    if (fname === name) {
      if (flags & 1) throw new Error('This Word file is password-protected. Remove the password, or save it as PDF.');
      if (local + 30 > buf.length || dv.getUint32(local, true) !== 0x04034b50) throw new Error('This Word file is damaged. Open and save it again.');
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return new TextDecoder().decode(data.subarray(0, MAX_XML));
      if (method === 8) return new TextDecoder().decode(await inflateRaw(data));
      throw new Error('This Word file uses a compression the reader does not know. Save it as PDF.');
    }
    p += 46 + nlen + elen + clen;
  }
  return null;
}

// Inflate with a ceiling: a 20 KB "zip bomb" must not grow into gigabytes in the student's phone.
async function inflateRaw(data) {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_XML) { await reader.cancel(); throw new Error('This Word file is too large to read here. Save it as PDF.'); }
      chunks.push(value);
    }
  } catch (err) {
    if (/too large/.test(err.message)) throw err;
    throw new Error('This Word file is damaged. Open and save it again.');
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, d, h, n) => (d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : ENTITY[n] ?? m));

// A small state machine over the tags that carry text. No DOMParser, so it runs the same in a worker or in Node.
export function xmlToText(xml) {
  const body = (/<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(xml) || [, xml])[1];
  const lines = [];
  let para = '', cell = '', row = [], depth = 0, inText = false, inProps = false;
  for (const m of body.matchAll(/<(\/?)w:(p|pPr|tbl|tr|tc|t|tab|br|cr)\b[^>]*?(\/?)>|([^<]+)|<[^>]*>/g)) {
    const [, close, tag, selfClose, text] = m;
    if (text !== undefined) { if (inText) para += decode(text); continue; }
    if (!tag) continue;
    if (tag === 'pPr') { inProps = !close && !selfClose; continue; } // tab STOPS live here, not tab characters
    if (tag === 't') { inText = !close && !selfClose; continue; }
    if (tag === 'tab' && !close && !inProps) { para += '\t'; continue; }
    if ((tag === 'br' || tag === 'cr') && !close) { para += '\n'; continue; }
    if (tag === 'tbl') { depth += close ? -1 : 1; continue; }
    if (tag === 'p' && (close || selfClose)) {
      if (depth > 0) cell += (cell ? ' ' : '') + para.replace(/\s+/g, ' ').trim();
      else lines.push(para.replace(/[ \t]+$/g, ''));
      para = '';
      continue;
    }
    if (tag === 'tc' && close) { row.push(cell.trim()); cell = ''; continue; }
    if (tag === 'tr' && close) { const cells = row.filter(Boolean); if (cells.length) lines.push(cells.join(' | ')); row = []; continue; }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
