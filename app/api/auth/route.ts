import { env } from "cloudflare:workers";
import { z } from "zod";
import { clearSessionCookie, createSession, hashPassword, sessionCookie, verifyPassword } from "../../../lib/auth";
import { getRequestIdentity } from "../../../lib/access-identity";
import { hashSessionToken } from "../../../lib/access-identity";

const credentials = z.object({
  action: z.enum(["login", "register", "forgot", "reset"]),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(200).optional(),
  display_name: z.string().trim().min(1).max(160).optional(),
  company_name: z.string().trim().min(1).max(160).optional(),
  token: z.string().trim().min(32).max(200).optional(),
}).strict();

function response(data: unknown, status = 200, cookie?: string) {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

function environment() { return env as unknown as Record<string, unknown>; }
function randomToken() { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
async function sendResetEmail(email: string, token: string, request: Request) {
  const vars = environment();
  if (typeof vars.RESEND_API_KEY !== "string" || typeof vars.RESEND_FROM_EMAIL !== "string") return;
  const resetUrl = new URL(`/reset-password?token=${encodeURIComponent(token)}`, request.url).toString();
  const result = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${vars.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: vars.RESEND_FROM_EMAIL, to: [email], subject: "Reset your SaaS Launchup password", html: `<p>We received a request to reset your SaaS Launchup password.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in one hour.</p>` }), redirect: "error" });
  if (!result.ok) throw new Error("Reset email could not be sent.");
}

export async function GET(request: Request) {
  const user = await getRequestIdentity(request.headers);
  return user ? response({ authenticated: true, name: user.displayName || user.email, email: user.email }) : response({ authenticated: false }, 401);
}

export async function POST(request: Request) {
  if (!env.DB) return response({ error: "Authentication storage is unavailable." }, 503);
  let data: z.infer<typeof credentials>;
  try { data = credentials.parse(await request.json()); } catch { return response({ error: "Enter a valid email and password." }, 400); }
  const email = data.email.toLowerCase();

  if (data.action === "forgot") {
    const user = await env.DB.prepare("SELECT id, email FROM users WHERE lower(email) = ? LIMIT 1").bind(email).first<{ id: string; email: string }>();
    if (user) {
      const token = randomToken();
      await env.DB.prepare("DELETE FROM auth_password_resets WHERE user_id = ? OR expires_at <= CURRENT_TIMESTAMP").bind(user.id).run();
      await env.DB.prepare("INSERT INTO auth_password_resets (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), user.id, await hashSessionToken(token), new Date(Date.now() + 60 * 60 * 1000).toISOString()).run();
      try { await sendResetEmail(user.email, token, request); } catch { /* Keep the response generic to avoid account discovery. */ }
    }
    return response({ ok: true, message: "If an account exists for that email, reset instructions will be sent." });
  }

  if (data.action === "reset") {
    if (!data.token || !data.password) return response({ error: "Use the reset link and enter a new password." }, 400);
    const row = await env.DB.prepare("SELECT id, user_id FROM auth_password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP").bind(await hashSessionToken(data.token)).first<{ id: string; user_id: string }>();
    if (!row) return response({ error: "This reset link is invalid or expired." }, 400);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(data.password), row.user_id),
      env.DB.prepare("UPDATE auth_password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id),
      env.DB.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(row.user_id),
    ]);
    const session = await createSession(row.user_id);
    return response({ ok: true, redirect: "/workspace.html" }, 200, sessionCookie(session.token, session.expiresAt));
  }

  if (data.action === "login") {
    if (!data.password) return response({ error: "Enter your password." }, 400);
    const user = await env.DB.prepare("SELECT id, email, display_name, password_hash FROM users WHERE lower(email) = ? LIMIT 1").bind(email).first<{ id: string; email: string; display_name: string | null; password_hash: string | null }>();
    if (!user?.password_hash || !(await verifyPassword(data.password, user.password_hash))) return response({ error: "The email or password is incorrect." }, 401);
    const session = await createSession(user.id);
    return response({ ok: true, redirect: "/workspace.html" }, 200, sessionCookie(session.token, session.expiresAt));
  }

  if (!data.display_name) return response({ error: "Enter your name to create the account." }, 400);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = ? LIMIT 1").bind(email).first<{ id: string }>();
  if (existing) return response({ error: "An account already exists for this email. Sign in instead." }, 409);
  const userId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  if (!data.password) return response({ error: "Create a password with at least 12 characters." }, 400);
  const passwordHash = await hashPassword(data.password);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)").bind(userId, email, data.display_name, passwordHash),
    env.DB.prepare("INSERT INTO organizations (id, name) VALUES (?, ?)").bind(organizationId, "New workspace"),
    env.DB.prepare("INSERT INTO memberships (id, tenant_id, user_id, role, record_scope) VALUES (?, ?, ?, 'business_owner', 'organization')").bind(crypto.randomUUID(), organizationId, userId),
  ]);
  const session = await createSession(userId);
  return response({ ok: true, redirect: "/onboarding" }, 201, sessionCookie(session.token, session.expiresAt));
}

export async function DELETE(request: Request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.split(";").map(part => part.trim()).find(part => part.startsWith("sl_session="));
  if (match && env.DB) {
    const token = decodeURIComponent(match.slice("sl_session=".length));
    const { hashSessionToken } = await import("../../../lib/access-identity");
    await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await hashSessionToken(token)).run();
  }
  return response({ ok: true, redirect: "/" }, 200, clearSessionCookie());
}
