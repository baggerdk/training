// Distribution of the Android app from our own server (the repo is private, so GitHub Releases can't be used):
//   GET /app                 download page with install instructions
//   GET /app/power-krop.apk  the latest signed APK
//   GET /app/version         { versionCode, versionName, apkUrl, minSupportedVersionCode } for the update check
// The files live in APK_DIR (server/apk on the server, mounted read-only): power-krop.apk + version.json.
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.ts';

interface VersionInfo { versionCode: number; versionName: string; minSupportedVersionCode?: number }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export async function appDistRoutes(app: FastifyInstance, { cfg }: Deps) {
  const apkFile = path.join(cfg.apkDir, 'power-krop.apk');

  async function version(): Promise<VersionInfo | null> {
    try { return JSON.parse(await readFile(path.join(cfg.apkDir, 'version.json'), 'utf8')) as VersionInfo; } catch { return null; }
  }

  app.get('/app/version', async (_req, reply) => {
    const v = await version();
    if (!v) return reply.code(404).send({ error: 'not_found', message: 'Ingen version udgivet endnu' });
    reply.header('cache-control', 'no-cache');
    return { versionCode: v.versionCode, versionName: v.versionName, minSupportedVersionCode: v.minSupportedVersionCode ?? 1, apkUrl: '/app/power-krop.apk' };
  });

  app.get('/app/power-krop.apk', async (_req, reply) => {
    let size: number;
    try { size = (await stat(apkFile)).size; } catch { return reply.code(404).send({ error: 'not_found', message: 'Appen er ikke udgivet endnu' }); }
    const v = await version();
    return reply
      .header('content-type', 'application/vnd.android.package-archive')
      .header('content-disposition', `attachment; filename="power-krop${v ? '-' + v.versionName : ''}.apk"`)
      .header('content-length', String(size))
      .header('cache-control', 'no-cache')
      .send(createReadStream(apkFile));
  });

  app.get('/app', async (_req, reply) => {
    const v = await version();
    reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-cache').header('x-robots-tag', 'noindex')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hent power-krop</title><style>
  :root { color-scheme: dark; } body { margin: 0; background: #0d0f13; color: #eef1f6; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 460px; margin: 0 auto; padding: 32px 16px; } h1 { text-align: center; margin: 8px 0 4px; } .logo { font-size: 2.6rem; text-align: center; }
  .card { background: #1b1f29; border: 1px solid #2c3243; border-radius: 16px; padding: 16px; margin: 16px 0; }
  .btn { display: flex; align-items: center; justify-content: center; min-height: 52px; border-radius: 14px; font-weight: 800; text-decoration: none; background: #ff7a1a; color: #1a0d00; }
  .muted { color: #a3abbd; font-size: .9rem; } ol { padding-left: 20px; } li { margin: 6px 0; }
</style></head><body><main><div class="logo">💪</div><h1>power-krop</h1>
<p class="muted" style="text-align:center;margin:0">Calisthenics, powerløft og military styrke · Android</p>
<div class="card">${v ? `<a class="btn" href="/app/power-krop.apk">Hent appen (version ${esc(v.versionName)})</a>` : '<p>Appen er ikke udgivet endnu.</p>'}</div>
<div class="card"><b>Sådan installerer du den</b><ol>
  <li>Tryk <b>Hent appen</b>, og åbn filen, når den er hentet.</li>
  <li>Spørger telefonen, om din browser eller filhåndtering må installere ukendte apps, så tillad det.</li>
  <li>Samsung: Er <b>Automatisk blokering</b> slået til (Indstillinger → Sikkerhed og privatliv), skal den slås fra under installationen.</li>
  <li>Åbn appen, og log ind med den invitation, du har fået af din træner.</li></ol>
<p class="muted">En ny version installeres på samme måde – dine data bevares.</p></div></main></body></html>`;
  });
}
