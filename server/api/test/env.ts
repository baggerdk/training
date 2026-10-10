// Matches compose.test.yml
import type { Config } from '../src/config.ts';
import { loadConfig } from '../src/config.ts';

export const TEST_DB = { host: '127.0.0.1', port: 15433, database: 'powerkrop' };
export const SUPERUSER = { ...TEST_DB, user: 'postgres', password: 'test-superuser' };

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    AUTH_RATE_LIMIT: '1000',
    DB_HOST: TEST_DB.host,
    DB_PORT: String(TEST_DB.port),
    DB_NAME: TEST_DB.database,
    OWNER_PASSWORD: 'test-owner',
    APP_PASSWORD: 'test-app',
    JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
    CORS_ORIGINS: 'https://localhost',
    INVITE_BASE_URL: 'https://api.example.test/invite/',
    ...overrides,
  });
}
