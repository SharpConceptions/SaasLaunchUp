import { env } from "cloudflare:workers";
import { z } from "zod";
import { getRequestIdentity } from "../../../lib/access-identity";

const kinds = ["email", "board", "media", "blog", "scan"] as const;
const uuid = z.string().uuid();
const saveInput = z.object({
  tenant_id: uuid, id: uuid.optional(), kind: z.enum(kinds),
  title: z.string().trim().min(1).max(180), content: z.record(z.string(), z.unknown()),
}).strict();
function reply(data: unknown, status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store"}})}
async function membership(db:D1Database,tenantId:string,userId:string){
  return db.prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'").bind(tenantId,userId).first<{role:string}>();
}
async function handle(request:Request){
  const userId=(await getRequestIdentity(request.headers))?.userId;
  if(!userId)return reply({error:"Sign in to use Marketing."},401);
  const db=env.DB;
  if(!db)return reply({error:"Marketing storage is unavailable."},503);
  const url=new URL(request.url);
  if(request.method==="GET"){
    const tenantId=url.searchParams.get("tenant_id");
    const kind=url.searchParams.get("kind");
    if(!tenantId||!uuid.safeParse(tenantId).success)return reply({error:"Choose an organization."},400);
    if(kind&&!kinds.includes(kind as typeof kinds[number]))return reply({error:"Unknown marketing section."},400);
    const member=await membership(db,tenantId,userId);
    if(!member||!["business_owner","marketing_manager"].includes(member.role))return reply({error:"Marketing access is required."},403);
    const rows=await db.prepare(`SELECT id, kind, title, content_json, created_by, created_at, updated_at FROM marketing_documents WHERE tenant_id = ?${kind?" AND kind = ?":""} ORDER BY updated_at DESC LIMIT 100`).bind(tenantId,...(kind?[kind]:[])).all();
    return reply({items:rows.results.map(row=>({...row,content:JSON.parse(String(row.content_json)),content_json:undefined}))});
  }
  if(request.method!=="POST")return reply({error:"Method not allowed."},405);
  if(request.headers.get("Origin")!==url.origin)return reply({error:"Request origin was not accepted."},403);
  if(!request.headers.get("Content-Type")?.startsWith("application/json"))return reply({error:"Send JSON data."},415);
  const raw=await request.text();
  if(raw.length>50000)return reply({error:"Marketing draft is too large."},413);
  let data:z.infer<typeof saveInput>;
  try{data=saveInput.parse(JSON.parse(raw))}catch{return reply({error:"Check the title and draft fields."},400)}
  const member=await membership(db,data.tenant_id,userId);
  if(!member||!["business_owner","marketing_manager"].includes(member.role))return reply({error:"Marketing access is required."},403);
  const content=JSON.stringify(data.content);
  if(content.length>40000)return reply({error:"Marketing draft is too large."},413);
  let id=data.id;
  if(id){
    const existing=await db.prepare("SELECT kind FROM marketing_documents WHERE tenant_id = ? AND id = ?").bind(data.tenant_id,id).first<{kind:string}>();
    if(!existing)return reply({error:"Draft not found."},404);
    if(existing.kind!==data.kind)return reply({error:"Draft type cannot be changed."},400);
    await db.batch([
      db.prepare("UPDATE marketing_documents SET title = ?, content_json = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?").bind(data.title,content,data.tenant_id,id),
      db.prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'marketing.updated', 'marketing_document', ?)").bind(crypto.randomUUID(),data.tenant_id,userId,id),
    ]);
  }else{
    id=crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO marketing_documents (id, tenant_id, kind, title, content_json, created_by) VALUES (?, ?, ?, ?, ?, ?)").bind(id,data.tenant_id,data.kind,data.title,content,userId),
      db.prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'marketing.created', 'marketing_document', ?)").bind(crypto.randomUUID(),data.tenant_id,userId,id),
    ]);
  }
  return reply({id,saved:true});
}
export async function GET(request:Request){try{return await handle(request)}catch{return reply({error:"Could not load Marketing."},500)}}
export async function POST(request:Request){try{return await handle(request)}catch{return reply({error:"Could not save Marketing draft."},500)}}
