import { env } from "cloudflare:workers";
import { z } from "zod";
import { equalHex, hashWebsiteKey, type FieldMapping } from "../../../../../lib/website-forms";

type Site = {
  id: string; tenant_id: string; name: string; stage_id: string; owner_user_id: string;
  mapping_json: string; key_hash: string; status: string;
};
type Stage = { id: string; name: string; pipeline_id: string };
type Contact = { id: string; company_id: string | null; owner_user_id: string };
type Company = { id: string };
type Opportunity = { id: string };
class IntakeError extends Error { constructor(public status: number, message: string) { super(message); } }
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
function fail(status: number, message: string): never { throw new IntakeError(status, message); }
function database(): D1Database { const db = env.DB; if (!db) fail(503, "Form intake is unavailable."); return db; }

async function readLimited(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) fail(400, "Send form data.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32768) { await reader.cancel(); fail(413, "Form data is too large."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function formFields(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("Content-Type") || "";
  const bytes = await readLimited(request);
  let raw: unknown;
  try {
    if (contentType.startsWith("application/json")) raw = JSON.parse(new TextDecoder().decode(bytes));
    else if (contentType.startsWith("application/x-www-form-urlencoded")) raw = Object.fromEntries(new URLSearchParams(new TextDecoder().decode(bytes)));
    else if (contentType.startsWith("multipart/form-data")) {
      const parsed = await new Request(request.url, { method: "POST", headers: { "Content-Type": contentType }, body: bytes }).formData();
      raw = Object.fromEntries(Array.from(parsed.entries()).filter(([, value]) => typeof value === "string"));
    } else fail(415, "Send JSON or form data.");
  } catch { fail(400, "Could not read the form data."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(400, "Send a form object.");
  const outer = raw as Record<string, unknown>;
  const nested = outer.data ?? outer.fields;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return { ...outer, ...nested as Record<string, unknown> };
  if (Array.isArray(nested)) {
    const pairs = nested.filter(value => value && typeof value === "object" && typeof value.name === "string")
      .map(value => [value.name, value.value] as [string, unknown]);
    return { ...outer, ...Object.fromEntries(pairs) };
  }
  return outer;
}

function field(fields: Record<string, unknown>, mapped: string | undefined, aliases: string[], max: number) {
  const values = new Map(Object.entries(fields).map(([name, value]) => [name.toLowerCase(), value]));
  for (const name of [mapped, ...aliases]) {
    if (!name) continue;
    const value = values.get(name.toLowerCase());
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text.length > max) fail(400, `${name} is too long.`);
      if (text) return text;
    }
  }
  return "";
}

