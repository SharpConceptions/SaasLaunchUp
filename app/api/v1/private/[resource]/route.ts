import { env } from "cloudflare:workers";
import { z } from "zod";
import { equalHex, hashWebsiteKey, tokenId } from "../../../../../lib/api-tokens";
import { canUseResource } from "../../../../../lib/integration-permissions";

type Resource = "contacts" | "companies" | "pipelines" | "stages" | "opportunities" | "tasks" | "automation-rules" | "documents" | "document-templates" | "document-send" | "template-send";
type Token = { id: string; tenant_id: string; scope: string; document_scope: string; permissions_json: string | null; status: string; key_hash: string; expires_at: string; created_by: string };
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
function fail(status: number, message: string): never { throw new ApiError(status, message); }
function db(): D1Database { if (!env.DB) fail(503, "CRM storage is unavailable."); return env.DB; }
const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const nullable = (max: number) => z.string().trim().max(max).optional().nullable();
const companyInput = z.object({ name: text(160), domain: nullable(253) }).strict();
const contactInput = z.object({
  name: text(160), email: z.string().email().max(254).optional().nullable(),
  phone: nullable(40), company_id: uuid.optional().nullable(), source: nullable(160),
}).strict();
const opportunityInput = z.object({
  title: text(240), stage_id: uuid, contact_id: uuid.optional().nullable(),
  company_id: uuid.optional().nullable(), value_cents: z.number().int().min(0).max(100000000000).default(0),
}).strict();
const taskInput = z.object({ title: text(240), contact_id: uuid.optional().nullable(), due_at: z.string().datetime({ offset: true }).optional().nullable() }).strict();
const pipelineInput = z.object({ name: text(120) }).strict();
const stageInput = z.object({ pipeline_id: uuid, name: text(120) }).strict();
const automationInput = z.object({ pipeline_id: uuid, stage_id: uuid.optional().nullable(), name: text(160), trigger_kind: z.enum(["contact_entered_stage", "opportunity_entered_stage", "opportunity_won", "opportunity_lost", "form_submitted", "ad_lead_captured", "awareness_engaged"]), action_kind: z.enum(["email", "sms", "webhook", "call_task"]), config: z.object({ subject: z.string().trim().max(180).optional(), body: z.string().trim().max(5000).optional(), endpoint_url: z.string().url().max(500).optional() }).strict() }).strict();
const changeInput = z.object({ id: uuid, name: text(160).optional(), email: z.string().email().max(254).nullable().optional(), phone: nullable(40), source: nullable(160), domain: nullable(253), company_id: uuid.nullable().optional(), stage_id: uuid.optional(), title: text(240).optional(), body_text: text(20000).optional(), value_cents: z.number().int().min(0).max(100000000000).optional(), status: z.enum(["open", "won", "lost", "completed"]).optional(), due_at: z.string().datetime({ offset: true }).nullable().optional() }).strict();
const deleteInput = z.object({ id: uuid, confirmation: z.literal("delete") }).strict();
const templateInput = z.object({
  name: text(160), kind: z.enum(["document", "contract"]).default("document"),
  title: text(240), body_text: text(20000),
}).strict();
const documentInput = z.object({
  title: text(240), kind: z.enum(["document", "contract"]).default("document"),
  body_text: text(20000), contact_id: uuid.optional().nullable(),
}).strict();
const sendDocumentInput = z.object({ document_id: uuid, contact_ids: z.array(uuid).min(1).max(10) }).strict();
const sendTemplateInput = z.object({ template_id: uuid, contact_ids: z.array(uuid).min(1).max(10) }).strict();
async function authorize(request: Request, access: "read" | "write" | "delete", resourceName: Resource) {
  const match = /^Bearer\s+(ncsk_[A-Za-z0-9_-]+)$/i.exec(request.headers.get("Authorization") || "");
  const key = match?.[1] || "";
  const id = tokenId(key);
  if (!id) fail(401, "A valid private API token is required.");
  const row = await db().prepare("SELECT id, tenant_id, scope, document_scope, permissions_json, status, key_hash, expires_at, created_by FROM api_tokens WHERE id = ?")
    .bind(id).first<Token>();
  if (!row || row.status !== "active" || Date.parse(row.expires_at) <= Date.now() || !equalHex(await hashWebsiteKey(key), row.key_hash)) {
    fail(401, "Invalid or expired private API token.");
  }
  if (row.permissions_json !== null) {
    let permissions: { effective: string[] };
    try { permissions = JSON.parse(row.permissions_json); } catch { fail(403, "Token permissions are invalid."); }
    if (!Array.isArray(permissions?.effective) || !canUseResource(permissions.effective, resourceName, access)) fail(403, "This integration lacks the required permission.");
  } else {
    const documentResource = ["documents", "document-templates", "document-send", "template-send"].includes(resourceName);
    if (documentResource) {
      if (access === "read" && !["read", "manage"].includes(row.document_scope)) fail(403, "This token cannot read documents.");
      if (access !== "read" && row.document_scope !== "manage") fail(403, "This token cannot manage documents.");
      if (access === "write" && request.method === "PATCH" && !["read_write", "read_write_delete"].includes(row.scope)) fail(403, "This token cannot edit documents.");
      if (access === "delete" && row.scope !== "read_write_delete") fail(403, "This token cannot delete documents.");
    } else {
      if (access === "write" && !["read_write", "read_write_delete"].includes(row.scope)) fail(403, "This token has read-only access.");
      if (access === "delete" && row.scope !== "read_write_delete") fail(403, "This token cannot delete records.");
    }
  }
  const membership = await db().prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
    .bind(row.tenant_id, row.created_by).first<{ role: string }>();
  if (membership?.role !== "business_owner") fail(403, "Token owner no longer has company access.");
  await db().prepare("UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
  return row;
}
async function resource(context: { params: Promise<{ resource: string }> }): Promise<Resource> {
  const { resource } = await context.params;
  if (!["contacts", "companies", "pipelines", "stages", "opportunities", "tasks", "automation-rules", "documents", "document-templates", "document-send", "template-send"].includes(resource)) fail(404, "API resource not found.");
  return resource as Resource;
}
async function body(request: Request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) fail(415, "Send JSON data.");
  const raw = await request.text();
  if (raw.length > 16000) fail(413, "Request is too large.");
  try { return JSON.parse(raw) as unknown; } catch { return fail(400, "Invalid JSON."); }
}
function error(cause: unknown) { return cause instanceof ApiError ? reply({ error: cause.message }, cause.status) : reply({ error: "CRM request could not be completed." }, 503); }
const audit = (token: Token, kind: string, type: string, id: string) =>
  db().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), token.tenant_id, token.created_by, kind, type, id, JSON.stringify({ api_token_id: token.id }));
