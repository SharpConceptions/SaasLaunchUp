import { env } from "cloudflare:workers";
import { z } from "zod";
import { getRequestIdentity } from "../../../lib/access-identity";

const input = z.object({
  company_name: z.string().trim().min(1).max(160), legal_name: z.string().trim().max(160).optional(),
  primary_domain: z.string().trim().max(253).optional(), timezone: z.string().trim().min(1).max(100),
  industry: z.string().trim().min(1).max(120), team_size: z.enum(["solo", "2-10", "11-50", "51-200", "201+"]),
  phone: z.string().trim().max(40).optional(), website: z.string().trim().max(253).optional(),
  goals: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
}).strict();

function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }

export async function GET(request: Request) {
  const identity = await getRequestIdentity(request.headers);
  if (!identity || !env.DB) return json({ error: "Sign in to continue." }, 401);
  const row = await env.DB.prepare("SELECT o.id AS tenant_id, o.name AS company_name, o.legal_name, o.primary_domain, o.timezone, p.industry, p.team_size, p.goals_json, p.phone, p.website, p.completed_at FROM organizations o JOIN memberships m ON m.tenant_id = o.id LEFT JOIN onboarding_profiles p ON p.tenant_id = o.id WHERE m.user_id = ? AND m.role = 'business_owner' ORDER BY o.created_at DESC LIMIT 1").bind(identity.userId).first<Record<string, unknown>>();
  return json({ onboarding: row || null });
}

export async function POST(request: Request) {
  const identity = await getRequestIdentity(request.headers);
  if (!identity || !env.DB) return json({ error: "Sign in to continue." }, 401);
  let data: z.infer<typeof input>;
  try { data = input.parse(await request.json()); } catch { return json({ error: "Complete each onboarding field before continuing." }, 400); }
  const org = await env.DB.prepare("SELECT o.id FROM organizations o JOIN memberships m ON m.tenant_id = o.id WHERE m.user_id = ? AND m.role = 'business_owner' ORDER BY o.created_at DESC LIMIT 1").bind(identity.userId).first<{ id: string }>();
  if (!org) return json({ error: "Create your account before onboarding." }, 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE organizations SET name = ?, legal_name = ?, primary_domain = ?, timezone = ? WHERE id = ?").bind(data.company_name, data.legal_name || null, data.primary_domain || null, data.timezone, org.id),
    env.DB.prepare("INSERT INTO onboarding_profiles (tenant_id, industry, team_size, goals_json, phone, website, completed_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(tenant_id) DO UPDATE SET industry = excluded.industry, team_size = excluded.team_size, goals_json = excluded.goals_json, phone = excluded.phone, website = excluded.website, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP").bind(org.id, data.industry, data.team_size, JSON.stringify(data.goals), data.phone || null, data.website || null),
  ]);
  return json({ ok: true, redirect: "/workspace.html" });
}