import { env } from "cloudflare:workers";
import { z } from "zod";
import { getRequestIdentity } from "../../../lib/access-identity";
import {
  bookAppointment, BookingError, canAccessTenant, cancelAppointment, type AvailabilityConfig,
  type BookingInput, type BookingStore, type ReminderJob, rescheduleAppointment,
} from "../../../lib/appointments";

type Member = { role: string; record_scope: string; team_id: string | null };
type Identity = { id: string; email: string | null };
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

const tenantSchema = z.string().uuid();
const windowSchema = z.object({ weekday: z.number().int().min(0).max(6), start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict();
const availabilitySchema = z.object({
  action: z.literal("set_availability"), tenant_id: tenantSchema, timezone: z.string().trim().min(1).max(100),
  duration_minutes: z.number().int().min(5).max(240), windows: z.array(windowSchema).max(7),
}).strict().superRefine((value, context) => {
  if (new Set(value.windows.map(window => window.weekday)).size !== value.windows.length) context.addIssue({ code: "custom", message: "Use one availability window per weekday." });
  if (value.windows.some(window => window.start >= window.end)) context.addIssue({ code: "custom", message: "Each availability window must end after it starts." });
  try { new Intl.DateTimeFormat("en-US", { timeZone: value.timezone }); }
  catch { context.addIssue({ code: "custom", message: "Choose a valid IANA timezone." }); }
});
const bookSchema = z.object({ action: z.literal("book"), tenant_id: tenantSchema, contact_id: z.string().uuid(), opportunity_id: z.string().uuid().nullable().optional(), starts_at: z.string().datetime({ offset: true }) }).strict();
const rescheduleSchema = z.object({ action: z.literal("reschedule"), tenant_id: tenantSchema, appointment_id: z.string().uuid(), starts_at: z.string().datetime({ offset: true }) }).strict();
const cancelSchema = z.object({ action: z.literal("cancel"), tenant_id: tenantSchema, appointment_id: z.string().uuid() }).strict();
const mutationSchema = z.union([availabilitySchema, bookSchema, rescheduleSchema, cancelSchema]);

function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
function fail(status: number, message: string): never { throw new ApiError(status, message); }
function database(): D1Database { if (!env.DB) fail(503, "CRM storage is unavailable."); return env.DB; }
async function identity(request: Request): Promise<Identity> {
  const user = await getRequestIdentity(request.headers);
  if (!user) fail(401, "Sign in to continue.");
  return { id: user.userId, email: user.email };
}
async function membership(db: D1Database, tenantId: string, userId: string) {
  return db.prepare("SELECT role, record_scope, team_id FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'").bind(tenantId, userId).first<Member>();
}
function recordFilter(member: Member, tenantId: string, userId: string, ownerColumn: string) {
  if (member.record_scope === "organization" && ["business_owner", "sales_manager", "marketing_manager", "support_readonly"].includes(member.role)) return { sql: "", args: [] as unknown[] };
  if (member.record_scope === "team" && member.team_id) return {
    sql: ` AND (${ownerColumn} = ? OR ${ownerColumn} IN (SELECT user_id FROM memberships WHERE tenant_id = ? AND team_id = ? AND status = 'active'))`,
    args: [userId, tenantId, member.team_id],
  };
  return { sql: ` AND ${ownerColumn} = ?`, args: [userId] };
}
function requireSales(member: Member) {
  if (!["business_owner", "sales_manager", "sales_representative"].includes(member.role)) fail(403, "Sales access is required.");
}
function validateMutation(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) fail(403, "Request origin was not accepted.");
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) fail(415, "Send JSON data.");
}
async function readBody(request: Request) {
  const raw = await request.text();
  if (raw.length > 20000) fail(413, "Request is too large.");
  try { return JSON.parse(raw); } catch { return fail(400, "Invalid JSON."); }
}
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) fail(400, "Check the required fields and formats.");
  return result.data;
}