async function recipients(tenantId: string, ids: string[]) {
  if (new Set(ids).size !== ids.length) fail(400, "Choose each contact once.");
  const result: Array<{ id: string; name: string; email: string; company_name: string | null }> = [];
  for (const id of ids) {
    const row = await db().prepare("SELECT c.id, c.name, c.email, co.name AS company_name FROM contacts c LEFT JOIN companies co ON co.id = c.company_id AND co.tenant_id = c.tenant_id WHERE c.tenant_id = ? AND c.id = ?")
      .bind(tenantId, id).first<{ id: string; name: string; email: string | null; company_name: string | null }>();
    if (!row) fail(400, "A selected contact was not found in this workspace.");
    if (!row.email) fail(400, "Every selected contact needs an email address.");
    result.push({ ...row, email: row.email });
  }
  return result;
}
function mergeText(value: string, contact: { name: string; email: string; company_name: string | null }) {
  return value.replace(/{{\s*(contact\.name|contact\.email|company\.name)\s*}}/g, (_match, field: string) =>
    field === "contact.name" ? contact.name : field === "contact.email" ? contact.email : contact.company_name || "");
}
async function checkAutomation(tenantId: string, data: z.infer<typeof automationInput>) {
  if (!(await db().prepare("SELECT id FROM pipelines WHERE tenant_id = ? AND id = ?").bind(tenantId, data.pipeline_id).first())) fail(404, "Pipeline not found.");
  if (["contact_entered_stage", "opportunity_entered_stage"].includes(data.trigger_kind) && !data.stage_id) fail(400, "Choose a trigger stage.");
  if (data.stage_id && !(await db().prepare("SELECT id FROM stages WHERE tenant_id = ? AND pipeline_id = ? AND id = ?").bind(tenantId, data.pipeline_id, data.stage_id).first())) fail(400, "Stage not found in this pipeline.");
  if (data.action_kind === "email" && (!data.config.subject || !data.config.body)) fail(400, "Email drafts need a subject and body.");
  if (["sms", "call_task"].includes(data.action_kind) && !data.config.body) fail(400, "Add a message or task description.");
  if (data.action_kind === "webhook") {
    if (!data.config.endpoint_url) fail(400, "Enter a webhook URL.");
    const endpoint = new URL(data.config.endpoint_url);
    const host = endpoint.hostname.toLowerCase();
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) || !/[a-z]/.test(host.split(".").at(-1) || "") || host.split(".").some(label => label.startsWith("-") || label.endsWith("-")) || [".localhost", ".local", ".internal", ".test", ".example", ".invalid", ".onion", ".lan", ".corp", ".nip.io", ".sslip.io", ".xip.io", ".localtest.me", ".lvh.me"].some(suffix => host.endsWith(suffix))) fail(400, "Use a public HTTPS endpoint without credentials or query parameters.");
  }
}

