import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createAppPool, type Db } from '../src/db.ts';
import { testConfig } from './env.ts';

let db: Db, dir: string, empty: string;
beforeAll(() => {
  db = createAppPool(testConfig());
  dir = mkdtempSync(path.join(tmpdir(), 'pk-apk-'));
  empty = mkdtempSync(path.join(tmpdir(), 'pk-apk-empty-'));
  writeFileSync(path.join(dir, 'power-krop.apk'), Buffer.from('PK\u0003\u0004fake-apk'));
  writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ versionCode: 2, versionName: '1.1', minSupportedVersionCode: 1 }));
});
afterAll(async () => { await db.end(); rmSync(dir, { recursive: true }); rmSync(empty, { recursive: true }); });

describe('distribution af appen fra egen server', () => {
  it('/app/version fortæller seneste version til opdateringstjekket', async () => {
    const app = await buildApp(testConfig({ APK_DIR: dir }), db, { logger: false });
    const r = await app.inject({ method: 'GET', url: '/app/version' });
    expect(r.json()).toEqual({ versionCode: 2, versionName: '1.1', minSupportedVersionCode: 1, apkUrl: '/app/power-krop-2.apk' });
    await app.close();
  });

  it('APK\'en hentes med Androids MIME-type og versionsnavn i filnavnet', async () => {
    const app = await buildApp(testConfig({ APK_DIR: dir }), db, { logger: false });
    const r = await app.inject({ method: 'GET', url: '/app/power-krop-2.apk' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(r.headers['content-disposition']).toContain('power-krop-1.1.apk');
    expect(r.rawPayload.toString()).toContain('fake-apk');
    const page = await app.inject({ method: 'GET', url: '/app' });
    expect(page.body).toContain('Hent appen (version 1.1)');
    expect(page.body).toContain('href="/app/power-krop-2.apk"');
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    await app.close();
  });

  it('ny adresse pr. version: den faste og gamle adresser sender videre til den nyeste (Cloudflare-cache)', async () => {
    const app = await buildApp(testConfig({ APK_DIR: dir }), db, { logger: false });
    for (const url of ['/app/power-krop.apk', '/app/power-krop-1.apk']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(302);
      expect(r.headers.location).toBe('/app/power-krop-2.apk');
      expect(r.headers['cache-control']).toBe('no-store');
    }
    expect((await app.inject({ method: 'GET', url: '/app/noget-andet.apk' })).statusCode).toBe(404);
    await app.close();
  });

  it('uden udgivelse giver alt 404 – og siden siger det', async () => {
    const app = await buildApp(testConfig({ APK_DIR: empty }), db, { logger: false });
    expect((await app.inject({ method: 'GET', url: '/app/version' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/app/power-krop.apk' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/app' })).body).toContain('ikke udgivet endnu');
    await app.close();
  });
});
