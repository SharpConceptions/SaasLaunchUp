import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { bookAppointment, canAccessTenant, cancelAppointment, isWithinAvailability, overlaps, reminderJobs, rescheduleAppointment } from "../lib/appointments.ts";

class MemoryBookingStore {
  config = { timezone: "America/Chicago", duration_minutes: 30, windows: [{ weekday: 2, start: "09:00", end: "17:00" }] };
  appointments = new Map();
  jobs = new Map();
  sharedAppointmentAccess = new Set();
  availabilityLookups = [];
  async getAvailability(tenantId, ownerUserId) { this.availabilityLookups.push(ownerUserId); return tenantId === "tenant-1" ? this.config : null; }
  async hasContact(tenantId, contactId) { return tenantId === "tenant-1" && contactId === "contact-1"; }
  async hasOpportunity(tenantId, opportunityId, contactId) { return tenantId === "tenant-1" && opportunityId === "deal-1" && contactId === "contact-1"; }
  async hasOverlap(tenantId, ownerUserId, startsAt, endsAt, excludingId) {
    return [...this.appointments.values()].some(item => item.tenant_id === tenantId && item.owner_user_id === ownerUserId && item.id !== excludingId && item.status === "booked" && overlaps(Date.parse(startsAt), Date.parse(endsAt), Date.parse(item.starts_at), Date.parse(item.ends_at)));
  }
  async createWithJobs(item, jobs) {
    if (await this.hasOverlap(item.tenant_id, item.owner_user_id, item.starts_at, item.ends_at)) throw new Error("appointment_overlap");
    this.appointments.set(item.id, item);
    this.insertJobs(jobs);
  }
  async getAppointment(tenantId, actorUserId, appointmentId) {
    const item = this.appointments.get(appointmentId);
    const canSee = item?.owner_user_id === actorUserId || this.sharedAppointmentAccess.has(`${actorUserId}:${item?.owner_user_id}`);
    return item?.tenant_id === tenantId && canSee ? item : null;
  }
  async rescheduleWithJobs(item, previousVersion, jobs) {
    const current = this.appointments.get(item.id);
    if (!current || current.version !== previousVersion) return false;
    if (await this.hasOverlap(item.tenant_id, item.owner_user_id, item.starts_at, item.ends_at, item.id)) throw new Error("appointment_overlap");
    this.appointments.set(item.id, item);
    for (const [id, job] of this.jobs) if (job.appointment_id === item.id && job.status === "dry_run") this.jobs.set(id, { ...job, status: "skipped" });
    this.insertJobs(jobs);
    return true;
  }
  async cancelWithJobs(tenantId, actorUserId, appointmentId) {
    const current = await this.getAppointment(tenantId, actorUserId, appointmentId);
    if (!current) return false;
    this.appointments.set(appointmentId, { ...current, status: "cancelled", version: current.version + 1 });
    for (const [id, job] of this.jobs) if (job.appointment_id === appointmentId && job.status === "dry_run") this.jobs.set(id, { ...job, status: "skipped" });
    return true;
  }
  insertJobs(jobs) { for (const job of jobs) if (!this.jobs.has(job.id)) this.jobs.set(job.id, job); }
}

const appointment = overrides => ({
  id: "appointment-1",
  tenant_id: "tenant-1",
  owner_user_id: "owner-1",
  contact_id: "contact-1",
  starts_at: "2026-09-29T15:00:00.000Z",
  ends_at: "2026-09-29T15:30:00.000Z",
  timezone: "America/Chicago",
  version: 1,
  status: "booked",
  ...overrides,
});

test("availability uses the configured IANA timezone window", () => {
  const windows = [{ weekday: 2, start: "09:00", end: "17:00" }];
  assert.equal(isWithinAvailability("2026-09-29T15:00:00Z", "2026-09-29T15:30:00Z", "America/Chicago", windows), true);
  assert.equal(isWithinAvailability("2026-09-29T21:30:00Z", "2026-09-29T22:00:00Z", "America/Chicago", windows), true);
  assert.equal(isWithinAvailability("2026-09-29T21:45:00Z", "2026-09-29T22:15:00Z", "America/Chicago", windows), false);
  assert.equal(isWithinAvailability("2026-09-29T13:00:00Z", "2026-09-29T13:30:00Z", "America/Chicago", windows), false);
  assert.equal(isWithinAvailability("2026-09-29T15:00:00Z", "2026-09-29T15:30:00Z", "Invalid/Zone", windows), false);
});

test("booking windows collide only when their half-open intervals overlap", () => {
  assert.equal(overlaps(Date.parse("2026-09-29T15:00:00Z"), Date.parse("2026-09-29T15:30:00Z"), Date.parse("2026-09-29T15:29:00Z"), Date.parse("2026-09-29T16:00:00Z")), true);
  assert.equal(overlaps(Date.parse("2026-09-29T15:00:00Z"), Date.parse("2026-09-29T15:30:00Z"), Date.parse("2026-09-29T15:30:00Z"), Date.parse("2026-09-29T16:00:00Z")), false);
});

