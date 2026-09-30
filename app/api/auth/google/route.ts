import { env } from "cloudflare:workers";
import { createSession, sessionCookie } from "../../../../lib/auth";

function base64Url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function errorPage(message: string, status = 400) { const safe = message.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); return new Response(`<!doctype html><title>Google sign-in</title><p>${safe}</p><a href="/login">Return to sign in</a>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }); }
function config() { const vars = env as unknown as Record<string, unknown>; if (typeof vars.GOOGLE_OAUTH_CLIENT_ID !== "string" || typeof vars.GOOGLE_OAUTH_CLIENT_SECRET !== "string") return null; return { id: vars.GOOGLE_OAUTH_CLIENT_ID, secret: vars.GOOGLE_OAUTH_CLIENT_SECRET }; }
async function challenge(verifier: string) { return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))); }

export async function GET(request: Request) {
  if (!env.DB) return errorPage("Authentication storage is unavailable.", 503);
  const url = new URL(request.url), google = config();
  if (!google) return errorPage("Google sign-in is not configured yet. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to the Worker.", 503);
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  if (!code && !state) {
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48))), stateValue = base64Url(crypto.getRandomValues(new Uint8Array(32))), redirectUri = new URL("/api/auth/google", request.url).toString();
    await env.DB.prepare("DELETE FROM auth_oauth_states WHERE expires_at <= CURRENT_TIMESTAMP").run();
    await env.DB.prepare("INSERT INTO auth_oauth_states (state, code_verifier, redirect_uri, return_to, expires_at) VALUES (?, ?, ?, ?, ?)").bind(stateValue, verifier, redirectUri, "/workspace.html", new Date(Date.now() + 10 * 60 * 1000).toISOString()).run();
    const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorization.search = new URLSearchParams({ client_id: google.id, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", access_type: "offline", prompt: "select_account", state: stateValue, code_challenge: await challenge(verifier), code_challenge_method: "S256" }).toString();
    return Response.redirect(authorization, 302);
  }
  if (!code || !state) return errorPage("Google sign-in was incomplete.");
  const saved = await env.DB.prepare("SELECT state, code_verifier, redirect_uri, expires_at FROM auth_oauth_states WHERE state = ?").bind(state).first<{ state: string; code_verifier: string; redirect_uri: string; expires_at: string }>();
  await env.DB.prepare("DELETE FROM auth_oauth_states WHERE state = ?").bind(state).run();
  if (!saved || Date.parse(saved.expires_at) <= Date.now()) return errorPage("This Google sign-in link expired. Start again.");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ code, client_id: google.id, client_secret: google.secret, redirect_uri: saved.redirect_uri, grant_type: "authorization_code", code_verifier: saved.code_verifier }), redirect: "error" });
  const token = await tokenResponse.json().catch(() => null) as { access_token?: string } | null;
  if (!tokenResponse.ok || !token?.access_token) return errorPage("Google did not complete sign-in. Check the OAuth redirect URI and consent screen.", 502);
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" }, redirect: "error" });
  const profile = await profileResponse.json().catch(() => null) as { sub?: string; email?: string; email_verified?: boolean; name?: string } | null;
  if (!profileResponse.ok || !profile?.sub || !profile.email || profile.email_verified === false) return errorPage("Google account verification failed.", 502);
  const email = profile.email.toLowerCase();
  let user = await env.DB.prepare("SELECT id, display_name FROM users WHERE lower(email) = ? LIMIT 1").bind(email).first<{ id: string; display_name: string | null }>();
  let redirectTo = "/console.html";
  if (!user) {
    const userId = crypto.randomUUID(), tenantId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)").bind(userId, email, profile.name || email),
      env.DB.prepare("INSERT INTO organizations (id, name) VALUES (?, 'New workspace')").bind(tenantId),
      env.DB.prepare("INSERT INTO memberships (id, tenant_id, user_id, role, record_scope) VALUES (?, ?, ?, 'business_owner', 'organization')").bind(crypto.randomUUID(), tenantId, userId),
    ]);
    user = { id: userId, display_name: profile.name || email }; redirectTo = "/onboarding";
  }
  const session = await createSession(user.id);
  return new Response(null, { status: 302, headers: { Location: redirectTo, "Set-Cookie": sessionCookie(session.token, session.expiresAt), "Cache-Control": "no-store" } });
}
