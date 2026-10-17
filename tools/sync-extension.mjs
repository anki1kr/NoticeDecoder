// Copies the bundled engine into the Chrome extension so it runs the exact rules the web app does.
// Run after tools/bundle-engine.mjs: node tools/bundle-engine.mjs && node tools/sync-extension.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
fs.copyFileSync(path.join(root, 'dist/notice-engine.js'), path.join(root, 'extension/engine.js'));
console.log('extension/engine.js updated');
