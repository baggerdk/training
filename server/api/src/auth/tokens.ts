import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export const ACCESS_TTL = '15m';
export const REFRESH_TTL_DAYS = 30;
export const INVITE_TTL_DAYS = 7;

export interface AccessClaims { id: string; role: string }

export function createTokenService(secret: string) {
  const key = new TextEncoder().encode(secret);
  return {
    async signAccess(user: AccessClaims): Promise<string> {
      return new SignJWT({ role: user.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id)
        .setIssuer('power-krop')
        .setIssuedAt()
        .setExpirationTime(ACCESS_TTL)
        .sign(key);
    },
    async verifyAccess(token: string): Promise<AccessClaims> {
      const { payload } = await jwtVerify(token, key, { issuer: 'power-krop', algorithms: ['HS256'] });
      if (!payload.sub) throw new Error('Token uden subject');
      return { id: payload.sub, role: String(payload.role) };
    },
  };
}
export type TokenService = ReturnType<typeof createTokenService>;

// Opaque tokens (refresh, invite): 256 random bits. Only the SHA-256 hash is stored in the database.
export const newOpaqueToken = (): string => randomBytes(32).toString('base64url');
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const daysFromNow = (d: number): Date => new Date(Date.now() + d * 86_400_000);
