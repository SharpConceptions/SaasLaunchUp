import { env } from "cloudflare:workers";
import { z } from "zod";
import { getRequestIdentity } from "../../../lib/access-identity";

const uuid = z.string().uuid();
const input = z.object({
  tenant_id: uuid,
  partner_name: z.string().trim().min(1).max(160),
  country: z.string().regex(/^[A-Z]{2}$/),
  region: z.string().trim().max(100).optional().nullable(),
  number_type: z.enum(["local", "toll_free"]),
  capabilities: z.enum(["voice", "sms", "voice_sms"]),
  notes: z.string().trim().max(1000).optional().nullable(),
}).strict();
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const database = () => env.DB as D1Database;

async function authorize(request: Request, tenantId: string) {
  if (!uuid.safeParse(tenantId).success) return { error: reply({ error: "Choose a company." }, 400) };
  const userId = (await getRequestIdentity(request.headers))?.userId;
  if (!userId) return { error: reply({ error: "Sign in to continue." }, 401) };
  if (!env.DB) return { error: reply({ error: "Request storage is unavailable." }, 503) };
  const member = await database().prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
    .bind(tenantId, userId).first<{ role: string }>();
  if (member?.role !== "business_owner") return { error: reply({ error: "Company owner access is required." }, 403) };
  return { userId };
}

export async function GET(request: Request) {
  const tenantId = new URL(request.url).searchParams.get("tenant_id") || "";
  const auth = await authorize(request, tenantId);
  if (auth.error) return auth.error;
  try {
    const rows = await database().prepare("SELECT id, partner_name, country, region, number_type, capabilities, notes, status, created_at FROM phone_number_requests WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100")
      .bind(tenantId).all();
    return reply({ items: rows.results });
  } catch { return reply({ error: "Could not load number requests." }, 503); }
}

export async function POST(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin || !request.headers.get("Content-Type")?.startsWith("application/json"))
    return reply({ error: "Request origin or format was not accepted." }, 403);
  let raw: unknown;
  try {
    const value = await request.text();
    if (value.length > 2500) return reply({ error: "Request is too large." }, 413);
    raw = JSON.parse(value);
  } catch { return reply({ error: "Invalid request." }, 400); }
  const parsed = input.safeParse(raw);
  if (!parsed.success) return reply({ error: "Check the number request details." }, 400);
  const data = parsed.data;
  const auth = await authorize(request, data.tenant_id);
  if (auth.error) return auth.error;
  const id = crypto.randomUUID();
  try {
    await database().batch([
      database().prepare("INSERT INTO phone_number_requests (id, tenant_id, partner_name, country, region, number_type, capabilities, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, data.tenant_id, data.partner_name, data.country, data.region || null, data.number_type, data.capabilities, data.notes || null, auth.userId),
      database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'phone_number_request.recorded', 'phone_number_request', ?)")
        .bind(crypto.randomUUID(), data.tenant_id, auth.userId, id),
    ]);
    return reply({ id, status: "recorded_for_partner_review" }, 201);
  } catch { return reply({ error: "Could not save the number request." }, 503); }
}
