import { env } from "cloudflare:workers";
import { z } from "zod";
import { getRequestIdentity } from "../../../lib/access-identity";

const uuid=z.string().uuid();
const hhmm=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const input=z.object({
  tenant_id:uuid,business_hours_start:hhmm,business_hours_end:hhmm,
  during_hours:z.enum(["sales_queue","voicemail"]),after_hours:z.enum(["sales_queue","voicemail"]),
  greeting:z.string().trim().min(5).max(500),voicemail_message:z.string().trim().min(5).max(500),
}).strict().refine(data=>data.business_hours_start<data.business_hours_end,{path:["business_hours_end"],message:"End time must follow start time."});
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
function database():D1Database{if(!env.DB)throw new Error("Inbound call storage is unavailable.");return env.DB}
async function access(request:Request,tenantId:string,write=false){
  const userId=(await getRequestIdentity(request.headers))?.userId;if(!userId)return {error:reply({error:"Sign in to continue."},401)};
  if(!uuid.safeParse(tenantId).success)return {error:reply({error:"Choose an organization."},400)};
  if(!env.DB)return {error:reply({error:"Inbound call storage is unavailable."},503)};
  const member=await database().prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'").bind(tenantId,userId).first<{role:string}>();
  const roles=write?["business_owner","sales_manager"]:["business_owner","sales_manager","sales_representative"];
  if(!member||!roles.includes(member.role))return {error:reply({error:"Sales access is required."},403)};
  return {userId,role:member.role};
}
export async function GET(request:Request){
  try{
    const tenantId=new URL(request.url).searchParams.get("tenant_id")||"",auth=await access(request,tenantId);if(auth.error)return auth.error;
    const org=await database().prepare("SELECT timezone FROM organizations WHERE id = ?").bind(tenantId).first<{timezone:string}>();
    const settings=await database().prepare("SELECT business_hours_start, business_hours_end, during_hours, after_hours, greeting, voicemail_message, updated_at FROM inbound_call_settings WHERE tenant_id = ?").bind(tenantId).first();
    return reply({settings:settings||{business_hours_start:"09:00",business_hours_end:"17:00",during_hours:"sales_queue",after_hours:"voicemail",greeting:"Thank you for calling. Please hold while we connect you.",voicemail_message:"Please leave your name, number, and a brief message."},timezone:org?.timezone||"America/Chicago",saved:Boolean(settings),provider_connected:false,number_connected:false});
  }catch{return reply({error:"Could not load inbound call settings."},500)}
}
export async function POST(request:Request){
  try{
    if(request.headers.get("Origin")!==new URL(request.url).origin)return reply({error:"Request origin was not accepted."},403);
    if(!request.headers.get("Content-Type")?.startsWith("application/json"))return reply({error:"Send JSON data."},415);
    const raw=await request.text();if(raw.length>2500)return reply({error:"Call settings are too large."},413);
    let data:z.infer<typeof input>;try{data=input.parse(JSON.parse(raw))}catch{return reply({error:"Check the hours and message fields."},400)}
    const auth=await access(request,data.tenant_id,true);if(auth.error)return auth.error;
    await database().batch([
      database().prepare("INSERT INTO inbound_call_settings (tenant_id, business_hours_start, business_hours_end, during_hours, after_hours, greeting, voicemail_message) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET business_hours_start = excluded.business_hours_start, business_hours_end = excluded.business_hours_end, during_hours = excluded.during_hours, after_hours = excluded.after_hours, greeting = excluded.greeting, voicemail_message = excluded.voicemail_message, updated_at = CURRENT_TIMESTAMP").bind(data.tenant_id,data.business_hours_start,data.business_hours_end,data.during_hours,data.after_hours,data.greeting,data.voicemail_message),
      database().prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'inbound_call_settings.updated', 'organization', ?)").bind(crypto.randomUUID(),data.tenant_id,auth.userId,data.tenant_id),
    ]);
    return reply({saved:true});
  }catch{return reply({error:"Could not save inbound call settings."},500)}
}
