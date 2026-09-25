import { env } from "cloudflare:workers";
import { z } from "zod";
import { getRequestIdentity } from "../../../lib/access-identity";

const purchaseInput = z.object({
  tenant_id: z.string().uuid(), type: z.literal("purchase"), customer_name: z.string().trim().min(1).max(160),
  product_name: z.string().trim().min(1).max(160), reference: z.string().trim().min(3).max(160),
  amount_cents: z.number().int().min(0).max(100000000000), monthly_amount_cents: z.number().int().min(0).max(100000000000),
  purchased_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();
const feedbackInput = z.object({
  tenant_id: z.string().uuid(), type: z.literal("feedback"), customer_name: z.string().trim().min(1).max(160),
  rating: z.number().int().min(1).max(5), note: z.string().trim().max(1000).optional().nullable(),
  observed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();
const subscriptionInput = z.object({ tenant_id: z.string().uuid(), type: z.literal("subscription"), id: z.string().uuid(), status: z.enum(["active", "cancelled"]) }).strict();
function reply(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
function database(): D1Database { if (!env.DB) throw new Error("CRM storage is unavailable."); return env.DB; }
async function authorize(request: Request, tenantId: string) {
  const userId = (await getRequestIdentity(request.headers))?.userId;
  if (!userId) return { error: reply({ error: "Sign in to continue." }, 401) };
  if (!z.string().uuid().safeParse(tenantId).success) return { error: reply({ error: "Choose an organization." }, 400) };
  if (!env.DB) return { error: reply({ error: "CRM storage is unavailable." }, 503) };
  const member = await database().prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'").bind(tenantId, userId).first<{ role: string }>();
  if (member?.role !== "business_owner") return { error: reply({ error: "Admin access is required." }, 403) };
  return { userId };
}
function validateMutation(request: Request) {
  return request.headers.get("Origin") === new URL(request.url).origin && request.headers.get("Content-Type")?.startsWith("application/json");
}
export async function GET(request: Request) {
  const tenantId = new URL(request.url).searchParams.get("tenant_id") || "";
  const auth = await authorize(request, tenantId); if (auth.error) return auth.error;
  const [purchases, feedback] = await Promise.all([
    database().prepare("SELECT id, customer_name, product_name, reference, amount_cents, monthly_amount_cents, subscription_status, purchased_at FROM purchase_records WHERE tenant_id = ? ORDER BY purchased_at DESC LIMIT 500").bind(tenantId).all(),
    database().prepare("SELECT id, customer_name, rating, note, observed_at FROM customer_feedback WHERE tenant_id = ? ORDER BY observed_at DESC LIMIT 500").bind(tenantId).all(),
  ]);
  return reply({ purchases: purchases.results, feedback: feedback.results, purchaseLimited: purchases.results.length === 500, feedbackLimited: feedback.results.length === 500 });
}
export async function POST(request: Request) {
  if (!validateMutation(request)) return reply({ error: "Request origin or format was not accepted." }, 403);
  let raw: unknown;try { const text = await request.text(); if (text.length > 5000) return reply({ error: "Request is too large." }, 413); raw = JSON.parse(text); } catch { return reply({ error: "Invalid JSON." }, 400); }
  const tenantId = typeof raw === "object" && raw !== null && "tenant_id" in raw ? String(raw.tenant_id) : "";
  const auth = await authorize(request, tenantId); if (auth.error) return auth.error;
  if (typeof raw !== "object" || raw === null || !("type" in raw)) return reply({ error: "Choose a record type." }, 400);
  const id = crypto.randomUUID();
  if (raw.type === "purchase") {
    const parsed = purchaseInput.safeParse(raw); if (!parsed.success) return reply({ error: "Check the purchase fields." }, 400);
    const data = parsed.data;
    const existing = await database().prepare("SELECT id FROM purchase_records WHERE tenant_id = ? AND reference = ?").bind(tenantId, data.reference).first();
    if (existing) return reply({ error: "That order reference is already recorded." }, 409);
    await database().batch([
      database().prepare("INSERT INTO purchase_records (id, tenant_id, customer_name, product_name, reference, amount_cents, monthly_amount_cents, subscription_status, purchased_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, tenantId, data.customer_name, data.product_name, data.reference, data.amount_cents, data.monthly_amount_cents, data.monthly_amount_cents > 0 ? "active" : "none", data.purchased_at),
      database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'purchase.recorded', 'purchase', ?)").bind(crypto.randomUUID(), tenantId, auth.userId, id),
    ]);
    return reply({ id }, 201);
  }
  if (raw.type === "feedback") {
    const parsed = feedbackInput.safeParse(raw); if (!parsed.success) return reply({ error: "Check the feedback fields." }, 400);
    const data = parsed.data;
    await database().batch([
      database().prepare("INSERT INTO customer_feedback (id, tenant_id, customer_name, rating, note, observed_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, tenantId, data.customer_name, data.rating, data.note || null, data.observed_at),
      database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'feedback.recorded', 'customer_feedback', ?)").bind(crypto.randomUUID(), tenantId, auth.userId, id),
    ]);
    return reply({ id }, 201);
  }
  return reply({ error: "Choose a supported record type." }, 400);
}
export async function PATCH(request: Request) {
  if (!validateMutation(request)) return reply({ error: "Request origin or format was not accepted." }, 403);
  let raw: unknown;try { raw = JSON.parse(await request.text()); } catch { return reply({ error: "Invalid JSON." }, 400); }
  const parsed = subscriptionInput.safeParse(raw); if (!parsed.success) return reply({ error: "Check the subscription fields." }, 400);
  const data = parsed.data, auth = await authorize(request, data.tenant_id); if (auth.error) return auth.error;
  const record = await database().prepare("SELECT id, monthly_amount_cents FROM purchase_records WHERE tenant_id = ? AND id = ?").bind(data.tenant_id, data.id).first<{ id: string; monthly_amount_cents: number }>();
  if (!record || record.monthly_amount_cents <= 0) return reply({ error: "Subscription not found." }, 404);
  await database().batch([
    database().prepare("UPDATE purchase_records SET subscription_status = ? WHERE tenant_id = ? AND id = ?").bind(data.status, data.tenant_id, data.id),
    database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'subscription.updated', 'purchase', ?)").bind(crypto.randomUUID(), data.tenant_id, auth.userId, data.id),
  ]);
  return reply({ saved: true });
}
