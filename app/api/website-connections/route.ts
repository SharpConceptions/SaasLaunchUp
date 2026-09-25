import { env } from "cloudflare:workers";
import { z } from "zod";
import { createWebsiteKey, hashWebsiteKey } from "../../../lib/website-forms";

const uuid = z.string().uuid();
const mapping = z.object({
  name: z.string().trim().max(80).optional(), email: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(80).optional(), company: z.string().trim().max(80).optional(),
  domain: z.string().trim().max(80).optional(), source: z.string().trim().max(80).optional(),
  message: z.string().trim().max(80).optional(),
  submission_id: z.string().trim().max(80).optional(),
}).strict();
const config = z.object({
  name: z.string().trim().min(1).max(120), stage_id: uuid, owner_user_id: z.string().min(1).max(256),
  mapping: mapping.default({}),
}).strict();
const createInput = config.extend({ tenant_id: uuid });
const updateInput = config.extend({ tenant_id: uuid, site_id: uuid, action: z.literal("update") });
const rotateInput = z.object({ tenant_id: uuid, site_id: uuid, action: z.literal("rotate") }).strict();
const revokeInput = z.object({ tenant_id: uuid, site_id: uuid, confirmation: z.literal("revoke") }).strict();

class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function fail(status: number, message: string): never { throw new ApiError(status, message); }
function database(): D1Database { const db = env.DB; if (!db) fail(503, "Website connection storage is unavailable."); return db; }
async function owner(request: Request, tenantId: string) {
  if (!uuid.safeParse(tenantId).success) fail(400, "Choose a company.");
  const userId = request.headers.get("oai-authenticated-user-id");
  if (!userId) fail(401, "Sign in to continue.");
  const member = await database().prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
    .bind(tenantId, userId).first<{ role: string }>();
  if (member?.role !== "business_owner") fail(403, "Company owner access is required.");
  return userId;
}
function checkMutation(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) fail(403, "Request origin was not accepted.");
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) fail(415, "Send JSON data.");
}
async function inputBody(request: Request) {
  checkMutation(request);
  const text = await request.text();
  if (text.length > 3500) fail(413, "Connection settings are too large.");
  try { return JSON.parse(text) as unknown; } catch { return fail(400, "Invalid connection settings."); }
}
async function validateConfig(tenantId: string, stageId: string, ownerUserId: string) {
  const [stage, assignee] = await Promise.all([
    database().prepare("SELECT id FROM stages WHERE tenant_id = ? AND id = ?").bind(tenantId, stageId).first(),
    database().prepare("SELECT user_id FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active' AND role IN ('business_owner', 'sales_manager', 'sales_representative')")
      .bind(tenantId, ownerUserId).first(),
  ]);
  if (!stage) fail(400, "Choose a pipeline stage in this company.");
  if (!assignee) fail(400, "Choose an active sales team member.");
}
async function existing(tenantId: string, siteId: string) {
  const row = await database().prepare("SELECT id, status FROM website_connections WHERE tenant_id = ? AND id = ?").bind(tenantId, siteId).first<{ id: string; status: string }>();
  if (!row) fail(404, "Website connection not found.");
  if (row.status !== "active") fail(409, "This website connection has been revoked. Create a new one.");
  return row;
}
function errorResponse(error: unknown) {
  return error instanceof ApiError ? reply({ error: error.message }, error.status) : reply({ error: "Could not update website connections." }, 503);
}

export async function GET(request: Request) {
  try {
    const tenantId = new URL(request.url).searchParams.get("tenant_id") || "";
    await owner(request, tenantId);
    const rows = await database().prepare("SELECT w.id, w.name, w.stage_id, w.owner_user_id, w.mapping_json, w.key_last4, w.status, w.last_received_at, w.created_at, (SELECT count(*) FROM website_form_events e WHERE e.site_id = w.id) AS submission_count FROM website_connections w WHERE w.tenant_id = ? ORDER BY w.created_at DESC LIMIT 50")
      .bind(tenantId).all();
    return reply({ items: rows.results.map(row => ({ ...row, mapping: JSON.parse(String(row.mapping_json || "{}")), mapping_json: undefined })) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = createInput.safeParse(await inputBody(request));
    if (!parsed.success) fail(400, "Check the website connection settings.");
    const data = parsed.data;
    const userId = await owner(request, data.tenant_id);
    await validateConfig(data.tenant_id, data.stage_id, data.owner_user_id);
    const count = await database().prepare("SELECT count(*) AS total FROM website_connections WHERE tenant_id = ? AND status = 'active'")
      .bind(data.tenant_id).first<{ total: number }>();
    if (Number(count?.total || 0) >= 20) fail(409, "A company can have up to 20 active website connections.");
    const siteId = crypto.randomUUID(), key = createWebsiteKey(), hash = await hashWebsiteKey(key);
    await database().batch([
      database().prepare("INSERT INTO website_connections (id, tenant_id, name, stage_id, owner_user_id, mapping_json, key_hash, key_last4, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(siteId, data.tenant_id, data.name, data.stage_id, data.owner_user_id, JSON.stringify(data.mapping), hash, key.slice(-4), userId),
      database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'website_connection.created', 'website_connection', ?)")
        .bind(crypto.randomUUID(), data.tenant_id, userId, siteId),
    ]);
    return reply({ site_id: siteId, api_key: key }, 201);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const raw = await inputBody(request);
    const action = typeof raw === "object" && raw !== null && "action" in raw ? raw.action : null;
    if (action === "rotate") {
      const parsed = rotateInput.safeParse(raw);
      if (!parsed.success) fail(400, "Choose a website connection.");
      const data = parsed.data, userId = await owner(request, data.tenant_id);
      await existing(data.tenant_id, data.site_id);
      const key = createWebsiteKey(), hash = await hashWebsiteKey(key);
      await database().batch([
        database().prepare("UPDATE website_connections SET key_hash = ?, key_last4 = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ? AND status = 'active'")
          .bind(hash, key.slice(-4), data.tenant_id, data.site_id),
        database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'website_connection.key_rotated', 'website_connection', ?)")
          .bind(crypto.randomUUID(), data.tenant_id, userId, data.site_id),
      ]);
      return reply({ site_id: data.site_id, api_key: key });
    }
    const parsed = updateInput.safeParse(raw);
    if (!parsed.success) fail(400, "Check the website connection settings.");
    const data = parsed.data, userId = await owner(request, data.tenant_id);
    await existing(data.tenant_id, data.site_id);
    await validateConfig(data.tenant_id, data.stage_id, data.owner_user_id);
    await database().batch([
      database().prepare("UPDATE website_connections SET name = ?, stage_id = ?, owner_user_id = ?, mapping_json = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ? AND status = 'active'")
        .bind(data.name, data.stage_id, data.owner_user_id, JSON.stringify(data.mapping), data.tenant_id, data.site_id),
      database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'website_connection.updated', 'website_connection', ?)")
        .bind(crypto.randomUUID(), data.tenant_id, userId, data.site_id),
    ]);
    return reply({ saved: true });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const parsed = revokeInput.safeParse(await inputBody(request));
    if (!parsed.success) fail(400, "Type revoke to disable this website connection.");
    const data = parsed.data, userId = await owner(request, data.tenant_id);
    await existing(data.tenant_id, data.site_id);
    await database().batch([
      database().prepare("UPDATE website_connections SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?")
        .bind(data.tenant_id, data.site_id),
      database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'website_connection.revoked', 'website_connection', ?)")
        .bind(crypto.randomUUID(), data.tenant_id, userId, data.site_id),
    ]);
    return reply({ revoked: true });
  } catch (error) { return errorResponse(error); }
}
