import { env } from "cloudflare:workers";
import { z } from "zod";

type Member = { role: string; record_scope: string; team_id: string | null };
type Identity = { id: string; email: string | null };
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
const textField = (max = 160) => z.string().trim().min(1).max(max);
const optionalText = (max = 160) => z.string().trim().max(max).optional().nullable();
const tenantInput = z.object({ tenant_id: z.string().uuid() });
const organizationInput = z.object({
  name: textField(), legal_name: optionalText(), primary_domain: optionalText(253),
  timezone: textField(100).default("America/Chicago"),
}).strict();
const contactInput = tenantInput.extend({
  name: textField(), company_id: z.string().uuid().optional().nullable(), email: z.union([z.string().email().max(254), z.literal("")]).optional().nullable(),
  phone: optionalText(40), timezone: optionalText(100), source: optionalText(160),
}).strict();
const companyInput = tenantInput.extend({ name: textField(), domain: optionalText(253) }).strict();
const taskInput = tenantInput.extend({ title: textField(240), contact_id: z.string().uuid().optional().nullable(), due_at: optionalText(40) }).strict();
const noteInput = tenantInput.extend({ contact_id: z.string().uuid(), body: textField(10000) }).strict();
const updateOrganizationInput = tenantInput.extend({
  name: textField(), legal_name: optionalText(), primary_domain: optionalText(253), timezone: textField(100),
}).strict();

