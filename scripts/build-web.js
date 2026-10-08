// Copies the static web app into www/ (Capacitor's webDir) and adds the Capacitor runtime.
// The repo root stays the GitHub Pages site, so nothing here may move files out of the root.
'use strict';
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'www');
// sw.js is left out on purpose: the native app ships all files in the APK and needs no service worker
const ENTRIES = ['index.html', 'manifest.webmanifest', 'css', 'js', 'img', 'icons'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
for (const e of ENTRIES) fs.cpSync(path.join(ROOT, e), path.join(OUT, e), { recursive: true });

// Capacitor core as a plain script (global capacitorExports), loaded before js/platform.js
fs.mkdirSync(path.join(OUT, 'vendor'));
fs.copyFileSync(require.resolve('@capacitor/core/dist/capacitor.js'), path.join(OUT, 'vendor', 'capacitor.js'));
const index = path.join(OUT, 'index.html');
const html = fs.readFileSync(index, 'utf8');
const tag = '<script src="js/platform.js"></script>';
if (!html.includes(tag)) throw new Error('index.html mangler ' + tag);
fs.writeFileSync(index, html.replace(tag, '<script src="vendor/capacitor.js"></script>\n  ' + tag));

console.log('www/ bygget: ' + ENTRIES.join(', ') + ' + vendor/capacitor.js');
