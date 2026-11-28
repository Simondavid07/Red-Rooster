// Host crypto for Red Rooster admin security (plain Bun/Node version).
//
// Identical scheme to the original privileged handlers:
// - Passwords: scrypt, stored as "salt:hash" hex. Salt and hash never
//   leave the server.
// - Sessions: HMAC-SHA256 signed tokens "admin.<exp>.<sig>", signed with
//   the stored password hash as the key — changing the password kills
//   old sessions. Tokens expire after 7 days (SESSION_MS in actions.ts).

import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const derived = await scryptAsync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function sign(payload: string, passwordHash: string): string {
  return createHmac("sha256", passwordHash).update(payload).digest("hex");
}

export function signSession(passwordHash: string, exp: number): string {
  const payload = `admin.${exp}`;
  return `${payload}.${sign(payload, passwordHash)}`;
}

export function verifySession(passwordHash: string, token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "admin") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = `admin.${exp}.${sign(`admin.${exp}`, passwordHash)}`;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function randomHex(bytes: number): { hex: string } {
  return { hex: randomBytes(bytes).toString("hex") };
}