function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
function fail(status: number, message: string): never { throw new ApiError(status, message); }
function database(): D1Database { if (!env.DB) fail(503, "CRM storage is unavailable."); return env.DB; }
function identity(request: Request): Identity {
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id) fail(401, "Sign in to continue.");
  return { id, email: request.headers.get("oai-authenticated-user-email") };
}
function validateMutation(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) fail(403, "Request origin was not accepted.");
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) fail(415, "Send JSON data.");
}
async function body(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (raw.length > 20000) fail(413, "Request is too large.");
  try { return JSON.parse(raw); } catch { return fail(400, "Invalid JSON."); }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) fail(400, "Check the required fields and formats.");
  return result.data;
}
async function membership(db: D1Database, tenantId: string, userId: string): Promise<Member> {
  const row = await db.prepare("SELECT role, record_scope, team_id FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'").bind(tenantId, userId).first<Member>();
  if (!row) fail(403, "You do not have access to this organization.");
  return row;
}
function canWrite(member: Member) { return ["business_owner", "sales_manager", "sales_representative"].includes(member.role); }
function canManage(member: Member) { return member.role === "business_owner"; }
function recordFilter(member: Member, tenantId: string, userId: string, ownerColumn: string): { sql: string; args: unknown[] } {
  if (member.record_scope === "organization" && ["business_owner", "sales_manager", "marketing_manager", "support_readonly"].includes(member.role)) return { sql: "", args: [] };
  if (member.record_scope === "team" && member.team_id) return {
    sql: ` AND (${ownerColumn} = ? OR ${ownerColumn} IN (SELECT user_id FROM memberships WHERE tenant_id = ? AND team_id = ? AND status = 'active'))`,
    args: [userId, tenantId, member.team_id],
  };
  return { sql: ` AND ${ownerColumn} = ?`, args: [userId] };
}
function scope(member: Member, tenantId: string, userId: string, ownerColumn: string) {
  return recordFilter(member, tenantId, userId, ownerColumn);
}
async function checkContact(db: D1Database, tenantId: string, contactId: string, member: Member, userId: string) {
  const f = scope(member, tenantId, userId, "owner_user_id");
  const row = await db.prepare(`SELECT id FROM contacts WHERE tenant_id = ? AND id = ?${f.sql}`).bind(tenantId, contactId, ...f.args).first();
  if (!row) fail(404, "Contact not found.");
}
function audit(db: D1Database, tenantId: string, actor: string, kind: string, targetType: string, targetId: string) {
  return db.prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), tenantId, actor, kind, targetType, targetId);
}
async function handle(request: Request) {
  const db = database();
  const user = identity(request);
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource");
  if (!resource) fail(400, "Choose a resource.");
  if (request.method !== "GET") validateMutation(request);

  if (resource === "organizations") {
    if (request.method === "GET") {
      const rows = await db.prepare("SELECT o.id, o.name, o.legal_name, o.primary_domain, o.timezone, m.role FROM organizations o JOIN memberships m ON m.tenant_id = o.id WHERE m.user_id = ? AND m.status = 'active' ORDER BY o.created_at DESC LIMIT 100").bind(user.id).all();
      return json({ items: rows.results });
    }
    if (request.method === "POST") {
      const data = parse(organizationInput, await body(request));
      const tenantId = crypto.randomUUID(), pipelineId = crypto.randomUUID();
      const stages = ["New lead", "Contacted", "Qualified", "Proposal"];
      const statements = [
        db.prepare("INSERT INTO users (id, email) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email").bind(user.id, user.email),
        db.prepare("INSERT INTO organizations (id, name, legal_name, primary_domain, timezone) VALUES (?, ?, ?, ?, ?)").bind(tenantId, data.name, data.legal_name ?? null, data.primary_domain ?? null, data.timezone),
        db.prepare("INSERT INTO memberships (id, tenant_id, user_id, role, record_scope) VALUES (?, ?, ?, 'business_owner', 'organization')").bind(crypto.randomUUID(), tenantId, user.id),
        db.prepare("INSERT INTO pipelines (id, tenant_id, name) VALUES (?, ?, 'Sales pipeline')").bind(pipelineId, tenantId),
        ...stages.map((name, position) => db.prepare("INSERT INTO stages (id, tenant_id, pipeline_id, name, position) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), tenantId, pipelineId, name, position)),
        audit(db, tenantId, user.id, "organization.created", "organization", tenantId),
      ];
      await db.batch(statements);
      return json({ id: tenantId, name: data.name, role: "business_owner" }, 201);
    }
    if (request.method === "PATCH") {
      const data = parse(updateOrganizationInput, await body(request));
      const member = await membership(db, data.tenant_id, user.id);
      if (!canManage(member)) fail(403, "Owner access is required.");
      await db.batch([
        db.prepare("UPDATE organizations SET name = ?, legal_name = ?, primary_domain = ?, timezone = ? WHERE id = ?").bind(data.name, data.legal_name ?? null, data.primary_domain ?? null, data.timezone, data.tenant_id),
        audit(db, data.tenant_id, user.id, "organization.updated", "organization", data.tenant_id),
      ]);
      return json({ saved: true });
    }
  }

  const tenantId = url.searchParams.get("tenant_id");
  if (!tenantId || !z.string().uuid().safeParse(tenantId).success) fail(400, "Choose an organization.");
  const member = await membership(db, tenantId, user.id);

  if (resource === "memberships" && request.method === "GET") {
    if (!canManage(member)) fail(403, "Owner access is required.");
    const rows = await db.prepare("SELECT m.user_id, u.email, u.display_name, m.role, m.record_scope, m.status FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? ORDER BY m.created_at").bind(tenantId).all();
    return json({ items: rows.results });
  }
  if (resource === "contacts") {
    if (request.method === "GET") {
      const f = scope(member, tenantId, user.id, "c.owner_user_id");
      const rows = await db.prepare(`SELECT c.id, c.name, c.email, c.phone, c.timezone, c.source, c.lifecycle_stage, c.owner_user_id, c.company_id, co.name AS company_name, c.created_at FROM contacts c LEFT JOIN companies co ON co.id = c.company_id AND co.tenant_id = c.tenant_id WHERE c.tenant_id = ?${f.sql} ORDER BY c.created_at DESC LIMIT 100`).bind(tenantId, ...f.args).all();
      return json({ items: rows.results });
    }
    if (request.method === "POST") {
      if (!canWrite(member)) fail(403, "Your role cannot create contacts.");
      const data = parse(contactInput, await body(request));
      if (data.tenant_id !== tenantId) fail(400, "Organization mismatch.");
      if (data.company_id) {
        const company = await db.prepare("SELECT id FROM companies WHERE tenant_id = ? AND id = ?").bind(tenantId, data.company_id).first();
        if (!company) fail(400, "Choose a company in this organization.");
      }
      const id = crypto.randomUUID();
      await db.batch([
        db.prepare("INSERT INTO contacts (id, tenant_id, company_id, name, email, phone, timezone, source, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, tenantId, data.company_id ?? null, data.name, data.email || null, data.phone ?? null, data.timezone ?? null, data.source ?? null, user.id),
        audit(db, tenantId, user.id, "contact.created", "contact", id),
      ]);
      return json({ id }, 201);
    }
  }
  if (resource === "companies") {
    if (request.method === "GET") {
      const f = scope(member, tenantId, user.id, "owner_user_id");
      const rows = await db.prepare(`SELECT id, name, domain, owner_user_id FROM companies WHERE tenant_id = ?${f.sql} ORDER BY name LIMIT 100`).bind(tenantId, ...f.args).all();
      return json({ items: rows.results });
    }
    if (request.method === "POST") {
      if (!canWrite(member)) fail(403, "Your role cannot create companies.");
      const data = parse(companyInput, await body(request));
      if (data.tenant_id !== tenantId) fail(400, "Organization mismatch.");
      const id = crypto.randomUUID();
      await db.batch([
        db.prepare("INSERT INTO companies (id, tenant_id, name, domain, owner_user_id) VALUES (?, ?, ?, ?, ?)").bind(id, tenantId, data.name, data.domain ?? null, user.id),
        audit(db, tenantId, user.id, "company.created", "company", id),
      ]);
      return json({ id }, 201);
    }
  }
  if (resource === "tasks") {
    if (request.method === "GET") {
      const f = scope(member, tenantId, user.id, "assignee_user_id");
      const rows = await db.prepare(`SELECT id, title, contact_id, due_at, status, assignee_user_id, created_at FROM tasks WHERE tenant_id = ?${f.sql} ORDER BY created_at DESC LIMIT 100`).bind(tenantId, ...f.args).all();
      return json({ items: rows.results });
    }
    if (request.method === "POST") {
      if (!canWrite(member)) fail(403, "Your role cannot create tasks.");
      const data = parse(taskInput, await body(request));
      if (data.tenant_id !== tenantId) fail(400, "Organization mismatch.");
      if (data.contact_id) await checkContact(db, tenantId, data.contact_id, member, user.id);
      const id = crypto.randomUUID();
      await db.batch([
        db.prepare("INSERT INTO tasks (id, tenant_id, contact_id, title, due_at, assignee_user_id) VALUES (?, ?, ?, ?, ?, ?)").bind(id, tenantId, data.contact_id ?? null, data.title, data.due_at ?? null, user.id),
        audit(db, tenantId, user.id, "task.created", "task", id),
      ]);
      return json({ id }, 201);
    }
  }
  if (resource === "notes") {
    const contactId = url.searchParams.get("contact_id");
    if (request.method === "GET") {
      if (!contactId) fail(400, "Choose a contact.");
      await checkContact(db, tenantId, contactId, member, user.id);
      const rows = await db.prepare("SELECT id, body, created_by, created_at FROM notes WHERE tenant_id = ? AND contact_id = ? ORDER BY created_at DESC LIMIT 100").bind(tenantId, contactId).all();
      return json({ items: rows.results });
    }
    if (request.method === "POST") {
      if (!canWrite(member)) fail(403, "Your role cannot create notes.");
      const data = parse(noteInput, await body(request));
      if (data.tenant_id !== tenantId) fail(400, "Organization mismatch.");
      await checkContact(db, tenantId, data.contact_id, member, user.id);
      const id = crypto.randomUUID();
      await db.batch([
        db.prepare("INSERT INTO notes (id, tenant_id, contact_id, body, created_by) VALUES (?, ?, ?, ?, ?)").bind(id, tenantId, data.contact_id, data.body, user.id),
        audit(db, tenantId, user.id, "note.created", "note", id),
      ]);
      return json({ id }, 201);
    }
  }
  if (resource === "pipelines" && request.method === "GET") {
    const rows = await db.prepare("SELECT p.id AS pipeline_id, p.name AS pipeline_name, s.id AS stage_id, s.name AS stage_name, s.position FROM pipelines p JOIN stages s ON s.pipeline_id = p.id AND s.tenant_id = p.tenant_id WHERE p.tenant_id = ? ORDER BY p.created_at, s.position").bind(tenantId).all();
    return json({ items: rows.results });
  }
  if (resource === "audit" && request.method === "GET") {
    if (!canManage(member)) fail(403, "Owner access is required.");
    const rows = await db.prepare("SELECT id, actor_user_id, kind, target_type, target_id, created_at FROM audit_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100").bind(tenantId).all();
    return json({ items: rows.results });
  }
  return fail(405, "This action is unavailable.");
}

async function respond(request: Request) {
  try { return await handle(request); }
  catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    console.error("CRM request failed", error);
    return json({ error: "The CRM is temporarily unavailable." }, 503);
  }
}
export const GET = respond;
export const POST = respond;
export const PATCH = respond;
