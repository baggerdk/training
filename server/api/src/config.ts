import { fileURLToPath } from 'node:url';

// Configuration from environment variables (server/.env via compose). Fails fast on missing secrets.

export interface Config {
  db: { host: string; port: number; database: string };
  appPassword: string;
  ownerPassword: string;
  jwtSecret: string;
  corsOrigins: string[];
  inviteBaseUrl: string;
  migrationsDir: string;
  port: number;
  authRateLimit: number;   // attempts per minute per IP on /auth/*
  android: { packageName: string; certSha256: string[] };   // for /.well-known/assetlinks.json
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Miljøvariablen ${name} mangler`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = required(env, 'JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET skal være mindst 32 tegn');
  return {
    db: {
      host: env.DB_HOST ?? 'db',
      port: Number(env.DB_PORT ?? 5432),
      database: env.DB_NAME ?? 'powerkrop',
    },
    appPassword: required(env, 'APP_PASSWORD'),
    ownerPassword: required(env, 'OWNER_PASSWORD'),
    jwtSecret,
    corsOrigins: (env.CORS_ORIGINS ?? 'https://localhost').split(',').map(s => s.trim()).filter(Boolean),
    inviteBaseUrl: required(env, 'INVITE_BASE_URL'),
    migrationsDir: env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../../migrations', import.meta.url)),
    port: Number(env.PORT ?? 3000),
    authRateLimit: Number(env.AUTH_RATE_LIMIT ?? 10),
    android: {
      packageName: env.ANDROID_PACKAGE ?? 'dk.powerdot.powerkrop',
      certSha256: (env.ANDROID_CERT_SHA256 ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
    },
  };
}
