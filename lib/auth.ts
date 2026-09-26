import { env } from "cloudflare:workers";
import { hashSessionToken } from "./access-identity";

const ITERATIONS = 120000;
const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function derivePassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const result = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, key, 256);
  return base64url(new Uint8Array(result));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${base64url(salt)}$${await derivePassword(password, salt)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterations, encodedSalt, expected] = stored.split("$");
  if (algorithm !== "pbkdf2" || Number(iterations) !== ITERATIONS || !encodedSalt || !expected) return false;
  return (await derivePassword(password, bytes(encodedSalt))) === expected;
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: string }> {
  if (!env.DB) throw new Error("Authentication storage is unavailable.");
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), userId, await hashSessionToken(token), expiresAt).run();
  return { token, expiresAt };
}

export function sessionCookie(token: string, expiresAt: string): string {
  return `sl_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`;
}

export function clearSessionCookie(): string {
  return "sl_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}