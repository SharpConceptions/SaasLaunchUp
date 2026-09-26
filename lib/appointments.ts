export type AvailabilityWindow = {
  weekday: number;
  start: string;
  end: string;
};

export type Appointment = {
  id: string;
  tenant_id: string;
  owner_user_id: string;
  contact_id: string;
  opportunity_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  version: number;
  status: "booked" | "cancelled";
};

export type ReminderKind = "confirmation" | "24h" | "4h" | "15m";
export type ReminderChannel = "email" | "sms";
export type ReminderJob = {
  id: string;
  appointment_id: string;
  appointment_version: number;
  reminder_kind: ReminderKind;
  channel: ReminderChannel;
  due_at: string;
  status: "dry_run";
};

export type AvailabilityConfig = {
  timezone: string;
  duration_minutes: number;
  windows: AvailabilityWindow[];
};

export type BookingInput = {
  member_tenant_id: string;
  tenant_id: string;
  user_id: string;
  contact_id: string;
  opportunity_id?: string | null;
  starts_at: string;
};

export interface BookingStore {
  getAvailability(tenantId: string, ownerUserId: string): Promise<AvailabilityConfig | null>;
  hasContact(tenantId: string, contactId: string, userId: string): Promise<boolean>;
  hasOpportunity(tenantId: string, opportunityId: string, contactId: string, userId: string): Promise<boolean>;
  hasOverlap(tenantId: string, ownerUserId: string, startsAt: string, endsAt: string, excludingId?: string): Promise<boolean>;
  createWithJobs(appointment: Appointment, jobs: ReminderJob[]): Promise<void>;
  getAppointment(tenantId: string, ownerUserId: string, appointmentId: string): Promise<Appointment | null>;
  rescheduleWithJobs(appointment: Appointment, previousVersion: number, jobs: ReminderJob[]): Promise<boolean>;
  cancelWithJobs(tenantId: string, ownerUserId: string, appointmentId: string): Promise<boolean>;
}

export class BookingError extends Error {
  status: 400 | 403 | 404 | 409;
  constructor(status: 400 | 403 | 404 | 409, message: string) { super(message); this.status = status; }
}

const reminderSchedule: Array<{ kind: ReminderKind; offsetMs: number; channels: ReminderChannel[] }> = [
  { kind: "confirmation", offsetMs: 0, channels: ["email", "sms"] },
  { kind: "24h", offsetMs: 24 * 60 * 60 * 1000, channels: ["email", "sms"] },
  { kind: "4h", offsetMs: 4 * 60 * 60 * 1000, channels: ["email", "sms"] },
  { kind: "15m", offsetMs: 15 * 60 * 1000, channels: ["sms"] },
];

export function overlaps(start: number, end: number, otherStart: number, otherEnd: number) {
  return start < otherEnd && end > otherStart;
}

function localParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { weekday: weekdays.indexOf(read("weekday")), minute: Number(read("hour")) * 60 + Number(read("minute")) };
}

function minuteOfDay(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return NaN;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : NaN;
}

