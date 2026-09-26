import { env } from "cloudflare:workers";
import { z } from "zod";
import { getRequestIdentity } from "../../../../lib/access-identity";
import { oauthProviders, type OAuthProviderKey } from "../../../../lib/oauth-providers";

type Member = { role: string };
type StoredState = { state: string; tenant_id: string; user_id: string; provider: OAuthProviderKey; code_verifier: string; redirect_uri: string; expires_at: string };
type OAuthToken = { access_token: string; refresh_token?: string; token_type?: string; expires_in?: number; scope?: string };
class OAuthError extends Error { constructor(public status: number, message: string) { super(message); } }
const uuid = z.string().uuid();
const providerSchema = z.enum(["google-workspace", "google-calendar", "google-ads", "meta", "linkedin", "x", "reddit"]);
const startSchema = z.object({ action: z.literal("start"), tenant_id: uuid, provider: providerSchema }).strict();
const callbackError = (message: string) => new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connection not completed</title><body><main><h1>Connection not completed</h1><p>${message.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)}</p><a href="/workspace">Return to SaaS Launchup</a></main></body></html>`, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
function reply(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
function fail(status: number, message: string): never { throw new OAuthError(status, message); }
function environment() { return env as unknown as Record<string, unknown>; }
function database(): D1Database { if (!env.DB) fail(503, "Connection storage is unavailable."); return env.DB; }
async function owner(request: Request, tenantId: string) {
  const userId = (await getRequestIdentity(request.headers))?.userId;
  if (!userId) fail(401, "Sign in to continue.");
  if (!uuid.safeParse(tenantId).success) fail(400, "Choose a company.");
  const member = await database().prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'").bind(tenantId, userId).first<Member>();
  if (member?.role !== "business_owner") fail(403, "Company owner access is required.");
  return userId;
}
function base64Url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function randomSecret(size = 32) { return base64Url(crypto.getRandomValues(new Uint8Array(size))); }
async function sha256(value: string) { return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
async function getEncryptionKey() {
  const encoded = environment().INTEGRATION_ENCRYPTION_KEY;
  if (typeof encoded !== "string") fail(503, "Secure credential storage is not configured.");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0)); } catch { fail(503, "Secure credential storage is not configured."); }
  if (bytes.length !== 32) fail(503, "Secure credential storage is not configured.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt"]);
}
async function encryptToken(tenantId: string, provider: string, accountId: string, token: OAuthToken) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(`${tenantId}:${provider}:${accountId}:oauth`);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, await getEncryptionKey(), new TextEncoder().encode(JSON.stringify(token)));
  return { ciphertext: base64Url(new Uint8Array(encrypted)), iv: base64Url(iv) };
}
function basicAuthorization(clientId: string, clientSecret: string) { return `Basic ${btoa(`${clientId}:${clientSecret}`)}`; }
async function exchangeToken(provider: OAuthProviderKey, code: string, verifier: string, redirectUri: string): Promise<{ token: OAuthToken; profile: Record<string, unknown> }> {
  const config = oauthProviders[provider], vars = environment();
  const clientId = vars[config.clientIdEnv], clientSecret = vars[config.clientSecretEnv];
  if (typeof clientId !== "string" || typeof clientSecret !== "string") fail(503, `${provider} OAuth is not configured for this environment.`);
    const body = new URLSearchParams({ code, redirect_uri: redirectUri });
    if (config.tokenGrantType !== false) body.set("grant_type", config.tokenGrantType || "authorization_code");
    if (provider !== "x" && provider !== "reddit") {
      body.set("client_id", clientId);
      body.set("client_secret", clientSecret);
    }
  if (config.pkce) body.set("code_verifier", verifier);
    const headers = new Headers({ Accept: "application/json" });
  if (provider === "x" || provider === "reddit") headers.set("Authorization", basicAuthorization(clientId, clientSecret));
  if (config.userAgent) headers.set("User-Agent", config.userAgent);
    const tokenUrl = new URL(config.tokenEndpoint);
    const requestBody = config.tokenMethod === "GET" ? undefined : body;
    if (config.tokenMethod === "GET") body.forEach((value, key) => tokenUrl.searchParams.set(key, value));
    else headers.set("Content-Type", "application/x-www-form-urlencoded");
  let tokenResponse: Response;
    try { tokenResponse = await fetch(tokenUrl, { method: config.tokenMethod, headers, body: requestBody, redirect: "error", signal: AbortSignal.timeout(15000) }); }
  catch { fail(502, `${provider} could not be reached during authorization.`); }
  const token = await tokenResponse.json().catch(() => null) as OAuthToken | null;
  if (!tokenResponse.ok || !token || typeof token.access_token !== "string") fail(502, `${provider} did not complete authorization. Check the app settings and granted scopes.`);
  let profileResponse: Response;
  try {
    profileResponse = await fetch(config.profileEndpoint, { headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json", ...(config.userAgent ? { "User-Agent": config.userAgent } : {}) }, redirect: "error", signal: AbortSignal.timeout(12000) });
  } catch { fail(502, `${provider} could not verify the authorized account.`); }
  const profile = await profileResponse.json().catch(() => null) as Record<string, unknown> | null;
  if (!profileResponse.ok || !profile) fail(502, `${provider} authorization succeeded but account verification failed.`);
  return { token, profile };
}
function profileId(provider: OAuthProviderKey, profile: Record<string, unknown>) {
  const nested = profile.data && typeof profile.data === "object" ? profile.data as Record<string, unknown> : profile;
  const id = provider === "google-workspace" || provider === "google-calendar" || provider === "google-ads" || provider === "linkedin"
    ? profile.sub : provider === "reddit" ? profile.name : nested.id;
  if (typeof id !== "string" || !id) fail(502, `${provider} returned no stable account identifier.`);
  return id;
}
async function start(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) fail(403, "Request origin was not accepted.");
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) fail(415, "Send JSON data.");
  const raw = await request.json().catch(() => null);
  const parsed = startSchema.safeParse(raw);
  if (!parsed.success) fail(400, "Choose a supported provider and company.");
  const { tenant_id: tenantId, provider } = parsed.data;
  const userId = await owner(request, tenantId);
  const config = oauthProviders[provider], vars = environment();
  const clientId = vars[config.clientIdEnv];
  if (typeof clientId !== "string" || !clientId || typeof vars[config.clientSecretEnv] !== "string" || !vars[config.clientSecretEnv]) fail(503, `${provider} connection setup is not configured yet. Register the provider app and add its client credentials to Cloudflare Worker secrets.`);
  const state = randomSecret(), verifier = randomSecret(48), challenge = await sha256(verifier);
  const redirectUri = new URL(`/api/integrations/oauth?callback=1&provider=${encodeURIComponent(provider)}`, request.url).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await database().prepare("DELETE FROM integration_oauth_states WHERE expires_at <= ?").bind(new Date().toISOString()).run();
  await database().prepare("INSERT INTO integration_oauth_states (state, tenant_id, user_id, provider, code_verifier, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(state, tenantId, userId, provider, verifier, redirectUri, expiresAt).run();
  const authorization = new URL(config.authorizationEndpoint);
  authorization.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: config.scopes.join(" "), state, ...(config.pkce ? { code_challenge: challenge, code_challenge_method: "S256" } : {}), ...config.authorizeParams }).toString();
  if (provider === "reddit") authorization.searchParams.set("duration", "permanent");
  return reply({ authorization_url: authorization.toString() });
}
async function callback(request: Request) {
  const url = new URL(request.url), error = url.searchParams.get("error");
  if (error) return callbackError("The provider declined authorization. You can return to API connections and try again.");
  const state = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
  const provider = providerSchema.safeParse(url.searchParams.get("provider"));
  if (!state || !code || !provider.success) return callbackError("The provider callback is incomplete. Start the connection again from API connections.");
  const userId = (await getRequestIdentity(request.headers))?.userId;
  if (!userId) return callbackError("Your sign-in session expired. Return to SaaS Launchup and start again.");
  const row = await database().prepare("SELECT state, tenant_id, user_id, provider, code_verifier, redirect_uri, expires_at FROM integration_oauth_states WHERE state = ?").bind(state).first<StoredState>();
  await database().prepare("DELETE FROM integration_oauth_states WHERE state = ?").bind(state).run();
  if (!row || row.user_id !== userId || row.provider !== provider.data || Date.parse(row.expires_at) <= Date.now()) return callbackError("This authorization link expired or did not match your sign-in. Start the connection again.");
  const membership = await database().prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'").bind(row.tenant_id, userId).first<Member>();
  if (membership?.role !== "business_owner") return callbackError("Company owner access is required to save this connection.");
  const tokenResult = await exchangeToken(row.provider, code, row.code_verifier, row.redirect_uri);
  const accountId = profileId(row.provider, tokenResult.profile), config = oauthProviders[row.provider];
  const encrypted = await encryptToken(row.tenant_id, row.provider, accountId, tokenResult.token);
  const id = crypto.randomUUID(), scopes = tokenResult.token.scope?.split(" ").filter(Boolean) ?? config.scopes;
  await database().batch([
    database().prepare("INSERT INTO provider_connections (id, tenant_id, provider, account_id, key_id, secret_ciphertext, secret_iv, scopes_json, status, last_verified_at, created_by) VALUES (?, ?, ?, ?, 'oauth', ?, ?, ?, 'connected', CURRENT_TIMESTAMP, ?) ON CONFLICT(tenant_id, provider) DO UPDATE SET account_id = excluded.account_id, key_id = excluded.key_id, secret_ciphertext = excluded.secret_ciphertext, secret_iv = excluded.secret_iv, scopes_json = excluded.scopes_json, status = 'connected', last_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP")
      .bind(id, row.tenant_id, row.provider, accountId, encrypted.ciphertext, encrypted.iv, JSON.stringify(scopes), userId),
    database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'integration.connected', 'provider_connection', ?)")
      .bind(crypto.randomUUID(), row.tenant_id, userId, id),
  ]);
  return Response.redirect(new URL(`/workspace?connection=connected&provider=${encodeURIComponent(row.provider)}`, url.origin), 302);
}
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("callback") === "1") return await callback(request);
    return reply({ error: "Choose a connection action." }, 400);
  } catch (error) {
    if (error instanceof OAuthError) return reply({ error: error.message }, error.status);
    console.error("Provider OAuth callback failed", error);
    return callbackError("The provider connection could not be completed. Return to API connections and try again.");
  }
}
export async function POST(request: Request) {
  try { return await start(request); }
  catch (error) {
    if (error instanceof OAuthError) return reply({ error: error.message }, error.status);
    console.error("Provider OAuth start failed", error);
    return reply({ error: "Could not start this provider connection." }, 503);
  }
}
