import { z } from "zod";
import { env } from "cloudflare:workers";
import { getRequestIdentity } from "../../../lib/access-identity";

const input = z.object({ website: z.string().trim().min(4).max(253), tenant_id: z.string().uuid().optional(), company_id: z.string().uuid().optional() }).strict();
const blockedSuffixes = [".localhost", ".local", ".internal", ".test", ".example", ".invalid", ".onion", ".lan", ".corp", ".nip.io", ".sslip.io", ".xip.io", ".localtest.me", ".lvh.me", ".traefik.me"];
function response(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
function publicWebsite(value: string) {
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); }
  catch { throw new Error("Enter a valid company website."); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ||
      host.split(".").some(label => label.startsWith("-") || label.endsWith("-")) ||
      !/[a-z]/.test(host.split(".").at(-1) || "") ||
      host === "localhost" || blockedSuffixes.some(suffix => host.endsWith(suffix)) ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) throw new Error("Use a public HTTPS company domain.");
  return `https://${host}${url.pathname}`;
}
function decode(value: string) {
  return value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, entity => ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " })[entity] || entity)
    .replace(/\s+/g, " ").trim();
}
function attributes(tag: string) {
  const found: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) found[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return found;
}
function information(html: string) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<[^>]+>/g, "")).slice(0, 160);
  const descriptions: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const meta = attributes(tag);
    if (["description", "og:description", "twitter:description"].includes((meta.name || meta.property || "").toLowerCase())) descriptions.push(meta.content || "");
  }
  const stripped = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "");
  const paragraphs = [...stripped.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].slice(0, 20).map(match => match[1].replace(/<[^>]+>/g, ""));
  const description = [...descriptions, ...paragraphs].map(decode).find(text => text.length >= 35 && text.length <= 800);
  return { title, description: description?.slice(0, 360) || "" };
}
export async function POST(request: Request) {
  const userId = (await getRequestIdentity(request.headers))?.userId;
  if (!userId) return response({ error: "Sign in to research a company." }, 401);
  if (request.headers.get("Origin") !== new URL(request.url).origin) return response({ error: "Request origin was not accepted." }, 403);
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return response({ error: "Send JSON data." }, 415);
  const raw = await request.text();
  if (raw.length > 1024) return response({ error: "Request is too large." }, 413);
  let website: string, tenantId: string | undefined, companyId: string | undefined;
  try { const data=input.parse(JSON.parse(raw)); website = publicWebsite(data.website); tenantId=data.tenant_id; companyId=data.company_id; }
  catch (error) { return response({ error: error instanceof Error ? error.message : "Enter a valid website." }, 400); }
  if (Boolean(tenantId) !== Boolean(companyId)) return response({ error: "Choose both an organization and a company." }, 400);
  let db: D1Database | undefined;
  if (tenantId && companyId) {
    db = env.DB;
    if (!db) return response({ error: "CRM storage is unavailable." }, 503);
    const row = await db.prepare("SELECT c.domain, c.owner_user_id, m.role, m.record_scope, m.team_id FROM companies c JOIN memberships m ON m.tenant_id = c.tenant_id WHERE c.tenant_id = ? AND c.id = ? AND m.user_id = ? AND m.status = 'active'").bind(tenantId, companyId, userId).first<{domain: string | null; owner_user_id: string | null; role: string; record_scope: string; team_id: string | null}>();
    if (!row) return response({ error: "Company not found." }, 404);
    if (!["business_owner", "sales_manager", "sales_representative"].includes(row.role)) return response({ error: "Your role cannot research this company." }, 403);
    if (row.record_scope !== "organization" || row.role === "sales_representative") {
      const own = row.owner_user_id === userId;
      const team = row.record_scope === "team" && row.team_id && row.owner_user_id && await db.prepare("SELECT id FROM memberships WHERE tenant_id = ? AND user_id = ? AND team_id = ? AND status = 'active'").bind(tenantId, row.owner_user_id, row.team_id).first();
      if (!own && !team) return response({ error: "Company not found." }, 404);
    }
    let officialWebsite: string | null = null;
    try { if (row.domain) officialWebsite = publicWebsite(row.domain); } catch {}
    if (!officialWebsite || new URL(officialWebsite).hostname.replace(/^www\./, "") !== new URL(website).hostname.replace(/^www\./, "")) return response({ error: "Use the official domain saved on this company record." }, 400);
  }
  try {
    const result = await fetch(website, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { Accept: "text/html" } });
    if (!result.ok || result.status >= 300 || !result.headers.get("content-type")?.toLowerCase().includes("text/html")) return response({ error: "The website did not provide a public HTML page." }, 422);
    if (Number(result.headers.get("content-length") || 0) > 300_000) return response({ error: "The page is too large to research." }, 422);
    const reader = result.body?.getReader();
    if (!reader) return response({ error: "The website returned no content." }, 422);
    const parts: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 300_000) { await reader.cancel(); return response({ error: "The page is too large to research." }, 422); }
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    const resultInfo = information(new TextDecoder().decode(bytes));
    if (!resultInfo.description) return response({ error: "No clear company description was found on this website. Try another official page." }, 422);
    const retrievedAt = new Date().toISOString();
    if (db && tenantId && companyId) await db.batch([
      db.prepare("UPDATE companies SET research_summary = ?, research_source_url = ?, researched_at = ? WHERE tenant_id = ? AND id = ?").bind(resultInfo.description, website, retrievedAt, tenantId, companyId),
      db.prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id) VALUES (?, ?, ?, 'company.researched', 'company', ?)").bind(crypto.randomUUID(), tenantId, userId, companyId),
    ]);
    return response({ website, title: resultInfo.title, description: resultInfo.description, retrieved_at: retrievedAt });
  } catch { return response({ error: "Could not reach that public website. Check the domain and try again." }, 502); }
}
