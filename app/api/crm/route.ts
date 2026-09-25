import { env } from "cloudflare:workers";
import { z } from "zod";
import { getRequestIdentity } from "../../../lib/access-identity";

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
const taskInput = tenantInput.extend({ title: textField(240), contact_id: z.string().uuid().optional().nullable(), source_note_id: z.string().uuid().optional().nullable(), due_at: optionalText(40) }).strict();
const noteInput = tenantInput.extend({ contact_id: z.string().uuid(), body: textField(10000) }).strict();
const updateOrganizationInput = tenantInput.extend({
  name: textField(), legal_name: optionalText(), primary_domain: optionalText(253), timezone: textField(100),
}).strict();
const moveContactInput = tenantInput.extend({ contact_id: z.string().uuid(), stage_id: z.string().uuid() }).strict();
const pipelineCreateInput = tenantInput.extend({ name: textField(120) }).strict();
const pipelineUpdateInput = tenantInput.extend({ action: z.enum(["rename_pipeline","add_stage","rename_stage","move_stage","delete_stage","delete_pipeline"]), pipeline_id: z.string().uuid(), stage_id: z.string().uuid().optional(), name: textField(120).optional(), direction: z.enum(["up","down"]).optional() }).strict();
const automationInput = tenantInput.extend({ id: z.string().uuid().optional(), name: textField(160), pipeline_id: z.string().uuid(), stage_id: z.string().uuid().optional().nullable(), trigger_kind: z.enum(["contact_entered_stage","opportunity_entered_stage","opportunity_won","opportunity_lost","form_submitted","ad_lead_captured","awareness_engaged"]), action_kind: z.enum(["email","sms","webhook","call_task"]), config: z.object({ subject: z.string().trim().max(180).optional(), body: z.string().trim().max(5000).optional(), endpoint_url: z.string().trim().max(500).optional(), template_id: z.string().uuid().optional(), campaign_id: z.string().uuid().optional() }).strict() }).strict();
const automationDeleteInput = tenantInput.extend({ id: z.string().uuid(), confirmation: z.literal("delete") }).strict();
const deleteContactInput = tenantInput.extend({ contact_id: z.string().uuid(), confirmation: z.literal("delete") }).strict();
const opportunityInput = tenantInput.extend({
  id: z.string().uuid().optional(), title: textField(240), stage_id: z.string().uuid(),
  contact_id: z.string().uuid().optional().nullable(), company_id: z.string().uuid().optional().nullable(),
  value_cents: z.number().int().min(0).max(100000000000), status: z.enum(["open", "won", "lost"]),
  deal_type: optionalText(100), outcome_reason: optionalText(300),
}).strict();

