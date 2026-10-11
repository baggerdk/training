// Lille lokal testserver: node serve.js  →  http://localhost:8080
const http = require('http'), fs = require('fs'), path = require('path');
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(__dirname, p);
  if (!f.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, d) => { if (err) { res.writeHead(404); return res.end('404'); } res.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(d); });
}).listen(process.env.PORT || 8080, () => console.log('power-krop kører på http://localhost:' + (process.env.PORT || 8080)));
