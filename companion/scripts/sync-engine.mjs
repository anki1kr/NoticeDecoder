// Copies the bundled engine (dist/notice-engine.js, built by ../tools/bundle-engine.mjs) into companion/engine/
// so Metro bundles the exact rules the web app runs. Run before every start/build (the npm scripts do).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
execFileSync(process.execPath, [path.join(repo, 'tools/bundle-engine.mjs')], { stdio: 'inherit' });
fs.mkdirSync(path.join(here, '../engine'), { recursive: true });
fs.copyFileSync(path.join(repo, 'dist/notice-engine.js'), path.join(here, '../engine/notice-engine.js'));
console.log('companion/engine/notice-engine.js synced');
