import { env } from "cloudflare:workers";

export type RequestIdentity = { userId: string; email: string; displayName: string | null };
export const SESSION_COOKIE = "sl_session";

function sessionToken(headers: Headers): string | null {
  const cookie = headers.get("Cookie") || "";
  const value = cookie.split(";").map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`));
  return value ? decodeURIComponent(value.slice(SESSION_COOKIE.length + 1)) : null;
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function getRequestIdentity(headers: Headers): Promise<RequestIdentity | null> {
  if (!env.DB) return null;
  const token = sessionToken(headers);
  if (!token) return null;
  const tokenHash = await hashSessionToken(token);
  const row = await env.DB.prepare(
    "SELECT u.id AS user_id, u.email, u.display_name FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP",
  ).bind(tokenHash).first<{ user_id: string; email: string; display_name: string | null }>();
  if (!row?.email) return null;
  return { userId: row.user_id, email: row.email, displayName: row.display_name };
}