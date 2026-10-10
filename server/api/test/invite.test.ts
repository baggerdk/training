import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createAppPool, type Db } from '../src/db.ts';
import { testConfig } from './env.ts';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
let db: Db;

beforeAll(() => { db = createAppPool(testConfig()); });
afterAll(() => db.end());

describe('GET /invite/:token (siden for dem uden appen)', () => {
  it('viser koden og et intent-link, der åbner appen', async () => {
    const app = await buildApp(testConfig({ APK_URL: 'https://github.com/x/y/releases/latest' }), db, { logger: false });
    const r = await app.inject({ method: 'GET', url: `/invite/${TOKEN}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.body).toContain(`value="${TOKEN}"`);
    expect(r.body).toContain(`intent://api.example.test/invite/${TOKEN}#Intent;scheme=https;package=dk.powerdot.powerkrop;end`);
    expect(r.body).toContain('href="https://github.com/x/y/releases/latest"');
    expect(r.body).not.toContain('<script');
    await app.close();
  });

  it('afviser noget, der ikke ligner et token, uden at ekko det', async () => {
    const app = await buildApp(testConfig(), db, { logger: false });
    const r = await app.inject({ method: 'GET', url: '/invite/%3Cscript%3Ealert(1)%3C%2Fscript%3E' });
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain('<script>');
    await app.close();
  });

  it('beder om APK fra træneren, når der ikke er et download-link', async () => {
    const app = await buildApp(testConfig(), db, { logger: false });
    const r = await app.inject({ method: 'GET', url: `/invite/${TOKEN}` });
    expect(r.body).toContain('Bed din træner om installationsfilen');
    await app.close();
  });
});
