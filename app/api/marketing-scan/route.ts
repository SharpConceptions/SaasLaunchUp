import { env } from "cloudflare:workers";
import { z } from "zod";
import { getRequestIdentity } from "../../../lib/access-identity";

const input=z.object({tenant_id:z.string().uuid(),website:z.string().trim().min(4).max(500)}).strict();
const blocked=[".localhost",".local",".internal",".test",".example",".invalid",".onion",".lan",".corp",".nip.io",".sslip.io",".xip.io",".localtest.me",".lvh.me",".traefik.me"];
function reply(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store"}})}
function publicUrl(value:string){
  const url=new URL(/^https?:\/\//i.test(value)?value:`https://${value}`);
  const host=url.hostname.toLowerCase();
  if(url.protocol!=="https:"||url.username||url.password||url.port||! /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)||host.split(".").some(label=>label.startsWith("-")||label.endsWith("-"))||!/[a-z]/.test(host.split(".").at(-1)||"")||blocked.some(suffix=>host.endsWith(suffix)))throw new Error("Use a public HTTPS website.");
  url.hash="";
  return url.toString();
}
function attrs(tag:string){const result:Record<string,string>={};for(const match of tag.matchAll(/([a-z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))result[match[1].toLowerCase()]=match[2]??match[3]??match[4]??"";return result}
function clean(value:string){return value.replace(/<[^>]*>/g,"").replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g,entity=>({"&amp;":"&","&quot;":"\"","&apos;":"'","&lt;":"<","&gt;":">","&nbsp;":" "})[entity]||entity).replace(/\s+/g," ").trim()}
function analyze(html:string,website:string){
  const head=html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]||html.slice(0,100000);
  const meta=new Map<string,string>();
  for(const tag of head.match(/<meta\b[^>]*>/gi)||[]){const a=attrs(tag);const key=(a.name||a.property||"").toLowerCase();if(key)meta.set(key,clean(a.content||"").slice(0,500))}
  const links=new Map<string,string>();
  for(const tag of head.match(/<link\b[^>]*>/gi)||[]){const a=attrs(tag);if(a.rel)links.set(a.rel.toLowerCase(),a.href||"")}
  const title=clean(head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||"").slice(0,500);
  const h1=clean(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||"").slice(0,500);
  const lang=attrs(html.match(/<html\b[^>]*>/i)?.[0]||"").lang||"";
  const schemas=[...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).join(" ");
  const schemaType=(type:string)=>new RegExp(`"@type"\\s*:\\s*(?:"${type}"|\\[[^\\]]*"${type}")`,"i").test(schemas);
  const check=(label:string,ok:boolean,detail:string)=>({label,status:ok?"pass":"review",detail});
  const canonical=links.get("canonical")||"",description=meta.get("description")||"";
  const seo=[
    check("Page title",title.length>=15&&title.length<=65,title?`${title.slice(0,130)}${title.length>65?" · Consider a shorter title.":title.length<15?" · Add more detail.":""}`:"Add a unique, descriptive <title>."),
    check("Meta description",description.length>=50&&description.length<=160,description?`${description.slice(0,180)}${description.length>160?" · Consider a shorter description.":description.length<50?" · Add more detail.":""}`:"Add a useful summary in the meta description."),
    check("Canonical URL",Boolean(canonical),canonical||"Declare the preferred URL with rel=canonical."),
    check("Indexing directive",!/(?:^|,)\s*noindex/i.test(meta.get("robots")||""),meta.get("robots")||"No noindex directive found."),
    check("Page heading",Boolean(h1),h1||"Add a clear H1 heading."),
    check("Language",Boolean(lang),lang||"Set the html lang attribute."),
  ];
  const geo=[
    check("Open Graph title",Boolean(meta.get("og:title")),meta.get("og:title")||"Add og:title for shared previews."),
    check("Open Graph description",Boolean(meta.get("og:description")),meta.get("og:description")||"Add og:description for shared previews."),
    check("Open Graph image",Boolean(meta.get("og:image")),meta.get("og:image")||"Add an og:image URL."),
    check("Structured data",Boolean(schemas),schemas?"JSON-LD found. Validate its claims and fields separately.":"Add relevant JSON-LD schema where appropriate."),
    check("Organization or author context",schemaType("Organization")||schemaType("Person")||Boolean(meta.get("author")),"Identify the organization or author clearly for search and answer engines."),
  ];
  const aeo=[
    check("Clear question or topic heading",Boolean(h1),h1||"Use a heading that states the page topic."),
    check("Article or FAQ schema",schemaType("Article")||schemaType("BlogPosting")||schemaType("FAQPage"),"Use accurate Article, BlogPosting, or FAQPage schema when it fits the page."),
    check("Shareable summary",Boolean(description&&meta.get("og:description")),"Provide a concise meta and social description of the page."),
  ];
  return {website,scanned_at:new Date().toISOString(),title,seo,geo,aeo,summary:{seo:seo.filter(x=>x.status==="pass").length,geo:geo.filter(x=>x.status==="pass").length,aeo:aeo.filter(x=>x.status==="pass").length}};
}
export async function POST(request:Request){
  const userId=(await getRequestIdentity(request.headers))?.userId;if(!userId)return reply({error:"Sign in to scan a website."},401);
  if(request.headers.get("Origin")!==new URL(request.url).origin)return reply({error:"Request origin was not accepted."},403);
  if(!request.headers.get("Content-Type")?.startsWith("application/json"))return reply({error:"Send JSON data."},415);
  const raw=await request.text();if(raw.length>1200)return reply({error:"Request is too large."},413);
  let data:z.infer<typeof input>,website:string;
  try{data=input.parse(JSON.parse(raw));website=publicUrl(data.website)}catch{return reply({error:"Enter a public HTTPS page URL."},400)}
  const db=env.DB;if(!db)return reply({error:"Marketing storage is unavailable."},503);
  const member=await db.prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'").bind(data.tenant_id,userId).first<{role:string}>();
  if(!member||!["business_owner","marketing_manager"].includes(member.role))return reply({error:"Marketing access is required."},403);
  try{
    const fetched=await fetch(website,{redirect:"manual",signal:AbortSignal.timeout(10000),headers:{Accept:"text/html"}});
    if(!fetched.ok||!fetched.headers.get("content-type")?.toLowerCase().includes("text/html"))return reply({error:"This URL did not return a public HTML page."},422);
    if(Number(fetched.headers.get("content-length")||0)>350000)return reply({error:"Page is too large to scan."},422);
    const reader=fetched.body?.getReader();if(!reader)return reply({error:"Page is empty."},422);
    const parts:Uint8Array[]= [];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>350000){await reader.cancel();return reply({error:"Page is too large to scan."},422)}parts.push(value)}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}
    return reply(analyze(new TextDecoder().decode(bytes),website));
  }catch{return reply({error:"Could not reach that public page. Check the URL and try again."},502)}
}
