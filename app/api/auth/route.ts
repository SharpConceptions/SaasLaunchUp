import { env } from "cloudflare:workers";
import { z } from "zod";
import { clearSessionCookie, createSession, hashPassword, sessionCookie, verifyPassword } from "../../../lib/auth";
import { getRequestIdentity } from "../../../lib/access-identity";

const credentials = z.object({
  action: z.enum(["login", "register", "forgot"]),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(200).optional(),
  display_name: z.string().trim().min(1).max(160).optional(),
  company_name: z.string().trim().min(1).max(160).optional(),
}).strict();

function response(data: unknown, status = 200, cookie?: string) {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(data), { status, headers });
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
    return response({ ok: true, message: "If an account exists for that email, password reset instructions will be sent." });
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
