import { env } from "cloudflare:workers";
import { z } from "zod";
import { createApiToken, hashWebsiteKey } from "../../../lib/api-tokens";
import { implementedScopes, integrationScopeKeys, integrationScopeSet } from "../../../lib/integration-permissions";

const uuid = z.string().uuid();
const base = z.object({ tenant_id: uuid });
const createInput = base.extend({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  permissions: z.array(z.string()).max(integrationScopeKeys.length),
  all_access: z.boolean(),
  acknowledge_all_access: z.boolean().optional(),
}).strict();
const rotateInput = base.extend({ token_id: uuid, action: z.literal("rotate") }).strict();
const revokeInput = base.extend({ token_id: uuid, confirmation: z.literal("revoke") }).strict();
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
function fail(status: number, message: string): never { throw new ApiError(status, message); }
function db(): D1Database { if (!env.DB) fail(503, "Token storage is unavailable."); return env.DB; }
async function owner(request: Request, tenantId: string) {
  if (!uuid.safeParse(tenantId).success) fail(400, "Choose a company.");
  const userId = request.headers.get("oai-authenticated-user-id");
  if (!userId) fail(401, "Sign in to continue.");
  const row = await db().prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
    .bind(tenantId, userId).first<{ role: string }>();
  if (row?.role !== "business_owner") fail(403, "Company owner access is required.");
  return userId;
}
async function body(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) fail(403, "Request origin was not accepted.");
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) fail(415, "Send JSON data.");
  const raw = await request.text();
  if (raw.length > 10000) fail(413, "Integration settings are too large.");
  try { return JSON.parse(raw) as unknown; } catch { return fail(400, "Invalid token settings."); }
}
function error(error: unknown) { return error instanceof ApiError ? reply({ error: error.message }, error.status) : reply({ error: "Could not update private tokens." }, 503); }
async function active(tenantId: string, tokenId: string) {
  const row = await db().prepare("SELECT id, status FROM api_tokens WHERE tenant_id = ? AND id = ?").bind(tenantId, tokenId).first<{ id: string; status: string }>();
  if (!row) fail(404, "Token not found.");
  if (row.status !== "active") fail(409, "This token has been revoked.");
}
const audit = (tenantId: string, userId: string, kind: string, tokenId: string) =>
  db().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, ?, 'api_token', ?)")
    .bind(crypto.randomUUID(), tenantId, userId, kind, tokenId);

export async function GET(request: Request) {
  try {
    const tenantId = new URL(request.url).searchParams.get("tenant_id") || "";
    await owner(request, tenantId);
    const rows = await db().prepare("SELECT id, name, description, permissions_json, key_last4, scope, document_scope, status, expires_at, last_used_at, created_at FROM api_tokens WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50").bind(tenantId).all();
    return reply({ items: rows.results.map(row => ({ ...row, permissions_json: undefined, permissions: row.permissions_json ? JSON.parse(String(row.permissions_json)) : null })) });
  } catch (cause) { return error(cause); }
}
export async function POST(request: Request) {
  try {
    const parsed = createInput.safeParse(await body(request));
    if (!parsed.success) fail(400, "Check the integration name, description, and permissions.");
    const data = parsed.data, userId = await owner(request, data.tenant_id);
    if (data.all_access && !data.acknowledge_all_access) fail(400, "Acknowledge the all-access warning.");
    const permissions = data.all_access ? integrationScopeKeys : data.permissions;
    if (!permissions.length || new Set(permissions).size !== permissions.length || permissions.some(scope => !integrationScopeSet.has(scope))) fail(400, "Choose valid, unique permissions.");
    if (!permissions.some(scope => implementedScopes.has(scope))) fail(400, "Choose at least one permission available in SaaS Launchup today.");
    const count = await db().prepare("SELECT count(*) AS total FROM api_tokens WHERE tenant_id = ? AND status = 'active'").bind(data.tenant_id).first<{ total: number }>();
    if (Number(count?.total || 0) >= 20) fail(409, "A company can have up to 20 active private tokens.");
    const id = crypto.randomUUID(), key = createApiToken(id);
    const expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
    await db().batch([
      db().prepare("INSERT INTO api_tokens (id, tenant_id, name, description, permissions_json, key_hash, key_last4, scope, document_scope, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'custom', 'none', ?, ?)")
        .bind(id, data.tenant_id, data.name, data.description, JSON.stringify({ requested: permissions, effective: permissions.filter(scope => implementedScopes.has(scope)) }), await hashWebsiteKey(key), key.slice(-4), userId, expiresAt),
      audit(data.tenant_id, userId, "api_token.created", id),
    ]);
    return reply({ token_id: id, api_token: key, expires_at: expiresAt }, 201);
  } catch (cause) { return error(cause); }
}
export async function PATCH(request: Request) {
  try {
    const parsed = rotateInput.safeParse(await body(request));
    if (!parsed.success) fail(400, "Choose a token to rotate.");
    const data = parsed.data, userId = await owner(request, data.tenant_id);
    await active(data.tenant_id, data.token_id);
    const key = createApiToken(data.token_id);
    await db().batch([
      db().prepare("UPDATE api_tokens SET key_hash = ?, key_last4 = ? WHERE tenant_id = ? AND id = ? AND status = 'active'")
        .bind(await hashWebsiteKey(key), key.slice(-4), data.tenant_id, data.token_id),
      audit(data.tenant_id, userId, "api_token.rotated", data.token_id),
    ]);
    return reply({ token_id: data.token_id, api_token: key });
  } catch (cause) { return error(cause); }
}
export async function DELETE(request: Request) {
  try {
    const parsed = revokeInput.safeParse(await body(request));
    if (!parsed.success) fail(400, "Confirm token revocation.");
    const data = parsed.data, userId = await owner(request, data.tenant_id);
    await active(data.tenant_id, data.token_id);
    await db().batch([
      db().prepare("UPDATE api_tokens SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?")
        .bind(data.tenant_id, data.token_id),
      audit(data.tenant_id, userId, "api_token.revoked", data.token_id),
    ]);
    return reply({ revoked: true });
  } catch (cause) { return error(cause); }
}