function domainValue(value: string) {
  if (!value) return "";
  const normalized = value.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  if (normalized.length > 253 || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(normalized)) fail(400, "Enter a valid company domain.");
  return normalized;
}

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await context.params;
    if (!z.string().uuid().safeParse(siteId).success) fail(401, "Invalid website key.");
    const url = new URL(request.url);
    const authorization = request.headers.get("Authorization") || "";
    const key = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : url.searchParams.get("key") || "";
    if (!/^nc_live_[A-Za-z0-9_-]{43}$/.test(key)) fail(401, "Invalid website key.");
    const site = await database().prepare("SELECT id, tenant_id, name, stage_id, owner_user_id, mapping_json, key_hash, status FROM website_connections WHERE id = ?")
      .bind(siteId).first<Site>();
    if (!site || site.status !== "active" || !equalHex(await hashWebsiteKey(key), site.key_hash)) fail(401, "Invalid website key.");
    const [stage, assignee] = await Promise.all([
      database().prepare("SELECT id, name, pipeline_id FROM stages WHERE tenant_id = ? AND id = ?").bind(site.tenant_id, site.stage_id).first<Stage>(),
      database().prepare("SELECT user_id FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active' AND role IN ('business_owner','sales_manager','sales_representative')")
        .bind(site.tenant_id, site.owner_user_id).first(),
    ]);
    if (!stage || !assignee) fail(409, "Website routing needs an active stage and sales owner.");
    const fields = await formFields(request);
    const mapping = JSON.parse(site.mapping_json || "{}") as FieldMapping;
    const first = field(fields, undefined, ["first_name", "firstname"], 80);
    const last = field(fields, undefined, ["last_name", "lastname"], 80);
    const name = field(fields, mapping.name, ["name", "full_name", "fullName", "contact_name"], 160) || `${first} ${last}`.trim();
    const email = field(fields, mapping.email, ["email", "email_address", "Email"], 254).toLowerCase();
    const phone = field(fields, mapping.phone, ["phone", "phone_number", "mobile", "tel"], 40);
    const companyName = field(fields, mapping.company, ["company", "company_name", "organization", "business_name"], 160);
    const domain = domainValue(field(fields, mapping.domain, ["domain", "company_domain", "website"], 300));
    const source = field(fields, mapping.source, ["source", "lead_source", "utm_source"], 160) || `Website form: ${site.name}`;
    const message = field(fields, mapping.message, ["message", "comments", "notes", "inquiry"], 2000);
    const idempotencyKey = (request.headers.get("Idempotency-Key") || field(fields, mapping.submission_id, ["submission_id", "entry_id", "form_submission_id"], 120)).trim();
    if (!name || (!email && !phone)) fail(400, "Send a contact name and email or phone number.");
    if (email && !z.string().email().safeParse(email).success) fail(400, "Enter a valid email address.");
    if (idempotencyKey.length > 120) fail(400, "Submission ID is too long.");
    if (idempotencyKey) {
      const prior = await database().prepare("SELECT contact_id, company_id, opportunity_id FROM website_form_events WHERE site_id = ? AND idempotency_key = ?")
        .bind(siteId, idempotencyKey).first<{ contact_id: string; company_id: string | null; opportunity_id: string }>();
      if (prior) return reply({ duplicate: true, contact_id: prior.contact_id, company_id: prior.company_id, lead_id: prior.opportunity_id });
    }
    const recent = await database().prepare("SELECT count(*) AS total FROM website_form_events WHERE site_id = ? AND created_at >= datetime('now', '-1 minute')")
      .bind(siteId).first<{ total: number }>();
    if (Number(recent?.total || 0) >= 120) fail(429, "Too many form submissions. Try again shortly.");
    const tenantId = site.tenant_id;
    const company = domain
      ? await database().prepare("SELECT id FROM companies WHERE tenant_id = ? AND lower(domain) = ? LIMIT 1").bind(tenantId, domain).first<Company>()
      : companyName ? await database().prepare("SELECT id FROM companies WHERE tenant_id = ? AND lower(name) = lower(?) LIMIT 1").bind(tenantId, companyName).first<Company>() : null;
    const companyId = company?.id || (companyName || domain ? crypto.randomUUID() : null);
    const contact = email
      ? await database().prepare("SELECT id, company_id, owner_user_id FROM contacts WHERE tenant_id = ? AND lower(email) = ? ORDER BY created_at LIMIT 1").bind(tenantId, email).first<Contact>()
      : await database().prepare("SELECT id, company_id, owner_user_id FROM contacts WHERE tenant_id = ? AND phone = ? ORDER BY created_at LIMIT 1").bind(tenantId, phone).first<Contact>();
    const contactId = contact?.id || crypto.randomUUID();
    const actualCompanyId = contact?.company_id || companyId;
    const lead = contact
      ? await database().prepare("SELECT o.id FROM opportunities o JOIN stages s ON s.id = o.stage_id AND s.tenant_id = o.tenant_id WHERE o.tenant_id = ? AND o.contact_id = ? AND o.status = 'open' AND s.pipeline_id = ? ORDER BY o.created_at DESC LIMIT 1")
        .bind(tenantId, contactId, stage.pipeline_id).first<Opportunity>() : null;
    const leadId = lead?.id || crypto.randomUUID();
    const followUpId = crypto.randomUUID();
    const followUpDueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const statements: D1PreparedStatement[] = [];
    if (companyId && !company && !contact?.company_id) statements.push(database().prepare("INSERT INTO companies (id, tenant_id, name, domain, owner_user_id) VALUES (?, ?, ?, ?, ?)")
      .bind(companyId, tenantId, companyName || domain, domain || null, site.owner_user_id));
    if (!contact) statements.push(database().prepare("INSERT INTO contacts (id, tenant_id, company_id, name, email, phone, source, lifecycle_stage, pipeline_id, stage_id, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(contactId, tenantId, actualCompanyId, name, email || null, phone || null, source, stage.name, stage.pipeline_id, stage.id, site.owner_user_id));
    else statements.push(database().prepare("UPDATE contacts SET company_id = coalesce(company_id, ?), phone = coalesce(phone, ?), email = coalesce(email, ?), updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?")
      .bind(actualCompanyId, phone || null, email || null, tenantId, contactId));
    if (!lead) statements.push(database().prepare("INSERT INTO opportunities (id, tenant_id, contact_id, company_id, stage_id, title, value_cents, status, owner_user_id, deal_type) VALUES (?, ?, ?, ?, ?, ?, 0, 'open', ?, 'Website lead')")
      .bind(leadId, tenantId, contactId, actualCompanyId, stage.id, `${companyName || name} — Website lead`, contact?.owner_user_id || site.owner_user_id));
    statements.push(database().prepare("INSERT INTO website_form_events (id, tenant_id, site_id, idempotency_key, contact_id, company_id, opportunity_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), tenantId, siteId, idempotencyKey || null, contactId, actualCompanyId, leadId));
    statements.push(database().prepare("INSERT INTO activities (id, tenant_id, contact_id, kind, summary) VALUES (?, ?, ?, 'website_form', ?)")
      .bind(crypto.randomUUID(), tenantId, contactId, `Submitted ${site.name} form`));
    if (!lead) statements.push(database().prepare("INSERT INTO tasks (id, tenant_id, contact_id, title, due_at, assignee_user_id) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(followUpId, tenantId, contactId, `Follow up: ${name} (${source})`, followUpDueAt, contact?.owner_user_id || site.owner_user_id));
    if (message) statements.push(database().prepare("INSERT INTO notes (id, tenant_id, contact_id, body, created_by) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), tenantId, contactId, `Website form message: ${message}`, contact?.owner_user_id || site.owner_user_id));
    statements.push(database().prepare("UPDATE website_connections SET last_received_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?")
      .bind(siteId, tenantId));
    try { await database().batch(statements); }
    catch (error) {
      if (idempotencyKey) {
        const prior = await database().prepare("SELECT contact_id, company_id, opportunity_id FROM website_form_events WHERE site_id = ? AND idempotency_key = ?")
          .bind(siteId, idempotencyKey).first<{ contact_id: string; company_id: string | null; opportunity_id: string }>();
        if (prior) return reply({ duplicate: true, contact_id: prior.contact_id, company_id: prior.company_id, lead_id: prior.opportunity_id });
      }
      throw error;
    }
    return reply({ created: true, contact_id: contactId, company_id: actualCompanyId, lead_id: leadId, follow_up_task_id: lead ? null : followUpId, contact_existing: Boolean(contact), lead_existing: Boolean(lead) }, 201);
  } catch (error) {
    return error instanceof IntakeError ? reply({ error: error.message }, error.status) : reply({ error: "Could not accept this form submission." }, 503);
  }
}
