import { env } from "cloudflare:workers";
import { getRequestIdentity } from "../../../lib/access-identity";

export async function GET(request: Request) {
  const userId = (await getRequestIdentity(request.headers))?.userId;
  if (!userId) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const tenantId = new URL(request.url).searchParams.get("tenant_id");
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) return Response.json({ error: "Choose an organization." }, { status: 400 });
  if (!env.DB) return Response.json({ error: "CRM storage is unavailable." }, { status: 503 });
  const member = await env.DB.prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'").bind(tenantId, userId).first<{ role: string }>();
  if (!member || !["business_owner", "sales_manager", "marketing_manager"].includes(member.role)) return Response.json({ error: "Manager access is required." }, { status: 403 });
  const [opportunities, stages, contacts, sources, tasks] = await Promise.all([
    env.DB.prepare("SELECT o.id, o.title, o.value_cents, o.status, o.stage_id, o.contact_id, o.company_id, o.created_at, o.updated_at, o.closed_at, o.deal_type, o.outcome_reason, s.name AS stage, COALESCE(u.display_name, u.email, 'Team member') AS owner, COALESCE(c.name, o.title) AS company, COALESCE(ct.source, 'Unattributed') AS source FROM opportunities o JOIN stages s ON s.id = o.stage_id AND s.tenant_id = o.tenant_id LEFT JOIN users u ON u.id = o.owner_user_id LEFT JOIN companies c ON c.id = o.company_id AND c.tenant_id = o.tenant_id LEFT JOIN contacts ct ON ct.id = o.contact_id AND ct.tenant_id = o.tenant_id WHERE o.tenant_id = ? ORDER BY o.updated_at DESC LIMIT 1000").bind(tenantId).all(),
    env.DB.prepare("SELECT s.id, s.name, s.position, p.id AS pipeline_id, p.name AS pipeline_name FROM stages s JOIN pipelines p ON p.id = s.pipeline_id AND p.tenant_id = s.tenant_id WHERE s.tenant_id = ? ORDER BY p.created_at, s.position LIMIT 100").bind(tenantId).all(),
    env.DB.prepare("SELECT lifecycle_stage AS stage, COUNT(*) AS count FROM contacts WHERE tenant_id = ? GROUP BY lifecycle_stage").bind(tenantId).all(),
    env.DB.prepare("SELECT COALESCE(NULLIF(source, ''), 'Unattributed') AS source, COUNT(*) AS count FROM contacts WHERE tenant_id = ? GROUP BY COALESCE(NULLIF(source, ''), 'Unattributed') ORDER BY count DESC LIMIT 30").bind(tenantId).all(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM tasks WHERE tenant_id = ? AND status = 'open'").bind(tenantId).first<{ count: number }>(),
  ]);
  return Response.json({ opportunities: opportunities.results, stages: stages.results, contacts: contacts.results, contactSources: sources.results, openTasks: tasks?.count ?? 0, limited: opportunities.results.length === 1000 }, { headers: { "Cache-Control": "no-store" } });
}