function createStore(db: D1Database, member: Member, user: Identity): BookingStore {
  return {
    async getAvailability(tenantId, ownerUserId) {
      const row = await db.prepare("SELECT timezone, duration_minutes, windows_json FROM appointment_availability WHERE tenant_id = ? AND owner_user_id = ?").bind(tenantId, ownerUserId).first<{ timezone: string; duration_minutes: number; windows_json: string }>();
      if (!row) return null;
      try { return { timezone: row.timezone, duration_minutes: row.duration_minutes, windows: JSON.parse(row.windows_json) } as AvailabilityConfig; }
      catch { return null; }
    },
    async hasContact(tenantId, contactId, userId) {
      const visible = recordFilter(member, tenantId, userId, "c.owner_user_id");
      return Boolean(await db.prepare(`SELECT c.id FROM contacts c WHERE c.tenant_id = ? AND c.id = ?${visible.sql}`).bind(tenantId, contactId, ...visible.args).first());
    },
    async hasOpportunity(tenantId, opportunityId, contactId, userId) {
      const visible = recordFilter(member, tenantId, userId, "o.owner_user_id");
      return Boolean(await db.prepare(`SELECT o.id FROM opportunities o WHERE o.tenant_id = ? AND o.id = ? AND o.contact_id = ?${visible.sql}`).bind(tenantId, opportunityId, contactId, ...visible.args).first());
    },
    async hasOverlap(tenantId, ownerUserId, startsAt, endsAt, excludingId) {
      const row = await db.prepare("SELECT id FROM appointments WHERE tenant_id = ? AND owner_user_id = ? AND status = 'booked' AND starts_at < ? AND ends_at > ? AND (? IS NULL OR id != ?) LIMIT 1").bind(tenantId, ownerUserId, endsAt, startsAt, excludingId ?? null, excludingId ?? null).first();
      return Boolean(row);
    },
    async createWithJobs(appointment, jobs) {
      const statements = [
        db.prepare("INSERT INTO appointments (id, tenant_id, owner_user_id, contact_id, opportunity_id, title, starts_at, ends_at, timezone, version, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(appointment.id, appointment.tenant_id, appointment.owner_user_id, appointment.contact_id, appointment.opportunity_id, appointment.title, appointment.starts_at, appointment.ends_at, appointment.timezone, appointment.version, appointment.status),
        ...jobs.map(job => jobInsert(db, appointment.tenant_id)(job)),
        db.prepare("INSERT INTO activities (id, tenant_id, contact_id, kind, summary, actor_user_id) VALUES (?, ?, ?, 'demo_booked', ?, ?)").bind(crypto.randomUUID(), appointment.tenant_id, appointment.contact_id, `Demo booked for ${appointment.starts_at}`, user.id),
        db.prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id, details_json) VALUES (?, ?, ?, 'appointment.booked', 'appointment', ?, ?)").bind(crypto.randomUUID(), appointment.tenant_id, user.id, appointment.id, JSON.stringify({ contact_id: appointment.contact_id, opportunity_id: appointment.opportunity_id, version: appointment.version })),
      ];
      await db.batch(statements);
    },
    async getAppointment(tenantId, ownerUserId, appointmentId) {
      const visible = recordFilter(member, tenantId, ownerUserId, "a.owner_user_id");
      return db.prepare(`SELECT a.id, a.tenant_id, a.owner_user_id, a.contact_id, a.opportunity_id, a.title, a.starts_at, a.ends_at, a.timezone, a.version, a.status FROM appointments a WHERE a.tenant_id = ? AND a.id = ?${visible.sql}`).bind(tenantId, appointmentId, ...visible.args).first();
    },
    async rescheduleWithJobs(appointment, previousVersion, jobs) {
      const result = await db.batch([
        db.prepare("UPDATE appointments SET starts_at = ?, ends_at = ?, timezone = ?, version = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND owner_user_id = ? AND id = ? AND status = 'booked' AND version = ?").bind(appointment.starts_at, appointment.ends_at, appointment.timezone, appointment.version, appointment.tenant_id, appointment.owner_user_id, appointment.id, previousVersion),
        db.prepare("UPDATE appointment_reminder_jobs SET status = 'skipped' WHERE tenant_id = ? AND appointment_id = ? AND appointment_version = ? AND status = 'dry_run' AND EXISTS (SELECT 1 FROM appointments WHERE tenant_id = ? AND id = ? AND version = ?)").bind(appointment.tenant_id, appointment.id, previousVersion, appointment.tenant_id, appointment.id, appointment.version),
        ...jobs.map(job => jobInsert(db, appointment.tenant_id)(job, appointment.id, appointment.version)),
        db.prepare("INSERT OR IGNORE INTO activities (id, tenant_id, contact_id, kind, summary, actor_user_id) SELECT ?, ?, contact_id, 'demo_rescheduled', ?, ? FROM appointments WHERE tenant_id = ? AND id = ? AND version = ?").bind(`${appointment.id}:${appointment.version}:activity`, appointment.tenant_id, `Demo rescheduled for ${appointment.starts_at}`, user.id, appointment.tenant_id, appointment.id, appointment.version),
        db.prepare("INSERT OR IGNORE INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id, details_json) SELECT ?, ?, ?, 'appointment.rescheduled', 'appointment', ?, ? WHERE EXISTS (SELECT 1 FROM appointments WHERE tenant_id = ? AND id = ? AND version = ?)").bind(`${appointment.id}:${appointment.version}:audit`, appointment.tenant_id, user.id, appointment.id, JSON.stringify({ version: appointment.version }), appointment.tenant_id, appointment.id, appointment.version),
      ]);
      return Number(result[0]?.meta?.changes ?? 0) > 0;
    },
    async cancelWithJobs(tenantId, actorUserId, appointmentId) {
      const current = await this.getAppointment(tenantId, actorUserId, appointmentId) as { version: number; owner_user_id: string; contact_id: string; status: string } | null;
      if (!current || current.status !== "booked") return false;
      const nextVersion = current.version + 1;
      const result = await db.batch([
        db.prepare("UPDATE appointments SET status = 'cancelled', version = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND owner_user_id = ? AND id = ? AND status = 'booked' AND version = ?").bind(nextVersion, tenantId, current.owner_user_id, appointmentId, current.version),
        db.prepare("UPDATE appointment_reminder_jobs SET status = 'skipped' WHERE tenant_id = ? AND appointment_id = ? AND status = 'dry_run' AND EXISTS (SELECT 1 FROM appointments WHERE tenant_id = ? AND id = ? AND status = 'cancelled' AND version = ?)").bind(tenantId, appointmentId, tenantId, appointmentId, nextVersion),
        db.prepare("INSERT OR IGNORE INTO activities (id, tenant_id, contact_id, kind, summary, actor_user_id) SELECT ?, ?, ?, 'demo_cancelled', 'Demo appointment cancelled', ? WHERE EXISTS (SELECT 1 FROM appointments WHERE tenant_id = ? AND id = ? AND status = 'cancelled' AND version = ?)").bind(`${appointmentId}:${nextVersion}:activity`, tenantId, current.contact_id, user.id, tenantId, appointmentId, nextVersion),
        db.prepare("INSERT OR IGNORE INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id, details_json) SELECT ?, ?, ?, 'appointment.cancelled', 'appointment', ?, ? WHERE EXISTS (SELECT 1 FROM appointments WHERE tenant_id = ? AND id = ? AND status = 'cancelled' AND version = ?)").bind(`${appointmentId}:${nextVersion}:audit`, tenantId, user.id, appointmentId, JSON.stringify({ version: nextVersion }), tenantId, appointmentId, nextVersion),
      ]);
      return Number(result[0]?.meta?.changes ?? 0) > 0;
    },
  };
}