test("rescheduling advances reminder identity and omits elapsed reminders", () => {
  const first = reminderJobs(appointment(), new Date("2026-09-28T16:00:00.000Z"));
  const rescheduled = reminderJobs(appointment({ version: 2, starts_at: "2026-10-01T15:00:00.000Z", ends_at: "2026-10-01T15:30:00.000Z" }), new Date("2026-09-28T16:00:00.000Z"));
  assert.equal(first.some(job => job.reminder_kind === "24h"), false);
  assert.equal(rescheduled.some(job => job.reminder_kind === "24h"), true);
  assert.notEqual(first[0].id, rescheduled[0].id);
});

test("cancellation creates no reminder jobs", () => {
  assert.deepEqual(reminderJobs(appointment({ status: "cancelled" })), []);
});

test("reminder jobs are dry-run and have deterministic duplicate keys", () => {
  const a = reminderJobs(appointment(), new Date("2026-09-28T14:00:00.000Z"));
  const b = reminderJobs(appointment(), new Date("2026-09-28T14:00:00.000Z"));
  assert.ok(a.length > 0);
  assert.ok(a.every(job => job.status === "dry_run"));
  assert.deepEqual(a.map(job => job.id), b.map(job => job.id));
  assert.equal(new Set(a.map(job => job.id)).size, a.length);
});

test("tenant access rejects another organization", () => {
  assert.equal(canAccessTenant("tenant-1", "tenant-1"), true);
  assert.equal(canAccessTenant("tenant-1", "tenant-2"), false);
  assert.equal(canAccessTenant(null, "tenant-1"), false);
});

test("booking creates a CRM-linked appointment and one dry-run job per key", async () => {
  const store = new MemoryBookingStore();
  const input = { member_tenant_id: "tenant-1", tenant_id: "tenant-1", user_id: "owner-1", contact_id: "contact-1", opportunity_id: "deal-1", starts_at: "2026-09-29T15:00:00.000Z" };
  const saved = await bookAppointment(store, input, new Date("2026-09-28T14:00:00.000Z"));
  assert.equal(saved.contact_id, "contact-1");
  assert.equal(saved.status, "booked");
  assert.equal([...store.jobs.values()].length, 7);
  await assert.rejects(bookAppointment(store, input, new Date("2026-09-28T14:00:00.000Z")), /already booked/);
  await assert.rejects(bookAppointment(store, { ...input, starts_at: "2026-09-28T13:00:00.000Z" }, new Date("2026-09-28T14:00:00.000Z")), /future appointment/);
});

test("rescheduling invalidates the previous schedule and advances its version", async () => {
  const store = new MemoryBookingStore();
  const input = { member_tenant_id: "tenant-1", tenant_id: "tenant-1", user_id: "owner-1", contact_id: "contact-1", starts_at: "2026-09-29T15:00:00.000Z" };
  const booked = await bookAppointment(store, input, new Date("2026-09-28T14:00:00.000Z"));
  const moved = await rescheduleAppointment(store, { ...input, appointment_id: booked.id, starts_at: "2026-09-29T16:00:00.000Z" }, new Date("2026-09-28T14:00:00.000Z"));
  assert.equal(moved.version, 2);
  assert.equal([...store.jobs.values()].filter(job => job.appointment_version === 1 && job.status === "dry_run").length, 0);
  assert.ok([...store.jobs.values()].some(job => job.appointment_version === 2 && job.status === "dry_run"));
});

test("cancellation skips every pending dry-run job", async () => {
  const store = new MemoryBookingStore();
  const booked = await bookAppointment(store, { member_tenant_id: "tenant-1", tenant_id: "tenant-1", user_id: "owner-1", contact_id: "contact-1", starts_at: "2026-09-29T15:00:00.000Z" }, new Date("2026-09-28T14:00:00.000Z"));
  await cancelAppointment(store, { member_tenant_id: "tenant-1", tenant_id: "tenant-1", user_id: "owner-1", appointment_id: booked.id });
  assert.equal(store.appointments.get(booked.id).status, "cancelled");
  assert.ok([...store.jobs.values()].every(job => job.status === "skipped"));
});

test("another tenant cannot book or read an appointment", async () => {
  const store = new MemoryBookingStore();
  await assert.rejects(bookAppointment(store, { member_tenant_id: "tenant-1", tenant_id: "tenant-2", user_id: "owner-1", contact_id: "contact-1", starts_at: "2026-09-29T15:00:00.000Z" }), { status: 403 });
  await assert.rejects(bookAppointment(store, { member_tenant_id: "tenant-2", tenant_id: "tenant-2", user_id: "owner-1", contact_id: "contact-1", starts_at: "2026-09-29T15:00:00.000Z" }), /Set availability/);
});

