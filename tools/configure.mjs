// Writes the deployment settings into every file that carries them, so no hand edits after the console steps:
//   node tools/configure.mjs --google-client-id 1234-abc.apps.googleusercontent.com --feed-base https://notice-decoder-feed.x.workers.dev
// Options: --google-client-id <id>   -> app/config.js GOOGLE_CLIENT_ID
//          --feed-base <url>         -> app/config.js FEED_BASE, companion/app.json extra.feedBase
//          --app-url <url>           -> companion/app.json extra.appUrl, worker/wrangler.toml APP_URL
//          --kv-id <id>              -> worker/wrangler.toml CLASSES namespace id
//          --show                    -> print the current values and exit
// Every write bumps app/sw.js VERSION so installed copies pick the change up. Prints what changed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(root, p), s);
const changed = [];

function setConst(file, name, value) {
  const s = read(file);
  const re = new RegExp(`(export const ${name} = ')[^']*(';)`);
  if (!re.test(s)) throw new Error(`${file}: ${name} not found`);
  const next = s.replace(re, `$1${value}$2`);
  if (next !== s) { write(file, next); changed.push(`${file}: ${name} = '${value}'`); }
}

function setJson(file, pathKeys, value) {
  const j = JSON.parse(read(file));
  let o = j;
  for (const k of pathKeys.slice(0, -1)) o = o[k];
  const last = pathKeys[pathKeys.length - 1];
  if (o[last] !== value) { o[last] = value; write(file, JSON.stringify(j, null, 2) + '\n'); changed.push(`${file}: ${pathKeys.join('.')} = ${JSON.stringify(value)}`); }
}

function setToml(file, key, value) {
  const s = read(file);
  const re = new RegExp(`^(${key} = ")[^"]*(")`, 'm');
  if (!re.test(s)) throw new Error(`${file}: ${key} not found`);
  const next = s.replace(re, `$1${value}$2`);
  if (next !== s) { write(file, next); changed.push(`${file}: ${key} = "${value}"`); }
}

function show() {
  const cfg = read('app/config.js');
  const get = (n) => (cfg.match(new RegExp(`export const ${n} = '([^']*)'`)) || [])[1] || '';
  const app = JSON.parse(read('companion/app.json')).expo.extra;
  const toml = read('worker/wrangler.toml');
  console.log('GOOGLE_CLIENT_ID :', get('GOOGLE_CLIENT_ID') || '(empty: one-tap Google button disabled)');
  console.log('FEED_BASE        :', get('FEED_BASE') || '(empty: class calendar section hidden)');
  console.log('companion appUrl :', app.appUrl, '| feedBase:', app.feedBase || '(empty)');
  console.log('worker APP_URL   :', (toml.match(/^APP_URL = "([^"]*)"/m) || [])[1]);
  console.log('worker KV id     :', (toml.match(/^id = "([^"]*)"/m) || [])[1]);
  console.log('sw VERSION       :', (read('app/sw.js').match(/const VERSION = '([^']+)'/) || [])[1]);
}

if (args.includes('--show') || !args.length) { show(); process.exit(0); }

const clientId = opt('--google-client-id'), feed = opt('--feed-base'), appUrl = opt('--app-url'), kv = opt('--kv-id');
if (clientId !== null) {
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('A Google client id ends with .apps.googleusercontent.com');
  setConst('app/config.js', 'GOOGLE_CLIENT_ID', clientId);
}
if (feed !== null) {
  const base = feed.replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('--feed-base must be an https URL');
  setConst('app/config.js', 'FEED_BASE', base);
  setJson('companion/app.json', ['expo', 'extra', 'feedBase'], base);
}
if (appUrl !== null) {
  const u = appUrl.endsWith('/') ? appUrl : `${appUrl}/`;
  setJson('companion/app.json', ['expo', 'extra', 'appUrl'], u);
  setToml('worker/wrangler.toml', 'APP_URL', u);
}
if (kv !== null) setToml('worker/wrangler.toml', 'id', kv);

if (changed.length) {
  const sw = read('app/sw.js');
  const m = sw.match(/const VERSION = 'nd-v(\d+)'/);
  const next = `nd-v${Number(m[1]) + 1}`;
  write('app/sw.js', sw.replace(m[0], `const VERSION = '${next}'`));
  changed.push(`app/sw.js: VERSION = '${next}'`);
  console.log(changed.map((c) => `  ${c}`).join('\n'));
  console.log('\nNow: git add -A && git commit -m "configure" && git push   (Pages redeploys; then node tools/smoke-live.mjs)');
} else {
  console.log('Nothing changed.');
}
show();
