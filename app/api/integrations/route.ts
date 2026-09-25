import { env } from "cloudflare:workers";
import { z } from "zod";
import { getRequestIdentity } from "../../../lib/access-identity";

const uuid = z.string().uuid();
const accountSid = z.string().regex(/^AC[0-9a-fA-F]{32}$/);
const keySid = z.string().regex(/^SK[0-9a-fA-F]{32}$/);
const connectInput = z.object({
  tenant_id: uuid,
  account_sid: accountSid,
  api_key_sid: keySid,
  api_key_secret: z.string().min(16).max(256),
}).strict();
const tenantInput = z.object({ tenant_id: uuid }).strict();
const disconnectInput = tenantInput.extend({ confirmation: z.literal("disconnect") });
type Connection = {
  id: string; account_id: string; key_id: string; secret_ciphertext: string; secret_iv: string;
  status: string; last_verified_at: string | null;
};
class ConnectionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const reply = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "no-store" },
});
function db(): D1Database {
  if (!env.DB) throw new ConnectionError(503, "Connection storage is unavailable.");
  return env.DB;
}
async function owner(request: Request, tenantId: string) {
  const userId = (await getRequestIdentity(request.headers))?.userId;
  if (!userId) throw new ConnectionError(401, "Sign in to continue.");
  if (!uuid.safeParse(tenantId).success) throw new ConnectionError(400, "Choose a company.");
  const member = await db().prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
    .bind(tenantId, userId).first<{ role: string }>();
  if (member?.role !== "business_owner") throw new ConnectionError(403, "Company owner access is required.");
  return userId;
}
async function body(request: Request): Promise<unknown> {
  if (request.headers.get("Origin") !== new URL(request.url).origin) throw new ConnectionError(403, "Request origin was not accepted.");
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new ConnectionError(415, "Send JSON data.");
  const raw = await request.text();
  if (raw.length > 1600) throw new ConnectionError(413, "Connection details are too large.");
  try { return JSON.parse(raw); } catch { throw new ConnectionError(400, "Invalid connection details."); }
}
function bytesToBase64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function base64ToBytes(value: string) { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
async function encryptionKey() {
  const encoded = (env as unknown as Record<string, unknown>).INTEGRATION_ENCRYPTION_KEY;
  if (typeof encoded !== "string") throw new ConnectionError(503, "Secure credential storage is not configured.");
  let raw: Uint8Array<ArrayBuffer>;
  try {
    const decoded = base64ToBytes(encoded);
    raw = new Uint8Array(decoded.length);
    raw.set(decoded);
  } catch { throw new ConnectionError(503, "Secure credential storage is not configured."); }
  if (raw.length !== 32) throw new ConnectionError(503, "Secure credential storage is not configured.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
function additionalData(tenantId: string, account: string, key: string) {
  return new TextEncoder().encode(`${tenantId}:twilio:${account}:${key}`);
}
async function encryptSecret(secret: string, tenantId: string, account: string, keySidValue: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({
    name: "AES-GCM", iv, additionalData: additionalData(tenantId, account, keySidValue),
  }, await encryptionKey(), new TextEncoder().encode(secret));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}
async function decryptSecret(row: Connection, tenantId: string) {
  try {
    const decrypted = await crypto.subtle.decrypt({
      name: "AES-GCM", iv: base64ToBytes(row.secret_iv),
      additionalData: additionalData(tenantId, row.account_id, row.key_id),
    }, await encryptionKey(), base64ToBytes(row.secret_ciphertext));
    return new TextDecoder().decode(decrypted);
  } catch { throw new ConnectionError(503, "The saved credential cannot be read. Reconnect Twilio."); }
}
async function verifyTwilio(account: string, key: string, secret: string) {
  let response: Response;
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/IncomingPhoneNumbers.json?PageSize=1`, {
      method: "GET",
      headers: { Authorization: `Basic ${btoa(`${key}:${secret}`)}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  } catch { throw new ConnectionError(502, "Twilio could not be reached. Try again."); }
  if (response.status === 401) throw new ConnectionError(400, "Twilio rejected the API key SID or secret.");
  if (response.status === 403) throw new ConnectionError(400, "This Twilio key cannot list phone numbers. Give it number-read permission.");
  if (response.status === 404) throw new ConnectionError(400, "Twilio could not find that Account SID for this key.");
  if (!response.ok) throw new ConnectionError(502, "Twilio could not verify this connection right now.");
  const data = await response.json().catch(() => null) as { incoming_phone_numbers?: unknown } | null;
  if (!data || !Array.isArray(data.incoming_phone_numbers)) throw new ConnectionError(502, "Twilio returned an unexpected verification result.");
}
function publicConnection(row: Connection | null) {
  return row ? {
    connected: true, status: row.status,
    account_sid_last4: row.account_id.slice(-4),
    api_key_sid_last4: row.key_id.slice(-4),
    last_verified_at: row.last_verified_at,
  } : { connected: false };
}
async function saved(tenantId: string) {
  return db().prepare("SELECT id, account_id, key_id, secret_ciphertext, secret_iv, status, last_verified_at FROM provider_connections WHERE tenant_id = ? AND provider = 'twilio'")
    .bind(tenantId).first<Connection>();
}
function audit(tenantId: string, userId: string, kind: string, targetId: string) {
  return db().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, ?, 'provider_connection', ?)")
    .bind(crypto.randomUUID(), tenantId, userId, kind, targetId);
}
function errorResponse(error: unknown) {
  if (error instanceof ConnectionError) return reply({ error: error.message }, error.status);
  return reply({ error: "Connection storage is unavailable. Try again later." }, 503);
}
export async function GET(request: Request) {
  try {
    const tenantId = new URL(request.url).searchParams.get("tenant_id") || "";
    await owner(request, tenantId);
    return reply({ twilio: publicConnection(await saved(tenantId)) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const parsed = connectInput.safeParse(await body(request));
    if (!parsed.success) throw new ConnectionError(400, "Enter a valid Twilio Account SID, API key SID, and secret.");
    const data = parsed.data;
    const userId = await owner(request, data.tenant_id);
    await encryptionKey();
    await verifyTwilio(data.account_sid, data.api_key_sid, data.api_key_secret);
    const encrypted = await encryptSecret(data.api_key_secret, data.tenant_id, data.account_sid, data.api_key_sid);
    const old = await saved(data.tenant_id);
    const id = old?.id || crypto.randomUUID();
    await db().batch([
      db().prepare("INSERT INTO provider_connections (id, tenant_id, provider, account_id, key_id, secret_ciphertext, secret_iv, status, last_verified_at, created_by) VALUES (?, ?, 'twilio', ?, ?, ?, ?, 'connected', CURRENT_TIMESTAMP, ?) ON CONFLICT(tenant_id, provider) DO UPDATE SET account_id = excluded.account_id, key_id = excluded.key_id, secret_ciphertext = excluded.secret_ciphertext, secret_iv = excluded.secret_iv, status = 'connected', last_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP")
        .bind(id, data.tenant_id, data.account_sid, data.api_key_sid, encrypted.ciphertext, encrypted.iv, userId),
      audit(data.tenant_id, userId, old ? "integration.reconnected" : "integration.connected", id),
    ]);
    return reply({ twilio: publicConnection(await saved(data.tenant_id)) }, old ? 200 : 201);
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    const parsed = tenantInput.safeParse(await body(request));
    if (!parsed.success) throw new ConnectionError(400, "Choose a company.");
    const tenantId = parsed.data.tenant_id;
    const userId = await owner(request, tenantId);
    const row = await saved(tenantId);
    if (!row) throw new ConnectionError(404, "Twilio is not connected.");
    await verifyTwilio(row.account_id, row.key_id, await decryptSecret(row, tenantId));
    await db().batch([
      db().prepare("UPDATE provider_connections SET status = 'connected', last_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND provider = 'twilio'")
        .bind(tenantId),
      audit(tenantId, userId, "integration.verified", row.id),
    ]);
    return reply({ twilio: publicConnection(await saved(tenantId)) });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    const parsed = disconnectInput.safeParse(await body(request));
    if (!parsed.success) throw new ConnectionError(400, "Confirm disconnect to remove the saved credential.");
    const tenantId = parsed.data.tenant_id;
    const userId = await owner(request, tenantId);
    const row = await saved(tenantId);
    if (!row) throw new ConnectionError(404, "Twilio is not connected.");
    await db().batch([
      db().prepare("DELETE FROM provider_connections WHERE tenant_id = ? AND provider = 'twilio'").bind(tenantId),
      audit(tenantId, userId, "integration.disconnected", row.id),
    ]);
    return reply({ twilio: { connected: false } });
  } catch (error) { return errorResponse(error); }
}