export function isWithinAvailability(startAt: string, endAt: string, timezone: string, windows: AvailabilityWindow[]) {
  const start = new Date(startAt), end = new Date(endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return false;
  try {
    const localStart = localParts(start, timezone), localEnd = localParts(new Date(end.getTime() - 1), timezone);
    if (localStart.weekday !== localEnd.weekday) return false;
    return windows.some(window => {
      const windowStart = minuteOfDay(window.start), windowEnd = minuteOfDay(window.end);
      return window.weekday === localStart.weekday && Number.isFinite(windowStart) && Number.isFinite(windowEnd)
        && windowStart < windowEnd && localStart.minute >= windowStart && localEnd.minute < windowEnd;
    });
  } catch {
    return false;
  }
}

export function reminderJobs(appointment: Appointment, now = new Date()): ReminderJob[] {
  const startsAt = Date.parse(appointment.starts_at);
  if (!Number.isFinite(startsAt) || appointment.status !== "booked") return [];
  return reminderSchedule.flatMap(({ kind, offsetMs, channels }) => {
    const dueAt = kind === "confirmation" ? now.getTime() : startsAt - offsetMs;
    if (kind !== "confirmation" && dueAt <= now.getTime()) return [];
    return channels.map(channel => ({
      id: `${appointment.id}:${appointment.version}:${kind}:${channel}`,
      appointment_id: appointment.id,
      appointment_version: appointment.version,
      reminder_kind: kind,
      channel,
      due_at: new Date(dueAt).toISOString(),
      status: "dry_run" as const,
    }));
  });
}

export function canAccessTenant(memberTenantId: string | null, requestedTenantId: string) {
  return memberTenantId === requestedTenantId;
}

async function checkedSlot(store: BookingStore, input: BookingInput, now: Date, excludingId?: string) {
  if (!canAccessTenant(input.member_tenant_id, input.tenant_id)) throw new BookingError(403, "Organization access is required.");
  const config = await store.getAvailability(input.tenant_id, input.user_id);
  if (!config) throw new BookingError(400, "Set availability before booking an appointment.");
  const start = new Date(input.starts_at);
  if (!Number.isFinite(start.getTime()) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/.test(input.starts_at)) throw new BookingError(400, "Choose a valid appointment start time in UTC.");
  if (start.getTime() <= now.getTime()) throw new BookingError(400, "Choose a future appointment time.");
  if (!Number.isInteger(config.duration_minutes) || config.duration_minutes < 5 || config.duration_minutes > 240) throw new BookingError(400, "Appointment duration is not configured correctly.");
  const end = new Date(start.getTime() + config.duration_minutes * 60_000).toISOString();
  if (!isWithinAvailability(input.starts_at, end, config.timezone, config.windows)) throw new BookingError(400, "Choose a time within the configured availability.");
  if (!await store.hasContact(input.tenant_id, input.contact_id, input.user_id)) throw new BookingError(404, "Contact not found.");
  if (input.opportunity_id && !await store.hasOpportunity(input.tenant_id, input.opportunity_id, input.contact_id, input.user_id)) throw new BookingError(400, "Choose an opportunity linked to this contact.");
  if (await store.hasOverlap(input.tenant_id, input.user_id, input.starts_at, end, excludingId)) throw new BookingError(409, "That time is already booked.");
  return { config, endsAt: end };
}

export async function bookAppointment(store: BookingStore, input: BookingInput, now = new Date()): Promise<Appointment> {
  const { config, endsAt } = await checkedSlot(store, input, now);
  const appointment: Appointment = {
    id: crypto.randomUUID(), tenant_id: input.tenant_id, owner_user_id: input.user_id,
    contact_id: input.contact_id, opportunity_id: input.opportunity_id ?? null, title: "Demo appointment",
    starts_at: new Date(input.starts_at).toISOString(), ends_at: endsAt,
    timezone: config.timezone, version: 1, status: "booked",
  };
  await store.createWithJobs(appointment, reminderJobs(appointment, now));
  return appointment;
}

export async function rescheduleAppointment(store: BookingStore, input: Omit<BookingInput, "contact_id"> & { appointment_id: string }, now = new Date()): Promise<Appointment> {
  if (!canAccessTenant(input.member_tenant_id, input.tenant_id)) throw new BookingError(403, "Organization access is required.");
  const current = await store.getAppointment(input.tenant_id, input.user_id, input.appointment_id);
  if (!current) throw new BookingError(404, "Appointment not found.");
  if (current.status !== "booked") throw new BookingError(409, "Cancelled appointments cannot be rescheduled.");
  const { config, endsAt } = await checkedSlot(store, { ...input, contact_id: current.contact_id }, now, current.id);
  const updated = { ...current, starts_at: new Date(input.starts_at).toISOString(), ends_at: endsAt, timezone: config.timezone, version: current.version + 1 };
  const saved = await store.rescheduleWithJobs(updated, current.version, reminderJobs(updated, now));
  if (!saved) throw new BookingError(409, "Appointment changed; reload and try again.");
  return updated;
}

export async function cancelAppointment(store: BookingStore, input: { member_tenant_id: string; tenant_id: string; user_id: string; appointment_id: string }) {
  if (!canAccessTenant(input.member_tenant_id, input.tenant_id)) throw new BookingError(403, "Organization access is required.");
  const cancelled = await store.cancelWithJobs(input.tenant_id, input.user_id, input.appointment_id);
  if (!cancelled) throw new BookingError(404, "Appointment not found.");
}