function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
function fail(status: number, message: string): never { throw new ApiError(status, message); }
function database(): D1Database { if (!env.DB) fail(503, "CRM storage is unavailable."); return env.DB; }
async function identity(request: Request): Promise<Identity> {
  const user = await getRequestIdentity(request.headers);
  if (!user) fail(401, "Sign in to continue.");
  return { id: user.userId, email: user.email };
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
function canReadSales(member: Member) { return ["business_owner", "sales_manager", "sales_representative"].includes(member.role); }
function canConfigurePipeline(member: Member) { return ["business_owner", "sales_manager"].includes(member.role); }
function canConfigureAutomations(member: Member) { return ["business_owner", "sales_manager", "marketing_manager"].includes(member.role); }
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
  const user = await identity(request);
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
  if (["contacts", "opportunities", "tasks", "notes"].includes(resource) && !canReadSales(member)) fail(403, "Sales access is required.");
  if (resource === "pipelines" && !canReadSales(member) && member.role !== "marketing_manager") fail(403, "Pipeline access is required.");
  if (resource === "automation-rules" && !canConfigureAutomations(member)) fail(403, "Automation access is required.");

  if (resource === "memberships" && request.method === "GET") {
    if (!canManage(member)) fail(403, "Owner access is required.");
    const rows = await db.prepare("SELECT m.user_id, u.email, u.display_name, m.role, m.record_scope, m.status FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? ORDER BY m.created_at").bind(tenantId).all();
    return json({ items: rows.results });
  }
  if (resource === "contacts") {
    if (request.method === "GET") {
      const f = scope(member, tenantId, user.id, "c.owner_user_id");
      const rows = await db.prepare(`SELECT c.id, c.name, c.email, c.phone, c.timezone, c.source, c.lifecycle_stage, c.pipeline_id, c.stage_id, c.owner_user_id, c.company_id, co.name AS company_name, co.domain AS company_domain, co.research_summary AS company_research_summary, co.research_source_url AS company_research_source_url, c.created_at FROM contacts c LEFT JOIN companies co ON co.id = c.company_id AND co.tenant_id = c.tenant_id WHERE c.tenant_id = ?${f.sql} ORDER BY c.created_at DESC LIMIT 100`).bind(tenantId, ...f.args).all();
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
      const firstStage = await db.prepare("SELECT s.id, s.pipeline_id, s.name FROM stages s JOIN pipelines p ON p.id = s.pipeline_id AND p.tenant_id = s.tenant_id WHERE s.tenant_id = ? ORDER BY p.created_at, s.position LIMIT 1").bind(tenantId).first<{id:string;pipeline_id:string;name:string}>();
      await db.batch([
        db.prepare("INSERT INTO contacts (id, tenant_id, company_id, name, email, phone, timezone, source, owner_user_id, pipeline_id, stage_id, lifecycle_stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, tenantId, data.company_id ?? null, data.name, data.email || null, data.phone ?? null, data.timezone ?? null, data.source ?? null, user.id, firstStage?.pipeline_id??null, firstStage?.id??null, firstStage?.name??"New lead"),
        audit(db, tenantId, user.id, "contact.created", "contact", id),
      ]);
      return json({ id }, 201);
    }
    if (request.method === "PATCH") {
      if (!canWrite(member)) fail(403, "Your role cannot move contacts.");
      const data = parse(moveContactInput, await body(request));
      if (data.tenant_id !== tenantId) fail(400, "Organization mismatch.");
      await checkContact(db, tenantId, data.contact_id, member, user.id);
      const previous = await db.prepare("SELECT pipeline_id, stage_id FROM contacts WHERE tenant_id = ? AND id = ?").bind(tenantId, data.contact_id).first<{pipeline_id:string|null;stage_id:string|null}>();
      const stage = await db.prepare("SELECT name, pipeline_id FROM stages WHERE tenant_id = ? AND id = ?").bind(tenantId, data.stage_id).first<{name: string; pipeline_id: string}>();
      if (!stage) fail(400, "Choose a stage in this organization.");
      if (previous?.stage_id === data.stage_id && previous.pipeline_id === stage.pipeline_id) return json({ saved: true, unchanged: true, stage: stage.name });
      await db.batch([
        db.prepare("UPDATE contacts SET lifecycle_stage = ?, pipeline_id = ?, stage_id = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?").bind(stage.name, stage.pipeline_id, data.stage_id, tenantId, data.contact_id),
        db.prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id, details_json) VALUES (?, ?, ?, 'contact.stage_changed', 'contact', ?, ?)").bind(crypto.randomUUID(), tenantId, user.id, data.contact_id, JSON.stringify({from_pipeline_id:previous?.pipeline_id??null,from_stage_id:previous?.stage_id??null,to_pipeline_id:stage.pipeline_id,to_stage_id:data.stage_id})),
      ]);
      return json({ saved: true, stage: stage.name });
    }
    if (request.method === "DELETE") {
      if (!canWrite(member)) fail(403, "Your role cannot delete contacts.");
      const data = parse(deleteContactInput, await body(request));
      if (data.tenant_id !== tenantId) fail(400, "Organization mismatch.");
      await checkContact(db, tenantId, data.contact_id, member, user.id);
      await db.batch([
        db.prepare("UPDATE tasks SET source_note_id = NULL WHERE tenant_id = ? AND source_note_id IN (SELECT id FROM notes WHERE tenant_id = ? AND contact_id = ?)").bind(tenantId, tenantId, data.contact_id),
        db.prepare("UPDATE tasks SET contact_id = NULL WHERE tenant_id = ? AND contact_id = ?").bind(tenantId, data.contact_id),
        db.prepare("UPDATE opportunities SET contact_id = NULL WHERE tenant_id = ? AND contact_id = ?").bind(tenantId, data.contact_id),
        db.prepare("DELETE FROM notes WHERE tenant_id = ? AND contact_id = ?").bind(tenantId, data.contact_id),
        db.prepare("DELETE FROM activities WHERE tenant_id = ? AND contact_id = ?").bind(tenantId, data.contact_id),
        db.prepare("DELETE FROM consent_records WHERE tenant_id = ? AND contact_id = ?").bind(tenantId, data.contact_id),
        db.prepare("DELETE FROM suppression_records WHERE tenant_id = ? AND contact_id = ?").bind(tenantId, data.contact_id),
        db.prepare("DELETE FROM contacts WHERE tenant_id = ? AND id = ?").bind(tenantId, data.contact_id),
        audit(db, tenantId, user.id, "contact.deleted", "contact", data.contact_id),
      ]);
      return json({ deleted: true });
    }
  }
  if (resource === "opportunities") {
    if (request.method === "GET") {
      const f = scope(member, tenantId, user.id, "o.owner_user_id");
      const rows = await db.prepare(`SELECT o.id, o.title, o.value_cents, o.status, o.stage_id, o.contact_id, o.company_id, o.deal_type, o.outcome_reason, o.closed_at, o.owner_user_id FROM opportunities o WHERE o.tenant_id = ?${f.sql} ORDER BY o.updated_at DESC LIMIT 100`).bind(tenantId, ...f.args).all();
      return json({ items: rows.results });
    }
    if (request.method === "POST" || request.method === "PATCH") {
      if (!canWrite(member)) fail(403, "Your role cannot manage opportunities.");
      const data = parse(opportunityInput, await body(request));
      if (data.tenant_id !== tenantId) fail(400, "Organization mismatch.");
      if (request.method === "POST" && data.id) fail(400, "New opportunities cannot have an ID.");
      if (request.method === "PATCH" && !data.id) fail(400, "Choose an opportunity.");
      const stage = await db.prepare("SELECT id FROM stages WHERE tenant_id = ? AND id = ?").bind(tenantId, data.stage_id).first();
      if (!stage) fail(400, "Choose a stage in this organization.");
      if (data.contact_id) await checkContact(db, tenantId, data.contact_id, member, user.id);
      if (data.company_id) {
        const company = await db.prepare("SELECT id FROM companies WHERE tenant_id = ? AND id = ?").bind(tenantId, data.company_id).first();
        if (!company) fail(400, "Choose a company in this organization.");
      }
      if (request.method === "PATCH") {
        const f = scope(member, tenantId, user.id, "owner_user_id");
        const existing = await db.prepare(`SELECT id, status, closed_at FROM opportunities WHERE tenant_id = ? AND id = ?${f.sql}`).bind(tenantId, data.id, ...f.args).first<{ id: string; status: string; closed_at: string | null }>();
        if (!existing) fail(404, "Opportunity not found.");
        await db.batch([
          db.prepare("UPDATE opportunities SET title = ?, stage_id = ?, contact_id = ?, company_id = ?, value_cents = ?, status = ?, deal_type = ?, outcome_reason = ?, closed_at = CASE WHEN ? = 'open' THEN NULL WHEN ? = 'open' OR closed_at IS NULL THEN CURRENT_TIMESTAMP ELSE closed_at END, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?").bind(data.title, data.stage_id, data.contact_id ?? null, data.company_id ?? null, data.value_cents, data.status, data.deal_type || null, data.outcome_reason || null, data.status, existing.status, tenantId, data.id),
          audit(db, tenantId, user.id, "opportunity.updated", "opportunity", data.id!),
        ]);
        return json({ saved: true });
      }
      const id = crypto.randomUUID();
      await db.batch([
        db.prepare("INSERT INTO opportunities (id, tenant_id, contact_id, company_id, stage_id, title, value_cents, status, owner_user_id, deal_type, outcome_reason, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'open' THEN NULL ELSE CURRENT_TIMESTAMP END)").bind(id, tenantId, data.contact_id ?? null, data.company_id ?? null, data.stage_id, data.title, data.value_cents, data.status, user.id, data.deal_type || null, data.outcome_reason || null, data.status),
        audit(db, tenantId, user.id, "opportunity.created", "opportunity", id),
      ]);
      return json({ id }, 201);
    }
  }
  if (resource === "companies") {
    if (request.method === "GET") {
      const f = scope(member, tenantId, user.id, "owner_user_id");
      const rows = await db.prepare(`SELECT id, name, domain, research_summary, research_source_url, researched_at, owner_user_id FROM companies WHERE tenant_id = ?${f.sql} ORDER BY name LIMIT 100`).bind(tenantId, ...f.args).all();
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
      const mine = url.searchParams.get("mine") === "1";
      const rows = await db.prepare(`SELECT id, title, contact_id, source_note_id, due_at, status, assignee_user_id, created_at FROM tasks WHERE tenant_id = ?${mine ? " AND assignee_user_id = ?" : ""}${f.sql} ORDER BY created_at DESC LIMIT 100`).bind(tenantId, ...(mine ? [user.id] : []), ...f.args).all();
      return json({ items: rows.results });
    }
    if (request.method === "POST") {
      if (!canWrite(member)) fail(403, "Your role cannot create tasks.");
      const data = parse(taskInput, await body(request));
      if (data.tenant_id !== tenantId) fail(400, "Organization mismatch.");
      if (data.contact_id) await checkContact(db, tenantId, data.contact_id, member, user.id);
      if (data.source_note_id) {
        const note = await db.prepare("SELECT contact_id FROM notes WHERE tenant_id = ? AND id = ? AND created_by = ?").bind(tenantId, data.source_note_id, user.id).first<{ contact_id: string }>();
        if (!note || note.contact_id !== data.contact_id) fail(400, "Choose one of your notes for this contact.");
        const existingTask = await db.prepare("SELECT id FROM tasks WHERE tenant_id = ? AND source_note_id = ?").bind(tenantId, data.source_note_id).first<{ id: string }>();
        if (existingTask) return json({ id: existingTask.id, already_created: true });
      }
      const id = crypto.randomUUID();
      await db.batch([
        db.prepare("INSERT INTO tasks (id, tenant_id, contact_id, source_note_id, title, due_at, assignee_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, tenantId, data.contact_id ?? null, data.source_note_id ?? null, data.title, data.due_at ?? null, user.id),
        audit(db, tenantId, user.id, "task.created", "task", id),
      ]);
      return json({ id }, 201);
    }
  }
  if (resource === "notes") {
    const contactId = url.searchParams.get("contact_id");
    if (request.method === "GET") {
      if (contactId) await checkContact(db, tenantId, contactId, member, user.id);
      const f = scope(member, tenantId, user.id, "c.owner_user_id");
      const mine = url.searchParams.get("mine") === "1";
      const rows = await db.prepare(`SELECT n.id, n.body, n.contact_id, n.created_by, n.created_at, c.name AS contact_name, t.id AS task_id FROM notes n JOIN contacts c ON c.id = n.contact_id AND c.tenant_id = n.tenant_id LEFT JOIN tasks t ON t.source_note_id = n.id AND t.tenant_id = n.tenant_id WHERE n.tenant_id = ?${contactId ? " AND n.contact_id = ?" : ""}${mine ? " AND n.created_by = ?" : ""}${f.sql} ORDER BY n.created_at DESC LIMIT 100`).bind(tenantId, ...(contactId ? [contactId] : []), ...(mine ? [user.id] : []), ...f.args).all();
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
  if (resource === "pipelines") {
    if (request.method === "GET") {
      const rows = await db.prepare("SELECT p.id AS pipeline_id, p.name AS pipeline_name, s.id AS stage_id, s.name AS stage_name, s.position FROM pipelines p LEFT JOIN stages s ON s.pipeline_id = p.id AND s.tenant_id = p.tenant_id WHERE p.tenant_id = ? ORDER BY p.created_at, s.position").bind(tenantId).all();
      return json({ items: rows.results });
    }
    if (!canConfigurePipeline(member)) fail(403, "Manager access is required to edit pipelines.");
    if (request.method === "POST") {
      const data = parse(pipelineCreateInput, await body(request));
      if (data.tenant_id !== tenantId) fail(400, "Organization mismatch.");
      const duplicate = await db.prepare("SELECT id FROM pipelines WHERE tenant_id = ? AND lower(name) = lower(?)").bind(tenantId, data.name).first();
      if (duplicate) fail(409, "A pipeline with this name already exists.");
      const pipelineId = crypto.randomUUID(), stageId = crypto.randomUUID();
      await db.batch([
        db.prepare("INSERT INTO pipelines (id, tenant_id, name) VALUES (?, ?, ?)").bind(pipelineId, tenantId, data.name),
        db.prepare("INSERT INTO stages (id, tenant_id, pipeline_id, name, position) VALUES (?, ?, ?, 'New lead', 0)").bind(stageId, tenantId, pipelineId),
        audit(db, tenantId, user.id, "pipeline.created", "pipeline", pipelineId),
      ]);
      return json({ id: pipelineId, stage_id: stageId }, 201);
    }
    if (request.method === "PATCH") {
      const data = parse(pipelineUpdateInput, await body(request));
      if (data.tenant_id !== tenantId) fail(400, "Organization mismatch.");
      const pipeline = await db.prepare("SELECT id FROM pipelines WHERE tenant_id = ? AND id = ?").bind(tenantId, data.pipeline_id).first();
      if (!pipeline) fail(404, "Pipeline not found.");
      if (data.action === "rename_pipeline") {
        if (!data.name) fail(400, "Enter a pipeline name.");
        const duplicate = await db.prepare("SELECT id FROM pipelines WHERE tenant_id = ? AND lower(name) = lower(?) AND id != ?").bind(tenantId, data.name, data.pipeline_id).first();
        if (duplicate) fail(409, "A pipeline with this name already exists.");
        await db.batch([db.prepare("UPDATE pipelines SET name = ? WHERE tenant_id = ? AND id = ?").bind(data.name, tenantId, data.pipeline_id), audit(db, tenantId, user.id, "pipeline.renamed", "pipeline", data.pipeline_id)]);
        return json({ saved: true });
      }
      if (data.action === "add_stage") {
        if (!data.name) fail(400, "Enter a stage name.");
        const existing = await db.prepare("SELECT id FROM stages WHERE tenant_id = ? AND pipeline_id = ? AND lower(name) = lower(?)").bind(tenantId, data.pipeline_id, data.name).first();
        if (existing) fail(409, "This stage name already exists in the pipeline.");
        const count = await db.prepare("SELECT count(*) AS total, coalesce(max(position), -1) AS last_position FROM stages WHERE tenant_id = ? AND pipeline_id = ?").bind(tenantId, data.pipeline_id).first<{total:number;last_position:number}>();
        if ((count?.total ?? 0) >= 30) fail(400, "A pipeline can have up to 30 stages.");
        const id = crypto.randomUUID();
        await db.batch([db.prepare("INSERT INTO stages (id, tenant_id, pipeline_id, name, position) VALUES (?, ?, ?, ?, ?)").bind(id, tenantId, data.pipeline_id, data.name, Number(count?.last_position ?? -1) + 1), audit(db, tenantId, user.id, "pipeline.stage_created", "stage", id)]);
        return json({ id }, 201);
      }
      if (data.action === "delete_pipeline") {
        const pipelines = await db.prepare("SELECT count(*) AS total FROM pipelines WHERE tenant_id = ?").bind(tenantId).first<{total:number}>();
        if ((pipelines?.total ?? 0) <= 1) fail(400, "Keep at least one pipeline.");
        const references = await db.prepare("SELECT (SELECT count(*) FROM contacts WHERE tenant_id = ? AND pipeline_id = ?) + (SELECT count(*) FROM opportunities o JOIN stages s ON s.id = o.stage_id WHERE o.tenant_id = ? AND s.pipeline_id = ?) + (SELECT count(*) FROM pipeline_automation_rules WHERE tenant_id = ? AND pipeline_id = ?) AS total").bind(tenantId, data.pipeline_id, tenantId, data.pipeline_id, tenantId, data.pipeline_id).first<{total:number}>();
        if (Number(references?.total ?? 0) > 0) fail(409, "Move contacts and opportunities and remove linked automation rules before deleting this pipeline.");
        await db.batch([db.prepare("DELETE FROM stages WHERE tenant_id = ? AND pipeline_id = ?").bind(tenantId, data.pipeline_id), db.prepare("DELETE FROM pipelines WHERE tenant_id = ? AND id = ?").bind(tenantId, data.pipeline_id), audit(db, tenantId, user.id, "pipeline.deleted", "pipeline", data.pipeline_id)]);
        return json({ deleted: true });
      }
      if (!data.stage_id) fail(400, "Choose a stage.");
      const stage = await db.prepare("SELECT id, name, position FROM stages WHERE tenant_id = ? AND pipeline_id = ? AND id = ?").bind(tenantId, data.pipeline_id, data.stage_id).first<{id:string;name:string;position:number}>();
      if (!stage) fail(404, "Stage not found in this pipeline.");
      if (data.action === "rename_stage") {
        if (!data.name) fail(400, "Enter a stage name.");
        const duplicate = await db.prepare("SELECT id FROM stages WHERE tenant_id = ? AND pipeline_id = ? AND lower(name) = lower(?) AND id != ?").bind(tenantId, data.pipeline_id, data.name, stage.id).first();
        if (duplicate) fail(409, "This stage name already exists in the pipeline.");
        await db.batch([
          db.prepare("UPDATE stages SET name = ? WHERE tenant_id = ? AND id = ?").bind(data.name, tenantId, stage.id),
          db.prepare("UPDATE contacts SET lifecycle_stage = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND stage_id = ?").bind(data.name, tenantId, stage.id),
          audit(db, tenantId, user.id, "pipeline.stage_renamed", "stage", stage.id),
        ]);
        return json({ saved: true });
      }
      if (data.action === "move_stage") {
        if (!data.direction) fail(400, "Choose a direction.");
        const other = await db.prepare(`SELECT id, position FROM stages WHERE tenant_id = ? AND pipeline_id = ? AND position ${data.direction === "up" ? "<" : ">"} ? ORDER BY position ${data.direction === "up" ? "DESC" : "ASC"} LIMIT 1`).bind(tenantId, data.pipeline_id, stage.position).first<{id:string;position:number}>();
        if (!other) return json({ saved: true });
        await db.batch([db.prepare("UPDATE stages SET position = ? WHERE tenant_id = ? AND id = ?").bind(other.position, tenantId, stage.id), db.prepare("UPDATE stages SET position = ? WHERE tenant_id = ? AND id = ?").bind(stage.position, tenantId, other.id), audit(db, tenantId, user.id, "pipeline.stage_reordered", "stage", stage.id)]);
        return json({ saved: true });
      }
      if (data.action === "delete_stage") {
        const remaining = await db.prepare("SELECT count(*) AS total FROM stages WHERE tenant_id = ? AND pipeline_id = ?").bind(tenantId, data.pipeline_id).first<{total:number}>();
        if ((remaining?.total ?? 0) <= 1) fail(400, "Keep at least one stage in each pipeline.");
        const references = await db.prepare("SELECT (SELECT count(*) FROM contacts WHERE tenant_id = ? AND stage_id = ?) + (SELECT count(*) FROM opportunities WHERE tenant_id = ? AND stage_id = ?) + (SELECT count(*) FROM pipeline_automation_rules WHERE tenant_id = ? AND stage_id = ?) AS total").bind(tenantId, stage.id, tenantId, stage.id, tenantId, stage.id).first<{total:number}>();
        if (Number(references?.total ?? 0) > 0) fail(409, "Move contacts and opportunities and remove linked automation rules before deleting this stage.");
        await db.batch([db.prepare("DELETE FROM stages WHERE tenant_id = ? AND id = ?").bind(tenantId, stage.id), audit(db, tenantId, user.id, "pipeline.stage_deleted", "stage", stage.id)]);
        return json({ deleted: true });
      }
    }
  }
  if (resource === "automation-rules") {
    if (!canConfigureAutomations(member)) fail(403, "Automation manager access is required.");
    if (request.method === "GET") {
      const rows = await db.prepare("SELECT r.id, r.pipeline_id, p.name AS pipeline_name, r.stage_id, s.name AS stage_name, r.name, r.trigger_kind, r.action_kind, r.config_json, r.status, r.created_at, r.updated_at FROM pipeline_automation_rules r JOIN pipelines p ON p.id = r.pipeline_id AND p.tenant_id = r.tenant_id LEFT JOIN stages s ON s.id = r.stage_id AND s.tenant_id = r.tenant_id WHERE r.tenant_id = ? ORDER BY r.updated_at DESC LIMIT 100").bind(tenantId).all();
      return json({ items: rows.results.map(row => ({ ...row, config: JSON.parse(String(row.config_json)), config_json: undefined })) });
    }
    if (request.method === "POST") {
      const data = parse(automationInput, await body(request));
      if (data.tenant_id !== tenantId) fail(400, "Organization mismatch.");
      const pipeline = await db.prepare("SELECT id FROM pipelines WHERE tenant_id = ? AND id = ?").bind(tenantId, data.pipeline_id).first();
      if (!pipeline) fail(404, "Pipeline not found.");
      const needsStage = ["contact_entered_stage", "opportunity_entered_stage"].includes(data.trigger_kind);
      if (needsStage && !data.stage_id) fail(400, "Choose a trigger stage.");
      if (data.stage_id) {
        const stage = await db.prepare("SELECT id FROM stages WHERE tenant_id = ? AND pipeline_id = ? AND id = ?").bind(tenantId, data.pipeline_id, data.stage_id).first();
        if (!stage) fail(400, "Choose a stage in this pipeline.");
      }
      const config: Record<string,string> = {};
      let template: {subject:string|null;body:string}|null=null;
      if(data.config.template_id){
        if(!["email","sms"].includes(data.action_kind))fail(400,"This action does not use a message template.");
        template=await db.prepare("SELECT subject, body FROM message_templates WHERE tenant_id = ? AND id = ? AND channel = ?").bind(tenantId,data.config.template_id,data.action_kind).first<{subject:string|null;body:string}>();
        if(!template)fail(400,"Choose a saved template for this channel.");
        config.template_id=data.config.template_id;
      }
      if(data.config.campaign_id){
        if(data.action_kind!=="email"||data.config.template_id)fail(400,"Choose one email template or campaign draft.");
        const campaign=await db.prepare("SELECT content_json FROM marketing_documents WHERE tenant_id = ? AND id = ? AND kind = 'email'").bind(tenantId,data.config.campaign_id).first<{content_json:string}>();
        if(!campaign)fail(400,"Choose a saved email campaign draft.");
        let content:{subject?:unknown;body?:unknown};try{content=JSON.parse(campaign.content_json)}catch{fail(400,"Campaign content is invalid.")}
        if(typeof content.subject!=="string"||!content.subject.trim()||content.subject.length>180||typeof content.body!=="string"||!content.body.trim()||content.body.length>5000)fail(400,"Campaign needs an email subject and body under 5,000 characters.");
        template={subject:content.subject.trim(),body:content.body.trim()};config.campaign_id=data.config.campaign_id;
      }
      if (data.action_kind === "email") {
        if (!(template?.subject||data.config.subject) || !(template?.body||data.config.body)) fail(400, "Enter an email subject and body.");
        config.subject = template?.subject||data.config.subject!; config.body = template?.body||data.config.body!;
      } else if (data.action_kind === "sms") {
        if (!(template?.body||data.config.body)) fail(400, "Enter a text message.");
        config.body = template?.body||data.config.body!;
      } else if (data.action_kind === "call_task") {
        if(!data.config.body)fail(400,"Add a call task description.");
        config.body=data.config.body;
      } else {
        if (!data.config.endpoint_url) fail(400, "Enter a webhook endpoint.");
        let endpoint: URL;
        try { endpoint = new URL(data.config.endpoint_url); } catch { fail(400, "Use a public HTTPS webhook URL."); }
        const host = endpoint.hostname.toLowerCase();
        if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) || !/[a-z]/.test(host.split(".").at(-1) || "") || host.split(".").some(label => label.startsWith("-") || label.endsWith("-")) || [".localhost", ".local", ".internal", ".test", ".example", ".invalid", ".onion", ".lan", ".corp", ".nip.io", ".sslip.io", ".xip.io", ".localtest.me", ".lvh.me"].some(suffix => host.endsWith(suffix))) fail(400, "Use a public HTTPS endpoint without credentials or query parameters.");
        config.endpoint_url = endpoint.toString();
      }
      const stageId = needsStage ? data.stage_id! : null;
      const id = data.id ?? crypto.randomUUID();
      if (data.id) {
        const existing = await db.prepare("SELECT id FROM pipeline_automation_rules WHERE tenant_id = ? AND id = ?").bind(tenantId, id).first();
        if (!existing) fail(404, "Automation rule not found.");
        await db.batch([
          db.prepare("UPDATE pipeline_automation_rules SET pipeline_id = ?, stage_id = ?, name = ?, trigger_kind = ?, action_kind = ?, config_json = ?, status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?").bind(data.pipeline_id, stageId, data.name, data.trigger_kind, data.action_kind, JSON.stringify(config), tenantId, id),
          audit(db, tenantId, user.id, "automation.rule_updated", "pipeline_automation_rule", id),
        ]);
      } else {
        await db.batch([
          db.prepare("INSERT INTO pipeline_automation_rules (id, tenant_id, pipeline_id, stage_id, name, trigger_kind, action_kind, config_json, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, tenantId, data.pipeline_id, stageId, data.name, data.trigger_kind, data.action_kind, JSON.stringify(config), user.id),
          audit(db, tenantId, user.id, "automation.rule_created", "pipeline_automation_rule", id),
        ]);
      }
      return json({ id, status: "draft", saved: true }, data.id ? 200 : 201);
    }
    if (request.method === "DELETE") {
      const data = parse(automationDeleteInput, await body(request));
      if (data.tenant_id !== tenantId) fail(400, "Organization mismatch.");
      const existing = await db.prepare("SELECT id FROM pipeline_automation_rules WHERE tenant_id = ? AND id = ?").bind(tenantId, data.id).first();
      if (!existing) fail(404, "Automation rule not found.");
      await db.batch([db.prepare("DELETE FROM pipeline_automation_rules WHERE tenant_id = ? AND id = ?").bind(tenantId, data.id), audit(db, tenantId, user.id, "automation.rule_deleted", "pipeline_automation_rule", data.id)]);
      return json({ deleted: true });
    }
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
export const DELETE = respond;