export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  try {
    const name = await resource(context), token = await authorize(request, "read", name);
    const tenantId = token.tenant_id;
    if (name === "document-send" || name === "template-send") fail(405, "Use POST to prepare a document delivery.");
    if (name === "documents" || name === "document-templates") {
      const id = new URL(request.url).searchParams.get("id");
      if (id && !uuid.safeParse(id).success) fail(400, "Invalid document ID.");
      if (name === "document-templates") {
        if (id) {
          const row = await db().prepare("SELECT id, name, kind, title, body_text, created_at, updated_at FROM document_templates WHERE tenant_id = ? AND id = ?").bind(tenantId, id).first();
          if (!row) fail(404, "Template not found.");
          return reply(row);
        }
        const rows = await db().prepare("SELECT id, name, kind, title, created_at, updated_at FROM document_templates WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100").bind(tenantId).all();
        return reply({ items: rows.results });
      }
      if (id) {
        const row = await db().prepare("SELECT id, template_id, contact_id, kind, title, body_text, status, created_at, updated_at FROM documents WHERE tenant_id = ? AND id = ?").bind(tenantId, id).first();
        if (!row) fail(404, "Document not found.");
        const deliveries = await db().prepare("SELECT id, contact_id, recipient_email, status, created_at, delivered_at FROM document_deliveries WHERE tenant_id = ? AND document_id = ? ORDER BY created_at DESC").bind(tenantId, id).all();
        return reply({ ...row, deliveries: deliveries.results });
      }
      const rows = await db().prepare("SELECT id, template_id, contact_id, kind, title, status, created_at, updated_at FROM documents WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100").bind(tenantId).all();
      return reply({ items: rows.results });
    }
    if (name === "companies") {
      const rows = await db().prepare("SELECT id, name, domain, created_at FROM companies WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100").bind(tenantId).all();
      return reply({ items: rows.results });
    }
    if (name === "contacts") {
      const rows = await db().prepare("SELECT id, name, email, phone, source, company_id, pipeline_id, stage_id, lifecycle_stage, created_at, updated_at FROM contacts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100").bind(tenantId).all();
      return reply({ items: rows.results });
    }
    if (name === "pipelines") {
      const rows = await db().prepare("SELECT p.id AS pipeline_id, p.name AS pipeline_name, s.id AS stage_id, s.name AS stage_name, s.position FROM pipelines p LEFT JOIN stages s ON s.pipeline_id = p.id AND s.tenant_id = p.tenant_id WHERE p.tenant_id = ? ORDER BY p.created_at, s.position").bind(tenantId).all();
      return reply({ items: rows.results });
    }
    if (name === "stages") {
      const rows = await db().prepare("SELECT id, pipeline_id, name, position FROM stages WHERE tenant_id = ? ORDER BY pipeline_id, position LIMIT 100").bind(tenantId).all();
      return reply({ items: rows.results });
    }
    if (name === "automation-rules") {
      const rows = await db().prepare("SELECT id, pipeline_id, stage_id, name, trigger_kind, action_kind, config_json, status, created_at, updated_at FROM pipeline_automation_rules WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 100").bind(tenantId).all();
      return reply({ items: rows.results });
    }
    if (name === "tasks") {
      const rows = await db().prepare("SELECT id, title, contact_id, due_at, status, assignee_user_id, created_at FROM tasks WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100").bind(tenantId).all();
      return reply({ items: rows.results });
    }
    const rows = await db().prepare("SELECT id, title, value_cents, status, stage_id, contact_id, company_id, created_at, updated_at FROM opportunities WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100").bind(tenantId).all();
    return reply({ items: rows.results });
  } catch (cause) { return error(cause); }
}