function jobInsert(db: D1Database, tenantId: string) {
  return (job: ReminderJob, appointmentId?: string, version?: number) => db.prepare("INSERT OR IGNORE INTO appointment_reminder_jobs (id, tenant_id, appointment_id, appointment_version, reminder_kind, channel, due_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'dry_run')").bind(job.id, tenantId, appointmentId ?? job.appointment_id, version ?? job.appointment_version, job.reminder_kind, job.channel, job.due_at);
}

async function handle(request: Request) {
  const db = database(), user = await identity(request), url = new URL(request.url);
  const tenantId = url.searchParams.get("tenant_id");
  if (!tenantId || !tenantSchema.safeParse(tenantId).success) fail(400, "Choose an organization.");
  const member = await membership(db, tenantId, user.id);
  if (!member) fail(403, "You do not have access to this organization.");
  requireSales(member);
  if (request.method === "GET") {
    const resource = url.searchParams.get("resource");
    if (resource === "availability") {
      const config = await createStore(db, member, user).getAvailability(tenantId, user.id);
      return json({ availability: config });
    }
    if (resource !== "appointments") fail(400, "Choose availability or appointments.");
    const visible = recordFilter(member, tenantId, user.id, "a.owner_user_id");
    const [appointments, jobs] = await Promise.all([
      db.prepare(`SELECT a.id, a.contact_id, c.name AS contact_name, a.opportunity_id, a.title, a.starts_at, a.ends_at, a.timezone, COALESCE((SELECT av.timezone FROM appointment_availability av WHERE av.tenant_id = a.tenant_id AND av.owner_user_id = a.owner_user_id), a.timezone) AS reschedule_timezone, a.version, a.status FROM appointments a JOIN contacts c ON c.tenant_id = a.tenant_id AND c.id = a.contact_id WHERE a.tenant_id = ?${visible.sql} ORDER BY a.starts_at DESC LIMIT 100`).bind(tenantId, ...visible.args).all(),
      db.prepare(`SELECT j.id, j.appointment_id, j.appointment_version, j.reminder_kind, j.channel, j.due_at, j.status FROM appointment_reminder_jobs j JOIN appointments a ON a.tenant_id = j.tenant_id AND a.id = j.appointment_id WHERE j.tenant_id = ?${visible.sql} ORDER BY j.due_at LIMIT 300`).bind(tenantId, ...visible.args).all(),
    ]);
    return json({ items: appointments.results, reminder_jobs: jobs.results, delivery_mode: "dry_run" });
  }

  validateMutation(request);
  const data = parse(mutationSchema, await readBody(request));
  if (!canAccessTenant(tenantId, data.tenant_id)) fail(400, "Organization mismatch.");
  if (data.action === "set_availability") {
    if (!(["business_owner", "sales_manager"].includes(member.role))) fail(403, "Manager access is required to configure availability.");
    await db.prepare("INSERT INTO appointment_availability (id, tenant_id, owner_user_id, timezone, duration_minutes, windows_json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, owner_user_id) DO UPDATE SET timezone = excluded.timezone, duration_minutes = excluded.duration_minutes, windows_json = excluded.windows_json, updated_at = CURRENT_TIMESTAMP").bind(crypto.randomUUID(), tenantId, user.id, data.timezone, data.duration_minutes, JSON.stringify(data.windows)).run();
    await db.prepare("INSERT INTO audit_events (id, tenant_id, actor_user_id, kind, target_type, target_id, details_json) VALUES (?, ?, ?, 'appointment.availability_updated', 'appointment_availability', ?, ?)").bind(crypto.randomUUID(), tenantId, user.id, user.id, JSON.stringify({ timezone: data.timezone, duration_minutes: data.duration_minutes })).run();
    return json({ saved: true });
  }

  const store = createStore(db, member, user);
  try {
    if (data.action === "book") {
      const input: BookingInput = { ...data, member_tenant_id: tenantId, user_id: user.id };
      const appointment = await bookAppointment(store, input);
      return json({ appointment, delivery_mode: "dry_run" }, 201);
    }
    if (data.action === "reschedule") {
      const appointment = await rescheduleAppointment(store, { ...data, member_tenant_id: tenantId, user_id: user.id });
      return json({ appointment, delivery_mode: "dry_run" });
    }
    await cancelAppointment(store, { ...data, member_tenant_id: tenantId, user_id: user.id });
    return json({ cancelled: true });
  } catch (cause) {
    if (cause instanceof BookingError) throw new ApiError(cause.status, cause.message);
    if (cause instanceof Error && cause.message.includes("appointment_overlap")) throw new ApiError(409, "That time is already booked.");
    throw cause;
  }
}

async function respond(request: Request) {
  try { return await handle(request); }
  catch (cause) {
    if (cause instanceof ApiError) return json({ error: cause.message }, cause.status);
    console.error("Appointment request failed", cause);
    return json({ error: "Appointments are temporarily unavailable." }, 503);
  }
}

export const GET = respond;
export const POST = respond;