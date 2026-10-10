import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createAppPool, type Db } from '../src/db.ts';
import { testConfig } from './env.ts';

const FINGERPRINT = '0F:8E:F1:CD:FD:6C:86:5B:FD:19:73:D9:96:03:9B:45:30:6F:28:97:3B:0C:59:9D:82:D8:8F:B8:EA:33:B3:DB';
let db: Db;

beforeAll(() => { db = createAppPool(testConfig()); });
afterAll(() => db.end());

describe('/.well-known/assetlinks.json', () => {
  it('peger App Links på appens pakkenavn og signeringscertifikat', async () => {
    const app = await buildApp(testConfig({ ANDROID_CERT_SHA256: FINGERPRINT.toLowerCase() }), db, { logger: false });
    const r = await app.inject({ method: 'GET', url: '/.well-known/assetlinks.json' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.json()).toEqual([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'dk.powerdot.powerkrop', sha256_cert_fingerprints: [FINGERPRINT] },
    }]);
    await app.close();
  });

  it('er tom, når fingeraftrykket ikke er sat', async () => {
    const app = await buildApp(testConfig(), db, { logger: false });
    expect((await app.inject({ method: 'GET', url: '/.well-known/assetlinks.json' })).json()).toEqual([]);
    await app.close();
  });
});