export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  try {
    const name = await resource(context);
    const token = await authorize(request, "write", name), tenantId = token.tenant_id;
    const raw = await body(request);
    if (name === "pipelines") {
      const parsed = pipelineInput.safeParse(raw);
      if (!parsed.success) fail(400, "Enter a pipeline name.");
      const existing = await db().prepare("SELECT id FROM pipelines WHERE tenant_id = ? AND lower(name) = lower(?)").bind(tenantId, parsed.data.name).first();
      if (existing) fail(409, "A pipeline with this name already exists.");
      const id = crypto.randomUUID(), stageId = crypto.randomUUID();
      await db().batch([
        db().prepare("INSERT INTO pipelines (id, tenant_id, name) VALUES (?, ?, ?)").bind(id, tenantId, parsed.data.name),
        db().prepare("INSERT INTO stages (id, tenant_id, pipeline_id, name, position) VALUES (?, ?, ?, 'New lead', 0)").bind(stageId, tenantId, id),
        audit(token, "pipeline.created_via_api", "pipeline", id),
      ]);
      return reply({ id, stage_id: stageId }, 201);
    }
    if (name === "stages") {
      const parsed = stageInput.safeParse(raw);
      if (!parsed.success) fail(400, "Choose a pipeline and stage name.");
      const data = parsed.data;
      if (!(await db().prepare("SELECT id FROM pipelines WHERE tenant_id = ? AND id = ?").bind(tenantId, data.pipeline_id).first())) fail(404, "Pipeline not found.");
      const duplicate = await db().prepare("SELECT id FROM stages WHERE tenant_id = ? AND pipeline_id = ? AND lower(name) = lower(?)").bind(tenantId, data.pipeline_id, data.name).first();
      if (duplicate) fail(409, "This stage name already exists.");
      const count = await db().prepare("SELECT count(*) AS total, coalesce(max(position), -1) AS last_position FROM stages WHERE tenant_id = ? AND pipeline_id = ?").bind(tenantId, data.pipeline_id).first<{ total: number; last_position: number }>();
      if (Number(count?.total || 0) >= 30) fail(409, "A pipeline can have up to 30 stages.");
      const id = crypto.randomUUID();
      await db().batch([
        db().prepare("INSERT INTO stages (id, tenant_id, pipeline_id, name, position) VALUES (?, ?, ?, ?, ?)").bind(id, tenantId, data.pipeline_id, data.name, Number(count?.last_position ?? -1) + 1),
        audit(token, "stage.created_via_api", "stage", id),
      ]);
      return reply({ id }, 201);
    }
    if (name === "automation-rules") {
      const parsed = automationInput.safeParse(raw);
      if (!parsed.success) fail(400, "Check the automation rule fields.");
      const data = parsed.data;
      await checkAutomation(tenantId, data);
      const id = crypto.randomUUID();
      await db().batch([
        db().prepare("INSERT INTO pipeline_automation_rules (id, tenant_id, pipeline_id, stage_id, name, trigger_kind, action_kind, config_json, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)")
          .bind(id, tenantId, data.pipeline_id, data.stage_id ?? null, data.name, data.trigger_kind, data.action_kind, JSON.stringify(data.config), token.created_by),
        audit(token, "automation_rule.created_via_api", "automation_rule", id),
      ]);
      return reply({ id, status: "draft" }, 201);
    }
    if (name === "document-templates") {
      const parsed = templateInput.safeParse(raw);
      if (!parsed.success) fail(400, "Check the template name, title, and content.");
      const data = parsed.data, id = crypto.randomUUID();
      await db().batch([
        db().prepare("INSERT INTO document_templates (id, tenant_id, name, kind, title, body_text, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(id, tenantId, data.name, data.kind, data.title, data.body_text, token.created_by),
        audit(token, "document_template.created_via_api", "document_template", id),
      ]);
      return reply({ id }, 201);
    }
    if (name === "documents") {
      const parsed = documentInput.safeParse(raw);
      if (!parsed.success) fail(400, "Check the document title and content.");
      const data = parsed.data, id = crypto.randomUUID();
      if (data.contact_id && !(await db().prepare("SELECT id FROM contacts WHERE tenant_id = ? AND id = ?").bind(tenantId, data.contact_id).first())) fail(400, "Contact not found in this workspace.");
      await db().batch([
        db().prepare("INSERT INTO documents (id, tenant_id, contact_id, kind, title, body_text, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(id, tenantId, data.contact_id ?? null, data.kind, data.title, data.body_text, token.created_by),
        audit(token, "document.created_via_api", "document", id),
      ]);
      return reply({ id, status: "draft" }, 201);
    }
    if (name === "document-send") {
      const parsed = sendDocumentInput.safeParse(raw);
      if (!parsed.success) fail(400, "Choose a document and one to ten contacts.");
      const data = parsed.data;
      const document = await db().prepare("SELECT id FROM documents WHERE tenant_id = ? AND id = ?").bind(tenantId, data.document_id).first();
      if (!document) fail(404, "Document not found.");
      const people = await recipients(tenantId, data.contact_ids);
      const deliveryIds = people.map(() => crypto.randomUUID());
      await db().batch([
        ...people.map((person, index) => db().prepare("INSERT INTO document_deliveries (id, tenant_id, document_id, contact_id, recipient_email) VALUES (?, ?, ?, ?, ?)")
          .bind(deliveryIds[index], tenantId, data.document_id, person.id, person.email)),
        db().prepare("UPDATE documents SET status = 'awaiting_email_connection', updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?").bind(tenantId, data.document_id),
        audit(token, "document.delivery_prepared", "document", data.document_id),
      ]);
      return reply({ document_id: data.document_id, delivery_ids: deliveryIds, status: "awaiting_email_connection", sent: false }, 202);
    }
    if (name === "template-send") {
      const parsed = sendTemplateInput.safeParse(raw);
      if (!parsed.success) fail(400, "Choose a template and one to ten contacts.");
      const data = parsed.data;
      const template = await db().prepare("SELECT id, kind, title, body_text FROM document_templates WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, data.template_id).first<{ id: string; kind: string; title: string; body_text: string }>();
      if (!template) fail(404, "Template not found.");
      const people = await recipients(tenantId, data.contact_ids);
      const documentIds = people.map(() => crypto.randomUUID()), deliveryIds = people.map(() => crypto.randomUUID());
      await db().batch(people.flatMap((person, index) => [
        db().prepare("INSERT INTO documents (id, tenant_id, template_id, contact_id, kind, title, body_text, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'awaiting_email_connection', ?)")
          .bind(documentIds[index], tenantId, template.id, person.id, template.kind, mergeText(template.title, person), mergeText(template.body_text, person), token.created_by),
        db().prepare("INSERT INTO document_deliveries (id, tenant_id, document_id, contact_id, recipient_email) VALUES (?, ?, ?, ?, ?)")
          .bind(deliveryIds[index], tenantId, documentIds[index], person.id, person.email),
        audit(token, "document.delivery_prepared", "document", documentIds[index]),
      ]));
      return reply({ document_ids: documentIds, delivery_ids: deliveryIds, status: "awaiting_email_connection", sent: false }, 202);
    }
    if (name === "companies") {
      const parsed = companyInput.safeParse(raw);
      if (!parsed.success) fail(400, "Check the company name and domain.");
      const data = parsed.data, id = crypto.randomUUID();
      await db().batch([
        db().prepare("INSERT INTO companies (id, tenant_id, name, domain, owner_user_id) VALUES (?, ?, ?, ?, ?)").bind(id, tenantId, data.name, data.domain ?? null, token.created_by),
        audit(token, "company.created_via_api", "company", id),
      ]);
      return reply({ id }, 201);
    }
    if (name === "contacts") {
      const parsed = contactInput.safeParse(raw);
      if (!parsed.success) fail(400, "Check the contact fields.");
      const data = parsed.data, id = crypto.randomUUID();
      if (data.company_id && !(await db().prepare("SELECT id FROM companies WHERE tenant_id = ? AND id = ?").bind(tenantId, data.company_id).first())) fail(400, "Company not found in this workspace.");
      const stage = await db().prepare("SELECT s.id, s.pipeline_id, s.name FROM stages s JOIN pipelines p ON p.id = s.pipeline_id AND p.tenant_id = s.tenant_id WHERE s.tenant_id = ? ORDER BY p.created_at, s.position LIMIT 1").bind(tenantId).first<{ id: string; pipeline_id: string; name: string }>();
      await db().batch([
        db().prepare("INSERT INTO contacts (id, tenant_id, company_id, name, email, phone, source, owner_user_id, pipeline_id, stage_id, lifecycle_stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, tenantId, data.company_id ?? null, data.name, data.email ?? null, data.phone ?? null, data.source ?? "Private API", token.created_by, stage?.pipeline_id ?? null, stage?.id ?? null, stage?.name ?? "New lead"),
        audit(token, "contact.created_via_api", "contact", id),
      ]);
      return reply({ id }, 201);
    }
    if (name === "tasks") {
      const parsed = taskInput.safeParse(raw);
      if (!parsed.success) fail(400, "Check the task title, contact, and due date.");
      const data = parsed.data, id = crypto.randomUUID();
      if (data.contact_id && !(await db().prepare("SELECT id FROM contacts WHERE tenant_id = ? AND id = ?").bind(tenantId, data.contact_id).first())) fail(400, "Contact not found in this workspace.");
      await db().batch([
        db().prepare("INSERT INTO tasks (id, tenant_id, contact_id, title, due_at, assignee_user_id) VALUES (?, ?, ?, ?, ?, ?)").bind(id, tenantId, data.contact_id ?? null, data.title, data.due_at ?? null, token.created_by),
        audit(token, "task.created_via_api", "task", id),
      ]);
      return reply({ id }, 201);
    }
    const parsed = opportunityInput.safeParse(raw);
    if (!parsed.success) fail(400, "Check the opportunity fields.");
    const data = parsed.data, id = crypto.randomUUID();
    if (!(await db().prepare("SELECT id FROM stages WHERE tenant_id = ? AND id = ?").bind(tenantId, data.stage_id).first())) fail(400, "Pipeline stage not found in this workspace.");
    if (data.contact_id && !(await db().prepare("SELECT id FROM contacts WHERE tenant_id = ? AND id = ?").bind(tenantId, data.contact_id).first())) fail(400, "Contact not found in this workspace.");
    if (data.company_id && !(await db().prepare("SELECT id FROM companies WHERE tenant_id = ? AND id = ?").bind(tenantId, data.company_id).first())) fail(400, "Company not found in this workspace.");
    const followUpId = data.contact_id ? crypto.randomUUID() : null;
    await db().batch([
      db().prepare("INSERT INTO opportunities (id, tenant_id, contact_id, company_id, stage_id, title, value_cents, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, tenantId, data.contact_id ?? null, data.company_id ?? null, data.stage_id, data.title, data.value_cents, token.created_by),
      ...(followUpId ? [db().prepare("INSERT INTO tasks (id, tenant_id, contact_id, title, due_at, assignee_user_id) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(followUpId, tenantId, data.contact_id, `Follow up: ${data.title}`, new Date(Date.now() + 86400000).toISOString(), token.created_by)] : []),
      audit(token, "opportunity.created_via_api", "opportunity", id),
    ]);
    return reply({ id, follow_up_task_id: followUpId }, 201);
  } catch (cause) { return error(cause); }
}

export async function PATCH(request: Request, context: { params: Promise<{ resource: string }> }) {
  try {
    const name = await resource(context);
    if (["document-send", "template-send"].includes(name)) fail(405, "Delivery requests cannot be edited.");
    const token = await authorize(request, "write", name), tenantId = token.tenant_id;
    const raw = await body(request);
    if (name === "pipelines" || name === "stages") {
      const parsed = pipelineInput.extend({ id: uuid }).safeParse(raw);
      if (!parsed.success) fail(400, "Send an ID and name.");
      const { id, name: newName } = parsed.data;
      const table = name === "pipelines" ? "pipelines" : "stages";
      const existing = await db().prepare(`SELECT id, ${name === "stages" ? "pipeline_id" : "name"} FROM ${table} WHERE tenant_id = ? AND id = ?`).bind(tenantId, id).first<{ id: string; pipeline_id?: string }>();
      if (!existing) fail(404, "Record not found.");
      const duplicate = name === "pipelines"
        ? await db().prepare("SELECT id FROM pipelines WHERE tenant_id = ? AND lower(name) = lower(?) AND id != ?").bind(tenantId, newName, id).first()
        : await db().prepare("SELECT id FROM stages WHERE tenant_id = ? AND pipeline_id = ? AND lower(name) = lower(?) AND id != ?").bind(tenantId, existing.pipeline_id, newName, id).first();
      if (duplicate) fail(409, "This name is already in use.");
      await db().batch([
        db().prepare(`UPDATE ${table} SET name = ? WHERE tenant_id = ? AND id = ?`).bind(newName, tenantId, id),
        ...(name === "stages" ? [db().prepare("UPDATE contacts SET lifecycle_stage = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND stage_id = ?").bind(newName, tenantId, id)] : []),
        audit(token, `${name}.renamed_via_api`, name, id),
      ]);
      return reply({ saved: true, id });
    }
    if (name === "automation-rules") {
      const parsed = automationInput.extend({ id: uuid }).safeParse(raw);
      if (!parsed.success) fail(400, "Check the automation rule fields.");
      const { id, ...data } = parsed.data;
      if (!(await db().prepare("SELECT id FROM pipeline_automation_rules WHERE tenant_id = ? AND id = ?").bind(tenantId, id).first())) fail(404, "Automation rule not found.");
      await checkAutomation(tenantId, data);
      await db().batch([
        db().prepare("UPDATE pipeline_automation_rules SET pipeline_id = ?, stage_id = ?, name = ?, trigger_kind = ?, action_kind = ?, config_json = ?, status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?")
          .bind(data.pipeline_id, data.stage_id ?? null, data.name, data.trigger_kind, data.action_kind, JSON.stringify(data.config), tenantId, id),
        audit(token, "automation_rule.updated_via_api", "automation_rule", id),
      ]);
      return reply({ saved: true, id, status: "draft" });
    }
    const parsed = changeInput.safeParse(raw);
    if (!parsed.success) fail(400, "Check the record ID and changes.");
    const { id, ...changes } = parsed.data;
    const spec: Record<string, { table: string; type: string; fields: string[] }> = {
      contacts: { table: "contacts", type: "contact", fields: ["name", "email", "phone", "source", "company_id", "stage_id"] },
      companies: { table: "companies", type: "company", fields: ["name", "domain"] },
      opportunities: { table: "opportunities", type: "opportunity", fields: ["title", "stage_id", "company_id", "value_cents", "status"] },
      tasks: { table: "tasks", type: "task", fields: ["title", "due_at", "status"] },
      documents: { table: "documents", type: "document", fields: ["title", "body_text"] },
      "document-templates": { table: "document_templates", type: "document_template", fields: ["name", "title", "body_text"] },
    };
    const item = spec[name];
    if (!item) fail(405, "This resource cannot be updated here.");
    const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
    if (!entries.length || entries.some(([field]) => !item.fields.includes(field))) fail(400, "Choose editable fields for this resource.");
    if (name === "tasks" && changes.status && !["open", "completed"].includes(changes.status)) fail(400, "Task status must be open or completed.");
    if (name === "opportunities" && changes.status === "completed") fail(400, "Opportunity status must be open, won, or lost.");
    if (changes.company_id && !(await db().prepare("SELECT id FROM companies WHERE tenant_id = ? AND id = ?").bind(tenantId, changes.company_id).first())) fail(400, "Company not found in this workspace.");
    if (changes.stage_id && !(await db().prepare("SELECT id FROM stages WHERE tenant_id = ? AND id = ?").bind(tenantId, changes.stage_id).first())) fail(400, "Stage not found in this workspace.");
    const existing = await db().prepare(`SELECT id FROM ${item.table} WHERE tenant_id = ? AND id = ?`).bind(tenantId, id).first();
    if (!existing) fail(404, "Record not found.");
    const set = entries.map(([field]) => `${field} = ?`).join(", ");
    const updated = ["contacts", "opportunities", "documents", "document-templates"].includes(name) ? ", updated_at = CURRENT_TIMESTAMP" : "";
    const statements: D1PreparedStatement[] = [
      db().prepare(`UPDATE ${item.table} SET ${set}${updated} WHERE tenant_id = ? AND id = ?`).bind(...entries.map(([, value]) => value), tenantId, id),
    ];
    if (name === "contacts" && changes.stage_id) {
      const stage = await db().prepare("SELECT pipeline_id, name FROM stages WHERE tenant_id = ? AND id = ?").bind(tenantId, changes.stage_id).first<{ pipeline_id: string; name: string }>();
      if (stage) statements.push(db().prepare("UPDATE contacts SET pipeline_id = ?, lifecycle_stage = ? WHERE tenant_id = ? AND id = ?").bind(stage.pipeline_id, stage.name, tenantId, id));
    }
    statements.push(audit(token, `${item.type}.updated_via_api`, item.type, id));
    await db().batch(statements);
    return reply({ saved: true, id });
  } catch (cause) { return error(cause); }
}

export async function DELETE(request: Request, context: { params: Promise<{ resource: string }> }) {
  try {
    const name = await resource(context);
    if (["document-send", "template-send"].includes(name)) fail(405, "Delivery requests cannot be deleted here.");
    const token = await authorize(request, "delete", name), tenantId = token.tenant_id;
    const parsed = deleteInput.safeParse(await body(request));
    if (!parsed.success) fail(400, "Send a record ID and confirmation: delete.");
    const id = parsed.data.id;
    if (name === "pipelines" || name === "stages" || name === "automation-rules") {
      const table = name === "pipelines" ? "pipelines" : name === "stages" ? "stages" : "pipeline_automation_rules";
      if (!(await db().prepare(`SELECT id FROM ${table} WHERE tenant_id = ? AND id = ?`).bind(tenantId, id).first())) fail(404, "Record not found.");
      const statements: D1PreparedStatement[] = [];
      if (name === "pipelines") {
        const total = await db().prepare("SELECT count(*) AS total FROM pipelines WHERE tenant_id = ?").bind(tenantId).first<{ total: number }>();
        if (Number(total?.total || 0) <= 1) fail(409, "Keep at least one pipeline.");
        const refs = await db().prepare("SELECT (SELECT count(*) FROM contacts WHERE tenant_id = ? AND pipeline_id = ?) + (SELECT count(*) FROM opportunities o JOIN stages s ON s.id = o.stage_id WHERE o.tenant_id = ? AND s.pipeline_id = ?) + (SELECT count(*) FROM pipeline_automation_rules WHERE tenant_id = ? AND pipeline_id = ?) + (SELECT count(*) FROM website_connections w JOIN stages s ON s.id = w.stage_id WHERE w.tenant_id = ? AND s.pipeline_id = ?) AS total")
          .bind(tenantId, id, tenantId, id, tenantId, id, tenantId, id).first<{ total: number }>();
        if (Number(refs?.total || 0)) fail(409, "Move linked records, rules, and website routes before deleting this pipeline.");
        statements.push(db().prepare("DELETE FROM stages WHERE tenant_id = ? AND pipeline_id = ?").bind(tenantId, id));
      }
      if (name === "stages") {
        const stage = await db().prepare("SELECT pipeline_id FROM stages WHERE tenant_id = ? AND id = ?").bind(tenantId, id).first<{ pipeline_id: string }>();
        const total = await db().prepare("SELECT count(*) AS total FROM stages WHERE tenant_id = ? AND pipeline_id = ?").bind(tenantId, stage!.pipeline_id).first<{ total: number }>();
        if (Number(total?.total || 0) <= 1) fail(409, "Keep at least one stage in this pipeline.");
        const refs = await db().prepare("SELECT (SELECT count(*) FROM contacts WHERE tenant_id = ? AND stage_id = ?) + (SELECT count(*) FROM opportunities WHERE tenant_id = ? AND stage_id = ?) + (SELECT count(*) FROM pipeline_automation_rules WHERE tenant_id = ? AND stage_id = ?) + (SELECT count(*) FROM website_connections WHERE tenant_id = ? AND stage_id = ?) AS total")
          .bind(tenantId, id, tenantId, id, tenantId, id, tenantId, id).first<{ total: number }>();
        if (Number(refs?.total || 0)) fail(409, "Move linked records, rules, and website routes before deleting this stage.");
      }
      statements.push(db().prepare(`DELETE FROM ${table} WHERE tenant_id = ? AND id = ?`).bind(tenantId, id), audit(token, `${name}.deleted_via_api`, name, id));
      await db().batch(statements);
      return reply({ deleted: true, id });
    }
    const spec: Record<string, { table: string; type: string }> = {
      contacts: { table: "contacts", type: "contact" }, companies: { table: "companies", type: "company" },
      opportunities: { table: "opportunities", type: "opportunity" }, tasks: { table: "tasks", type: "task" },
      documents: { table: "documents", type: "document" }, "document-templates": { table: "document_templates", type: "document_template" },
    };
    const item = spec[name];
    if (!item) fail(405, "This resource cannot be deleted here.");
    if (!(await db().prepare(`SELECT id FROM ${item.table} WHERE tenant_id = ? AND id = ?`).bind(tenantId, id).first())) fail(404, "Record not found.");
    if (name === "companies") {
      const linked = await db().prepare("SELECT (SELECT count(*) FROM contacts WHERE tenant_id = ? AND company_id = ?) + (SELECT count(*) FROM opportunities WHERE tenant_id = ? AND company_id = ?) AS total").bind(tenantId, id, tenantId, id).first<{ total: number }>();
      if (Number(linked?.total || 0)) fail(409, "Move or delete linked contacts and leads before deleting this company.");
    }
    if (name === "document-templates") {
      const linked = await db().prepare("SELECT count(*) AS total FROM documents WHERE tenant_id = ? AND template_id = ?").bind(tenantId, id).first<{ total: number }>();
      if (Number(linked?.total || 0)) fail(409, "Delete documents created from this template first.");
    }
    const statements: D1PreparedStatement[] = [];
    if (name === "contacts") statements.push(
      db().prepare("DELETE FROM website_form_events WHERE tenant_id = ? AND contact_id = ?").bind(tenantId, id),
      db().prepare("UPDATE tasks SET source_note_id = NULL WHERE tenant_id = ? AND source_note_id IN (SELECT id FROM notes WHERE tenant_id = ? AND contact_id = ?)").bind(tenantId, tenantId, id),
      db().prepare("UPDATE tasks SET contact_id = NULL WHERE tenant_id = ? AND contact_id = ?").bind(tenantId, id),
      db().prepare("UPDATE opportunities SET contact_id = NULL WHERE tenant_id = ? AND contact_id = ?").bind(tenantId, id),
      db().prepare("UPDATE documents SET contact_id = NULL WHERE tenant_id = ? AND contact_id = ?").bind(tenantId, id),
      db().prepare("DELETE FROM document_deliveries WHERE tenant_id = ? AND contact_id = ?").bind(tenantId, id),
      db().prepare("DELETE FROM appointment_reminder_jobs WHERE tenant_id = ? AND appointment_id IN (SELECT id FROM appointments WHERE tenant_id = ? AND contact_id = ?)").bind(tenantId, tenantId, id),
      db().prepare("DELETE FROM appointments WHERE tenant_id = ? AND contact_id = ?").bind(tenantId, id),
      ...["notes", "activities", "consent_records", "suppression_records"].map(table => db().prepare(`DELETE FROM ${table} WHERE tenant_id = ? AND contact_id = ?`).bind(tenantId, id)),
    );
    if (name === "opportunities") statements.push(
      db().prepare("UPDATE appointments SET opportunity_id = NULL WHERE tenant_id = ? AND opportunity_id = ?").bind(tenantId, id),
      db().prepare("DELETE FROM website_form_events WHERE tenant_id = ? AND opportunity_id = ?").bind(tenantId, id),
    );
    if (name === "companies") statements.push(db().prepare("DELETE FROM website_form_events WHERE tenant_id = ? AND company_id = ?").bind(tenantId, id));
    if (name === "documents") statements.push(db().prepare("DELETE FROM document_deliveries WHERE tenant_id = ? AND document_id = ?").bind(tenantId, id));
    statements.push(db().prepare(`DELETE FROM ${item.table} WHERE tenant_id = ? AND id = ?`).bind(tenantId, id), audit(token, `${item.type}.deleted_via_api`, item.type, id));
    await db().batch(statements);
    return reply({ deleted: true, id });
  } catch (cause) { return error(cause); }
}