test("repeated scheduling inserts do not duplicate deterministic job keys", () => {
  const store = new MemoryBookingStore();
  const jobs = reminderJobs(appointment(), new Date("2026-09-28T14:00:00.000Z"));
  store.insertJobs(jobs);
  store.insertJobs(jobs);
  assert.equal(store.jobs.size, jobs.length);
});

test("migration rejects concurrent overlapping bookings but permits adjacent slots", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE organizations (id TEXT PRIMARY KEY); CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE contacts (id TEXT PRIMARY KEY); CREATE TABLE opportunities (id TEXT PRIMARY KEY);");
  db.exec(readFileSync(new URL("../drizzle/0016_robust_veda.sql", import.meta.url), "utf8"));
  db.exec("INSERT INTO organizations VALUES ('t1'); INSERT INTO organizations VALUES ('t2'); INSERT INTO users VALUES ('u1'); INSERT INTO users VALUES ('u2'); INSERT INTO contacts VALUES ('c1'); INSERT INTO contacts VALUES ('c2'); INSERT INTO contacts VALUES ('c3');");
  const insert = db.prepare("INSERT INTO appointments (id, tenant_id, owner_user_id, contact_id, title, starts_at, ends_at, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  insert.run("a1", "t1", "u1", "c1", "Demo", "2026-09-29T15:00:00.000Z", "2026-09-29T15:30:00.000Z", "America/Chicago");
  assert.throws(() => insert.run("a2", "t1", "u1", "c2", "Demo", "2026-09-29T15:15:00.000Z", "2026-09-29T15:45:00.000Z", "America/Chicago"), /appointment_overlap/);
  insert.run("a3", "t1", "u1", "c2", "Demo", "2026-09-29T15:30:00.000Z", "2026-09-29T16:00:00.000Z", "America/Chicago");
  insert.run("a4", "t1", "u2", "c3", "Demo", "2026-09-29T15:00:00.000Z", "2026-09-29T15:30:00.000Z", "America/Chicago");
  insert.run("a5", "t2", "u1", "c3", "Demo", "2026-09-29T15:00:00.000Z", "2026-09-29T15:30:00.000Z", "America/Chicago");
  const reminder = db.prepare("INSERT OR IGNORE INTO appointment_reminder_jobs (id, tenant_id, appointment_id, appointment_version, reminder_kind, channel, due_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  reminder.run("job-one", "t1", "a1", 1, "24h", "email", "2026-09-28T15:00:00.000Z");
  reminder.run("job-two", "t1", "a1", 1, "24h", "email", "2026-09-28T15:00:00.000Z");
  assert.equal(db.prepare("SELECT count(*) AS count FROM appointment_reminder_jobs WHERE appointment_id = 'a1'").get().count, 1);
  db.close();
});

test("manager can reschedule a visible team appointment using its owner's availability", async () => {
  const store = new MemoryBookingStore();
  store.sharedAppointmentAccess.add("manager-1:owner-1");
  const booked = await bookAppointment(store, { member_tenant_id: "tenant-1", tenant_id: "tenant-1", user_id: "owner-1", contact_id: "contact-1", starts_at: "2026-09-29T15:00:00.000Z" }, new Date("2026-09-28T14:00:00.000Z"));
  const moved = await rescheduleAppointment(store, { member_tenant_id: "tenant-1", tenant_id: "tenant-1", user_id: "manager-1", appointment_id: booked.id, starts_at: "2026-09-29T16:00:00.000Z" }, new Date("2026-09-28T14:00:00.000Z"));
  assert.equal(moved.owner_user_id, "owner-1");
  assert.equal(moved.version, 2);
  assert.equal(store.availabilityLookups.at(-1), "owner-1");
});

test("manager can cancel a visible team appointment but cannot act outside record scope", async () => {
  const store = new MemoryBookingStore();
  store.sharedAppointmentAccess.add("manager-1:owner-1");
  const booked = await bookAppointment(store, { member_tenant_id: "tenant-1", tenant_id: "tenant-1", user_id: "owner-1", contact_id: "contact-1", starts_at: "2026-09-29T15:00:00.000Z" }, new Date("2026-09-28T14:00:00.000Z"));
  await assert.rejects(cancelAppointment(store, { member_tenant_id: "tenant-1", tenant_id: "tenant-1", user_id: "manager-2", appointment_id: booked.id }), { status: 404 });
  await cancelAppointment(store, { member_tenant_id: "tenant-1", tenant_id: "tenant-1", user_id: "manager-1", appointment_id: booked.id });
  assert.equal(store.appointments.get(booked.id).status, "cancelled");
});