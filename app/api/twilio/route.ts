import { env } from "cloudflare:workers";
import { z } from "zod";
import { getRequestIdentity } from "../../../lib/access-identity";

const uuid = z.string().uuid();
const phone = z.string().trim().regex(/^\+[1-9]\d{7,14}$/);
const configInput = z.object({ tenant_id: uuid, from_number: phone, operator_number: phone.optional().nullable(), sms_enabled: z.boolean().default(false), voice_enabled: z.boolean().default(false) }).strict();
const smsInput = z.object({ tenant_id: uuid, to: phone, body: z.string().trim().min(1).max(1600), contact_id: uuid.optional() }).strict();
const callInput = z.object({ tenant_id: uuid, to: phone, contact_id: uuid.optional() }).strict();
const consentInput = z.object({ tenant_id: uuid, contact_id: uuid, channel: z.enum(["sms", "voice"]), status: z.enum(["granted", "denied"]), source: z.string().trim().min(1).max(160), wording_version: z.string().trim().max(80).optional() }).strict();

type TwilioConnection = { id: string; account_id: string; key_id: string; secret_ciphertext: string; secret_iv: string };
type TwilioCredentials = { accountId: string; keySid: string; secret: string };
type Member = { role: string };
class TwilioError extends Error { constructor(public status: number, message: string) { super(message); } }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
function database() { if (!env.DB) throw new TwilioError(503, "Communication storage is unavailable."); return env.DB; }
function base64Bytes(value: string) { try { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); } catch { throw new TwilioError(503, "The saved Twilio credential cannot be read."); } }
async function decrypt(row: TwilioConnection, tenantId: string) {
  const encoded = (env as unknown as Record<string, unknown>).INTEGRATION_ENCRYPTION_KEY;
  if (typeof encoded !== "string") throw new TwilioError(503, "Secure credential storage is not configured.");
  const keyBytes = base64Bytes(encoded);
  if (keyBytes.length !== 32) throw new TwilioError(503, "Secure credential storage is not configured.");
  try {
    const additionalData = new TextEncoder().encode(`${tenantId}:twilio:${row.account_id}:${row.key_id}`);
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64Bytes(row.secret_iv), additionalData }, key, base64Bytes(row.secret_ciphertext));
    return new TextDecoder().decode(plaintext);
  } catch { throw new TwilioError(503, "The saved Twilio credential cannot be read. Reconnect Twilio."); }
}
async function owner(request: Request, tenantId: string, roles = ["business_owner", "sales_manager", "sales_representative"]) {
  const user = await getRequestIdentity(request.headers);
  if (!user) throw new TwilioError(401, "Sign in to continue.");
  const member = await database().prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'").bind(tenantId, user.userId).first<Member>();
  if (!member || !roles.includes(member.role)) throw new TwilioError(403, "You do not have access to this company.");
  return { userId: user.userId, role: member.role };
}
async function body(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) throw new TwilioError(403, "Request origin was not accepted.");
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new TwilioError(415, "Send JSON data.");
  try { return await request.json(); } catch { throw new TwilioError(400, "Invalid request."); }
}
async function connection(tenantId: string) {
  const row = await database().prepare("SELECT id, account_id, key_id, secret_ciphertext, secret_iv FROM provider_connections WHERE tenant_id = ? AND provider = 'twilio' AND status = 'connected'").bind(tenantId).first<TwilioConnection>();
  if (row) return { accountId: row.account_id, keySid: row.key_id, secret: await decrypt(row, tenantId) } satisfies TwilioCredentials;
  const managed = env as unknown as Record<string, unknown>;
  if (typeof managed.TWILIO_ACCOUNT_SID === "string" && typeof managed.TWILIO_API_KEY_SID === "string" && typeof managed.TWILIO_API_KEY_SECRET === "string") {
    return { accountId: managed.TWILIO_ACCOUNT_SID, keySid: managed.TWILIO_API_KEY_SID, secret: managed.TWILIO_API_KEY_SECRET } satisfies TwilioCredentials;
  }
  throw new TwilioError(409, "Twilio is not configured. Ask the SaaS Launchup administrator to finish the one-time Twilio setup.");
}
async function setting(tenantId: string) {
  return database().prepare("SELECT from_number, operator_number, sms_enabled, voice_enabled FROM twilio_settings WHERE tenant_id = ?").bind(tenantId).first<{ from_number: string; operator_number: string | null; sms_enabled: number; voice_enabled: number }>();
}
async function eligible(tenantId: string, to: string, channel: "sms" | "voice", contactId?: string) {
  const contact = contactId
    ? await database().prepare("SELECT id, phone FROM contacts WHERE tenant_id = ? AND id = ?").bind(tenantId, contactId).first<{ id: string; phone: string | null }>()
    : await database().prepare("SELECT id, phone FROM contacts WHERE tenant_id = ? AND phone = ? LIMIT 1").bind(tenantId, to).first<{ id: string; phone: string | null }>();
  if (!contact) throw new TwilioError(400, "Choose a contact in this company before sending.");
  const consent = await database().prepare("SELECT status FROM consent_records WHERE tenant_id = ? AND contact_id = ? AND channel IN (?, 'all') ORDER BY created_at DESC LIMIT 1").bind(tenantId, contact.id, channel).first<{ status: string }>();
  if (!consent || !["granted", "opted_in", "consented", "allowed"].includes(consent.status.toLowerCase())) throw new TwilioError(403, `Recorded ${channel} consent is required before contacting this person.`);
  const suppressed = await database().prepare("SELECT id FROM suppression_records WHERE tenant_id = ? AND contact_id = ? AND channel IN (?, 'all') AND revoked_at IS NULL LIMIT 1").bind(tenantId, contact.id, channel).first();
  if (suppressed) throw new TwilioError(403, `This contact is suppressed for ${channel}.`);
  return contact.id;
}
async function twilioRequest(accountId: string, keySid: string, keySecret: string, path: string, values: Record<string, string>) {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountId}/${path}`, { method: "POST", headers: { Authorization: `Basic ${btoa(`${keySid}:${keySecret}`)}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(values), redirect: "error", signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({})) as { sid?: string; status?: string; code?: number; message?: string };
  if (!response.ok || !data.sid) throw new TwilioError(response.status === 401 ? 401 : 502, data.message || "Twilio rejected the request.");
  return data;
}
async function validTwilioSignature(request: Request, form: FormData, token: string) {
  const signature = request.headers.get("X-Twilio-Signature");
  if (!signature) return false;
  const values = [...form.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}${value}`).join("");
  const data = new TextEncoder().encode(new URL(request.url).toString() + values);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  const expected = btoa(String.fromCharCode(...digest));
  return signature.length === expected.length && [...signature].every((char, index) => char === expected[index]);
}
function twiml(body: string) { return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { "Content-Type": "text/xml" } }); }
function errorResponse(error: unknown) { return error instanceof TwilioError ? json({ error: error.message }, error.status) : json({ error: "Twilio communication failed." }, 502); }

export async function GET(request: Request) {
  try {
    const tenantId = new URL(request.url).searchParams.get("tenant_id") || "";
    await owner(request, tenantId);
    const [config, twilio] = await Promise.all([setting(tenantId), database().prepare("SELECT provider, account_id, key_id, status, last_verified_at FROM provider_connections WHERE tenant_id = ? AND provider = 'twilio'").bind(tenantId).first()]);
    return json({ config: config || null, twilio: twilio ? { connected: true, account_last4: twilio.account_id.slice(-4), key_last4: twilio.key_id.slice(-4), status: twilio.status, last_verified_at: twilio.last_verified_at } : { connected: false } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const kind = new URL(request.url).searchParams.get("kind");
    if (kind === "voice") {
      const form = await request.formData(); const token = (env as unknown as Record<string, unknown>).TWILIO_AUTH_TOKEN;
      if (typeof token !== "string" || !(await validTwilioSignature(request, form, token))) return new Response("Unauthorized", { status: 403 });
      const to = new URL(request.url).searchParams.get("to"); const from = new URL(request.url).searchParams.get("from");
      if (!to || !from || !phone.safeParse(to).success || !phone.safeParse(from).success) return new Response("Invalid call target", { status: 400 });
      return twiml(`<Dial callerId="${from}"><Number>${to}</Number></Dial>`);
    }
    if (kind === "sms-status" || kind === "call-status") return handleStatusCallback(request, kind);
    const raw = await body(request);
    if (raw && typeof raw === "object" && "from_number" in raw) {
      const data = configInput.parse(raw);
      await owner(request, data.tenant_id, ["business_owner"]);
      await connection(data.tenant_id);
      await database().prepare("INSERT INTO twilio_settings (tenant_id, from_number, operator_number, sms_enabled, voice_enabled) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET from_number = excluded.from_number, operator_number = excluded.operator_number, sms_enabled = excluded.sms_enabled, voice_enabled = excluded.voice_enabled, updated_at = CURRENT_TIMESTAMP").bind(data.tenant_id, data.from_number, data.operator_number || null, data.sms_enabled ? 1 : 0, data.voice_enabled ? 1 : 0).run();
      return json({ ok: true });
    }
    if (raw && typeof raw === "object" && "consent_status" in raw) {
      const data = consentInput.parse({ ...raw, status: raw.consent_status });
      const user = await owner(request, data.tenant_id, ["business_owner", "sales_manager"]);
      const contact = await database().prepare("SELECT id FROM contacts WHERE tenant_id = ? AND id = ?").bind(data.tenant_id, data.contact_id).first();
      if (!contact) throw new TwilioError(404, "Contact not found.");
      await database().prepare("INSERT INTO consent_records (id, tenant_id, contact_id, channel, status, source, wording_version, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), data.tenant_id, data.contact_id, data.channel, data.status, data.source, data.wording_version || null, JSON.stringify({ recorded_by: user.userId, recorded_at: new Date().toISOString() })).run();
      return json({ ok: true }, 201);
    }
    if (raw && typeof raw === "object" && "body" in raw) {
      const data = smsInput.parse(raw); const user = await owner(request, data.tenant_id); const config = await setting(data.tenant_id);
      if (!config?.sms_enabled) throw new TwilioError(409, "Enable SMS for this company and save a Twilio number first.");
      const contactId = await eligible(data.tenant_id, data.to, "sms", data.contact_id); const credentials = await connection(data.tenant_id);
      const result = await twilioRequest(credentials.accountId, credentials.keySid, credentials.secret, "Messages.json", { To: data.to, From: config.from_number, Body: data.body, StatusCallback: new URL(`/api/twilio?kind=sms-status&tenant_id=${data.tenant_id}`, request.url).toString() });
      await database().prepare("INSERT INTO communication_messages (id, tenant_id, contact_id, channel, direction, from_number, to_number, body, provider_id, status, created_by) VALUES (?, ?, ?, 'sms', 'outbound', ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), data.tenant_id, contactId, config.from_number, data.to, data.body, result.sid, result.status || "queued", user.userId).run();
      return json({ ok: true, sid: result.sid, status: result.status || "queued" }, 201);
    }
    const data = callInput.parse(raw); const user = await owner(request, data.tenant_id); const config = await setting(data.tenant_id);
    if (!config?.voice_enabled || !config.operator_number) throw new TwilioError(409, "Enable calling and save an operator phone number first.");
    const contactId = await eligible(data.tenant_id, data.to, "voice", data.contact_id); const credentials = await connection(data.tenant_id);
    const base = new URL(`/api/twilio?kind=voice&tenant_id=${data.tenant_id}&to=${encodeURIComponent(data.to)}&from=${encodeURIComponent(config.from_number)}`, request.url); const result = await twilioRequest(credentials.accountId, credentials.keySid, credentials.secret, "Calls.json", { To: config.operator_number, From: config.from_number, Url: base.toString(), StatusCallback: new URL(`/api/twilio?kind=call-status&tenant_id=${data.tenant_id}`, request.url).toString(), StatusCallbackEvent: "initiated ringing answered completed" });
    await database().prepare("INSERT INTO communication_calls (id, tenant_id, contact_id, from_number, to_number, provider_id, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), data.tenant_id, contactId, config.from_number, data.to, result.sid, result.status || "queued", user.userId).run();
    return json({ ok: true, sid: result.sid, status: result.status || "queued" }, 201);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "sms-status" && kind !== "call-status") return json({ error: "Unknown callback." }, 404);
  return handleStatusCallback(request, kind);
}
async function handleStatusCallback(request: Request, kind: "sms-status" | "call-status") {
  try {
    const form = await request.formData(); const tenantId = new URL(request.url).searchParams.get("tenant_id") || ""; const token = (env as unknown as Record<string, unknown>).TWILIO_AUTH_TOKEN;
    if (typeof token !== "string" || !(await validTwilioSignature(request, form, token))) return new Response("Unauthorized", { status: 403 });
    const sid = String(form.get("MessageSid") || form.get("CallSid") || "");
    if (!sid || !tenantId) return new Response("Bad callback", { status: 400 });
    if (kind === "sms-status") await database().prepare("UPDATE communication_messages SET status = ?, error_code = ? WHERE tenant_id = ? AND provider_id = ?").bind(String(form.get("MessageStatus") || "unknown"), String(form.get("ErrorCode") || "") || null, tenantId, sid).run();
    else await database().prepare("UPDATE communication_calls SET status = ?, duration_seconds = ?, error_code = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND provider_id = ?").bind(String(form.get("CallStatus") || "unknown"), Number(form.get("CallDuration") || 0) || null, String(form.get("ErrorCode") || "") || null, tenantId, sid).run();
    return new Response("", { status: 204 });
  } catch { return new Response("Callback failed", { status: 500 }); }
}
