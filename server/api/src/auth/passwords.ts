import { hash, verify } from '@node-rs/argon2';

// argon2id with the library defaults (m=19 MiB, t=2, p=1 – OWASP's minimum recommendation)
export const hashPassword = (password: string): Promise<string> => hash(password);

export async function verifyPassword(hashed: string | null, password: string): Promise<boolean> {
  // Still spend the time on unknown users, so response time doesn't reveal which e-mails exist
  if (!hashed) { await hash(password); return false; }
  try { return await verify(hashed, password); } catch { return false; }
}

export const PASSWORD_MIN = 10;
