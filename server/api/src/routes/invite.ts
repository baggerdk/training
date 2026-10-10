import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.ts';

// Fallback page for invite links. When the app is installed, Android opens https://<host>/invite/<token>
// in the app (App Links) and this page is never shown. Otherwise it explains how to get the app and shows the
// code to paste into "Har du en invitationskode?". The token is not checked here, so the page reveals nothing.
const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · power-krop</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d0f13; color: #eef1f6; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 440px; margin: 0 auto; padding: 32px 16px; }
  .logo { font-size: 2.6rem; text-align: center; } h1 { text-align: center; margin: 8px 0 24px; font-size: 1.6rem; }
  .card { background: #1b1f29; border: 1px solid #2c3243; border-radius: 16px; padding: 16px; margin-bottom: 14px; }
  .btn { display: flex; align-items: center; justify-content: center; min-height: 48px; border-radius: 14px; font-weight: 700;
         text-decoration: none; background: #ff7a1a; color: #1a0d00; margin-top: 12px; }
  .btn.ghost { background: transparent; color: #eef1f6; border: 1px solid #2c3243; }
  ol { padding-left: 20px; margin: 8px 0 0; } .muted { color: #a3abbd; font-size: .9rem; }
  input { width: 100%; box-sizing: border-box; min-height: 48px; border-radius: 12px; border: 1px solid #2c3243; background: #151820;
          color: #eef1f6; font: 600 .95rem ui-monospace, monospace; padding: 0 12px; margin-top: 8px; }
</style></head><body><main><div class="logo">💪</div><h1>power-krop</h1>${body}</main></body></html>`;
}

export async function inviteRoutes(app: FastifyInstance, { cfg }: Deps) {
  app.get<{ Params: { token: string } }>('/invite/:token', async (req, reply) => {
    reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-robots-tag', 'noindex')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");

    const token = req.params.token;
    if (!TOKEN_RE.test(token)) {
      return reply.code(404).send(page('Ugyldigt link', `<div class="card"><b>Linket er ugyldigt.</b>
        <p class="muted">Bed din træner om et nyt invitationslink.</p></div>`));
    }
    const host = cfg.inviteBaseUrl.replace(/^https?:\/\//, '').replace(/\/invite\/?$/, '');
    // Opens the app even when Android has not verified the App Link (e.g. a debug build)
    const intent = `intent://${host}/invite/${token}#Intent;scheme=https;package=${cfg.android.packageName};end`;
    const download = cfg.apkUrl
      ? `<a class="btn" href="${esc(cfg.apkUrl)}">Hent power-krop (Android)</a>`
      : `<p class="muted">Bed din træner om installationsfilen (APK) til appen.</p>`;
    return page('Invitation', `<div class="card"><b>Du er inviteret til power-krop</b>
      <p class="muted">Har du appen? Så åbn invitationen i den:</p>
      <a class="btn" href="${esc(intent)}">Åbn i appen</a></div>
      <div class="card"><b>Har du ikke appen endnu?</b>
      <ol><li>Installér appen på din Android-telefon.</li><li>Åbn den, og tryk <b>Har du en invitationskode?</b></li>
      <li>Indsæt koden herunder, og vælg dit password.</li></ol>
      ${download}
      <p class="muted" style="margin-top:16px">Din invitationskode (gyldig i 7 dage, kun til dig):</p>
      <input readonly value="${esc(token)}" aria-label="Invitationskode"></div>`);
  });
}
