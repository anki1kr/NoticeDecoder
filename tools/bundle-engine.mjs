// Bundles app/engine/*.js into one plain script, dist/notice-engine.js, that sets globalThis.NoticeEngine.
// For hosts that cannot load ES modules: Google Apps Script (the Gmail integration) and any copy-paste use.
// No dependencies: each module is wrapped in its own function scope, imports become destructuring of the
// previous module's exports, so the engine source stays exactly the one the web app runs.
// Run: node tools/bundle-engine.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ORDER = ['ocrfix.js', 'dates.js', 'holidays.js', 'parse.js', 'clash.js', 'ics.js'];
const PUBLIC = ['parseNotice', 'findClashes', 'toICS', 'gcalUrl', 'calendarEntries', 'REMINDER', 'TZ', 'HOLIDAYS', 'holidayOn', 'findDates', 'findTimes', 'findDurations', 'fmt12', 'prettyDate', 'fixOcrText', 'normalizeNames'];

const mods = {};
for (const file of ORDER) {
  let src = fs.readFileSync(path.join(root, 'app/engine', file), 'utf8').replace(/\r\n/g, '\n');
  const imports = [];
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+)\.js';\s*$/gm, (_, names, from) => {
    imports.push({ names: names.split(',').map((s) => s.trim()).filter(Boolean), from: `${from}.js` });
    return '';
  });
  const exported = [];
  src = src.replace(/^export\s+(async\s+function|function|const|let|class)\s+([\w$]+)/gm, (_, kind, name) => { exported.push(name); return `${kind} ${name}`; });
  if (/^export\s/m.test(src)) throw new Error(`${file}: an export form the bundler does not know`);
  mods[file] = { src, imports, exported };
}

const varName = (file) => `__${file.replace('.js', '')}`;
let out = `/* Notice Decoder engine, bundled from app/engine/*.js by tools/bundle-engine.mjs. Do not edit: edit the modules. */\n(function (root) {\n'use strict';\n`;
for (const file of ORDER) {
  const m = mods[file];
  out += `\n// ---- ${file} ----\nconst ${varName(file)} = (() => {\n`;
  for (const imp of m.imports) out += `  const { ${imp.names.join(', ')} } = ${varName(imp.from)};\n`;
  out += m.src.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n');
  out += `\n  return { ${m.exported.join(', ')} };\n})();\n`;
}
const where = (name) => ORDER.find((f) => mods[f].exported.includes(name));
const missing = PUBLIC.filter((n) => !where(n));
if (missing.length) throw new Error(`Not exported by any module: ${missing.join(', ')}`);
// Version = hash of the module sources, so the output is byte-identical until the engine changes (CI diffs it).
let h = 0x811c9dc5;
for (const file of ORDER) for (let i = 0; i < mods[file].src.length; i++) { h ^= mods[file].src.charCodeAt(i); h = Math.imul(h, 0x01000193); }
out += `\nroot.NoticeEngine = {\n${PUBLIC.map((n) => `  ${n}: ${varName(where(n))}.${n},`).join('\n')}\n  version: ${JSON.stringify((h >>> 0).toString(16))},\n};\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/notice-engine.js'), out);
console.log(`dist/notice-engine.js: ${out.length} chars, ${ORDER.length} modules, ${PUBLIC.length} public names`);
