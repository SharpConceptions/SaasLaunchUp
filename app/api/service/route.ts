import { env } from "cloudflare:workers";
import { z } from "zod";
import { getRequestIdentity } from "../../../lib/access-identity";

const uuid = z.string().uuid();
const kind = z.enum(["customer", "billing", "bug", "cancellation"]);
const createInput = z.object({
  tenant_id: uuid, kind, title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(5).max(5000), customer_name: z.string().trim().max(160).optional(),
  customer_email: z.union([z.string().email().max(254), z.literal("")]).optional(),
  subscription_reference: z.string().trim().max(160).optional(),
  requested_effective_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/),z.literal("")]).optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
}).strict().superRefine((data,ctx)=>{
  if(data.kind==="cancellation"){
    if(!data.customer_name)ctx.addIssue({code:z.ZodIssueCode.custom,path:["customer_name"],message:"Customer name is required."});
    if(!data.customer_email)ctx.addIssue({code:z.ZodIssueCode.custom,path:["customer_email"],message:"Customer email is required."});
    if(!data.subscription_reference)ctx.addIssue({code:z.ZodIssueCode.custom,path:["subscription_reference"],message:"Subscription or account reference is required."});
  }
});
const updateInput = z.object({tenant_id: uuid, id: uuid, status: z.enum(["open", "in_progress", "resolved"])}).strict();
function reply(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
function database():D1Database { if(!env.DB)throw new Error("Customer service storage is unavailable.");return env.DB; }
async function authorize(request: Request, tenantId: string, write = false) {
  const userId = (await getRequestIdentity(request.headers))?.userId;
  if (!userId) return { error: reply({error:"Sign in to continue."}, 401) };
  if (!uuid.safeParse(tenantId).success) return { error: reply({error:"Choose an organization."}, 400) };
  if (!env.DB) return { error: reply({error:"Customer service storage is unavailable."}, 503) };
  const member = await env.DB.prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'").bind(tenantId,userId).first<{role:string}>();
  const allowed = write ? ["business_owner","sales_manager"] : ["business_owner","sales_manager","support_readonly"];
  if (!member || !allowed.includes(member.role)) return { error: reply({error:"Customer service access is required."}, 403) };
  return { userId };
}
async function mutation(request:Request, schema:typeof createInput | typeof updateInput) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) return {error:reply({error:"Request origin was not accepted."},403)};
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return {error:reply({error:"Send JSON data."},415)};
  const raw = await request.text();
  if (raw.length > 7000) return {error:reply({error:"Report is too large."},413)};
  try { const parsed = schema.safeParse(JSON.parse(raw)); if (!parsed.success) return {error:reply({error:"Check the report fields."},400)}; return {data:parsed.data}; }
  catch { return {error:reply({error:"Invalid JSON."},400)}; }
}
export async function GET(request:Request) {
  try {
    const url = new URL(request.url), tenantId = url.searchParams.get("tenant_id") || "";
    const auth = await authorize(request,tenantId); if (auth.error) return auth.error;
    const filter = url.searchParams.get("kind");
    if (filter && !kind.safeParse(filter).success) return reply({error:"Unknown ticket type."},400);
    const rows = await database().prepare(`SELECT id, kind, title, description, customer_name, customer_email, subscription_reference, requested_effective_date, priority, status, created_at, updated_at FROM service_tickets WHERE tenant_id = ?${filter?" AND kind = ?":""} ORDER BY updated_at DESC LIMIT 200`).bind(tenantId,...(filter?[filter]:[])).all();
    return reply({items:rows.results, limited:rows.results.length===200});
  } catch { return reply({error:"Could not load customer service tickets."},500); }
}
export async function POST(request:Request) {
  try {
    const parsed=await mutation(request,createInput); if(parsed.error)return parsed.error;
    const data=parsed.data as z.infer<typeof createInput>,auth=await authorize(request,data.tenant_id,true);if(auth.error)return auth.error;
    const id=crypto.randomUUID();
    await database().batch([
      database().prepare("INSERT INTO service_tickets (id, tenant_id, kind, title, description, customer_name, customer_email, subscription_reference, requested_effective_date, priority, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)").bind(id,data.tenant_id,data.kind,data.title,data.description,data.customer_name||null,data.customer_email||null,data.subscription_reference||null,data.requested_effective_date||null,data.priority,auth.userId),
      database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'service_ticket.created', 'service_ticket', ?)").bind(crypto.randomUUID(),data.tenant_id,auth.userId,id),
    ]);
    return reply({id,saved:true},201);
  } catch { return reply({error:"Could not save the report."},500); }
}
export async function PATCH(request:Request) {
  try {
    const parsed=await mutation(request,updateInput);if(parsed.error)return parsed.error;
    const data=parsed.data as z.infer<typeof updateInput>,auth=await authorize(request,data.tenant_id,true);if(auth.error)return auth.error;
    const existing=await database().prepare("SELECT id FROM service_tickets WHERE tenant_id = ? AND id = ?").bind(data.tenant_id,data.id).first();
    if(!existing)return reply({error:"Ticket not found."},404);
    await database().batch([
      database().prepare("UPDATE service_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?").bind(data.status,data.tenant_id,data.id),
      database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'service_ticket.status_updated', 'service_ticket', ?)").bind(crypto.randomUUID(),data.tenant_id,auth.userId,data.id),
    ]);
    return reply({saved:true});
  } catch { return reply({error:"Could not update the ticket."},500); }
}
