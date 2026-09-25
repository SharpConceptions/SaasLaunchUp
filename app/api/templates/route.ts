import { env } from "cloudflare:workers";
import { z } from "zod";
import { getRequestIdentity } from "../../../lib/access-identity";

const uuid=z.string().uuid();
const channel=z.enum(["sms","email"]);
const saveInput=z.object({tenant_id:uuid,id:uuid.optional(),channel,name:z.string().trim().min(1).max(160),subject:z.string().trim().max(180).optional(),body:z.string().trim().min(1).max(5000)}).strict();
const deleteInput=z.object({tenant_id:uuid,id:uuid,confirmation:z.literal("delete")}).strict();
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
function database():D1Database{if(!env.DB)throw new Error("Template storage is unavailable.");return env.DB}
async function member(request:Request,tenantId:string){
  const userId=(await getRequestIdentity(request.headers))?.userId;
  if(!userId)return {error:response({error:"Sign in to continue."},401)};
  if(!uuid.safeParse(tenantId).success)return {error:response({error:"Choose an organization."},400)};
  if(!env.DB)return {error:response({error:"Template storage is unavailable."},503)};
  const row=await database().prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'").bind(tenantId,userId).first<{role:string}>();
  if(!row||!["business_owner","sales_manager","sales_representative","marketing_manager"].includes(row.role))return {error:response({error:"Template access is required."},403)};
  return {userId,role:row.role};
}
function canEdit(role:string,kind:string){return kind==="sms"?["business_owner","sales_manager","sales_representative"].includes(role):["business_owner","marketing_manager"].includes(role)}
async function mutation(request:Request,max=7000){
  if(request.headers.get("Origin")!==new URL(request.url).origin)return {error:response({error:"Request origin was not accepted."},403)};
  if(!request.headers.get("Content-Type")?.startsWith("application/json"))return {error:response({error:"Send JSON data."},415)};
  const raw=await request.text();if(raw.length>max)return {error:response({error:"Template is too large."},413)};
  try{return {data:JSON.parse(raw) as unknown}}catch{return {error:response({error:"Invalid JSON."},400)}}
}
export async function GET(request:Request){
  try{
    const url=new URL(request.url),tenantId=url.searchParams.get("tenant_id")||"",auth=await member(request,tenantId);if(auth.error)return auth.error;
    const filter=url.searchParams.get("channel");if(filter&&!channel.safeParse(filter).success)return response({error:"Unknown channel."},400);
    const allowed=auth.role==="sales_representative"?"sms":null;
    if(allowed&&filter&&filter!==allowed)return response({error:"Template access is required."},403);
    const effective=filter||allowed;
    const rows=await database().prepare(`SELECT id, channel, name, subject, body, created_by, created_at, updated_at FROM message_templates WHERE tenant_id = ?${effective?" AND channel = ?":""} ORDER BY updated_at DESC LIMIT 200`).bind(tenantId,...(effective?[effective]:[])).all();
    const campaigns=(!filter||filter==="email")&&["business_owner","marketing_manager"].includes(auth.role!)
      ?await database().prepare("SELECT id, title, content_json FROM marketing_documents WHERE tenant_id = ? AND kind = 'email' ORDER BY updated_at DESC LIMIT 100").bind(tenantId).all()
      :null;
    return response({items:rows.results,campaigns:campaigns?.results.map(row=>{let content:Record<string,unknown>={};try{content=JSON.parse(String(row.content_json))}catch{}return {id:row.id,name:row.title,subject:content.subject,body:content.body}})||[],limited:rows.results.length===200});
  }catch{return response({error:"Could not load templates."},500)}
}
export async function POST(request:Request){
  try{
    const raw=await mutation(request);if(raw.error)return raw.error;
    const parsed=saveInput.safeParse(raw.data);if(!parsed.success)return response({error:"Check the template fields."},400);
    const data=parsed.data,auth=await member(request,data.tenant_id);if(auth.error)return auth.error;
    if(!canEdit(auth.role!,data.channel))return response({error:"You cannot edit this channel's templates."},403);
    if(data.channel==="email"&&!data.subject)return response({error:"Add an email subject."},400);
    const id=data.id||crypto.randomUUID();
    if(data.id){
      const old=await database().prepare("SELECT channel FROM message_templates WHERE tenant_id = ? AND id = ?").bind(data.tenant_id,id).first<{channel:string}>();
      if(!old)return response({error:"Template not found."},404);
      if(old.channel!==data.channel)return response({error:"Template channel cannot change."},400);
      await database().batch([
        database().prepare("UPDATE message_templates SET name = ?, subject = ?, body = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?").bind(data.name,data.channel==="email"?data.subject:null,data.body,data.tenant_id,id),
        database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'template.updated', 'message_template', ?)").bind(crypto.randomUUID(),data.tenant_id,auth.userId,id),
      ]);
    }else{
      await database().batch([
        database().prepare("INSERT INTO message_templates (id, tenant_id, channel, name, subject, body, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id,data.tenant_id,data.channel,data.name,data.channel==="email"?data.subject:null,data.body,auth.userId),
        database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'template.created', 'message_template', ?)").bind(crypto.randomUUID(),data.tenant_id,auth.userId,id),
      ]);
    }
    return response({id,saved:true},data.id?200:201);
  }catch{return response({error:"Could not save template."},500)}
}
export async function DELETE(request:Request){
  try{
    const raw=await mutation(request,1000);if(raw.error)return raw.error;
    const parsed=deleteInput.safeParse(raw.data);if(!parsed.success)return response({error:"Check the template selection."},400);
    const data=parsed.data,auth=await member(request,data.tenant_id);if(auth.error)return auth.error;
    const old=await database().prepare("SELECT channel FROM message_templates WHERE tenant_id = ? AND id = ?").bind(data.tenant_id,data.id).first<{channel:string}>();
    if(!old)return response({error:"Template not found."},404);
    if(!canEdit(auth.role!,old.channel))return response({error:"You cannot delete this template."},403);
    await database().batch([
      database().prepare("DELETE FROM message_templates WHERE tenant_id = ? AND id = ?").bind(data.tenant_id,data.id),
      database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'template.deleted', 'message_template', ?)").bind(crypto.randomUUID(),data.tenant_id,auth.userId,data.id),
    ]);
    return response({deleted:true});
  }catch{return response({error:"Could not delete template."},500)}
}
