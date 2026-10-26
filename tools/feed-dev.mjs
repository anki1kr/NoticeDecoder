// The class-feed Worker on plain Node: no wrangler, no Cloudflare account. An in-memory KV, and with --fake-ai a
// stand-in for Claude, so the browser checks (tools/break-check.mjs) drive the REAL handler end to end, and a demo
// works offline. Nothing here is deployed.
//   node tools/feed-dev.mjs [--port 8787] [--fake-ai | --real-ai] [--app 8771]
//   --real-ai   the real Claude Haiku, key from the ANTHROPIC_API_KEY environment variable (never from a file)
//   --app 8771  also serves app/ on that port, pointed at this feed: a whole local demo at one link
// Dev-only routes: GET /__dev/ai-calls (how many times "Claude" was called), POST /__dev/reset (empty the KV).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { route, ClassRoom } from '../worker/src/index.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const port = Number(arg('--port', 8787));
const appPort = Number(arg('--app', 0));
const fakeAi = process.argv.includes('--fake-ai');
const realAi = process.argv.includes('--real-ai') && Boolean(process.env.ANTHROPIC_API_KEY);
if (process.argv.includes('--real-ai') && !realAi) { console.error('--real-ai needs ANTHROPIC_API_KEY in the environment'); process.exit(2); }

const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } };
let aiCalls = 0;

// A pretend model: names an event after the first "Proper Name + Challenge/Hackathon/Fest/…" phrase in the notice,
// and reports a missed event when the notice has a line starting "Also:". Shape = the real Messages API response.
const NAMED = /\b((?:[A-Z][\w&-]*\s+){1,4}(?:Challenge|Hackathon|Ideathon|Fest|Olympiad|Drive|Symposium|Expo|Mela|Utsav))\b/;
async function fakeClaude(url, init) {
  aiCalls++;
  const body = JSON.parse(init.body);
  const content = body.messages[0].content;
  const notice = /"""\n([\s\S]*?)\n"""/.exec(content)[1];
  const lines = content.split('\n').filter((l) => /^\d+ \| /.test(l));
  const named = NAMED.exec(notice);
  const events = lines.map((l) => {
    const [n, , , type, title] = l.split(' | ');
    return named && /^(?:practical|event|test)$/i.test(title)
      ? { n: Number(n), title: named[1].trim(), type: 'other', real: true, evidence: named[1].trim() }
      : { n: Number(n), title, type, real: true, evidence: title };
  });
  const also = /^Also:\s*(.+?) on (\d{1,2} \w+ \d{4})(?: at (\d{1,2}(?::\d{2})?\s*[AP]M))?/im.exec(notice);
  const missed = also ? [{ title: also[1], type: 'other', date_text: also[2], time_text: also[3] || '', venue: '', evidence: also[1] }] : [];
  await new Promise((r) => setTimeout(r, 300)); // a real call takes a while: the UI must show it is busy
  return new Response(JSON.stringify({ id: 'msg_dev', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify({ events, missed }) }], usage: { input_tokens: Math.round(content.length / 4), output_tokens: 60 } }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const env = {
  CLASSES: kv,
  APP_URL: 'http://127.0.0.1:8771/',
  AI_ORIGINS: 'http://127.0.0.1:8771',
  AI_DAILY_CAP: '1000',
  ...(fakeAi ? { ANTHROPIC_API_KEY: 'sk-dev-fake', AI_FETCH: fakeClaude } : {}),
  ...(realAi ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, AI_FETCH: async (url, init) => { aiCalls++; return fetch(url, init); } } : {}),
};
// One in-memory "Durable Object" per class, as in production: requests to a class run one at a time.
const rooms = new Map();
function memoryCtx() {
  const map = new Map();
  let chain = Promise.resolve();
  return { storage: { get: async (k) => map.get(k), put: async (k, v) => { map.set(k, v); }, delete: async (k) => { map.delete(k); } },
    blockConcurrencyWhile(fn) { const run = chain.then(fn); chain = run.catch(() => {}); return run; } };
}
env.ROOMS = { idFromName: (n) => n, get: (id) => { if (!rooms.has(id)) rooms.set(id, new ClassRoom(memoryCtx(), env)); return rooms.get(id); } };

// The app on its own port (a different origin, as in production: on the same origin the app's service worker would
// cache the feed's JSON). index.html gets one line that points it at this feed instead of the deployed one.
if (appPort) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
  env.APP_URL = `http://127.0.0.1:${appPort}/`;
  env.AI_ORIGINS = `http://127.0.0.1:${appPort}`;
  http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (req.method === 'POST') { res.writeHead(303, { location: './' }); res.end(); return; } // share target without the SW
      res.writeHead(404); res.end('Not found'); return;
    }
    let body = fs.readFileSync(file);
    if (rel === 'index.html') body = Buffer.from(String(body).replace('<script type="module" src="app.js">', `<script>window.__ndFeedBase = 'http://127.0.0.1:${port}';</script>\n  <script type="module" src="app.js">`));
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  }).listen(appPort, '127.0.0.1', () => console.log(`app on http://127.0.0.1:${appPort}/ (pointed at this feed)`));
}

http.createServer(async (req, res) => {
  try {
    if (req.url === '/__dev/ai-calls') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ calls: aiCalls })); return; }
    if (req.url === '/__dev/reset' && req.method === 'POST') { store.clear(); rooms.clear(); aiCalls = 0; res.writeHead(204, { 'access-control-allow-origin': '*' }); res.end(); return; }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'connection', 'content-length'].includes(k)));
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) || !chunks.length ? undefined : Buffer.concat(chunks) });
    const r = await route(request, env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.writeHead(500); res.end(String(err));
  }
}).listen(port, '127.0.0.1', () => console.log(`feed-dev on http://127.0.0.1:${port}${fakeAi ? ' (fake AI on)' : realAi ? ' (REAL Claude Haiku)' : ''}`));
