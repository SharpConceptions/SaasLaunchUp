import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tenantId = "11111111-1111-4111-8111-111111111111";
const otherTenantId = "22222222-2222-4222-8222-222222222222";
const ownerId = "route-test-owner";
const repId = "route-test-rep";
const managerId = "route-test-manager";
const outOfScopeManagerId = "route-test-other-manager";
const otherTenantUserId = "route-test-other-owner";
const ownerContactId = "33333333-3333-4333-8333-333333333333";
const teamContactId = "44444444-4444-4444-8444-444444444444";
const uiContactId = "55555555-5555-4555-8555-555555555555";
let tempRoot;
let persistPath;
let configPath;
let baseUrl;
let worker;
let browser;
let appointments = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args.join(" ")} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function identityHeaders(userId = ownerId) {
  return {
    Origin: baseUrl,
    "Content-Type": "application/json",
    "oai-authenticated-user-id": userId,
    "oai-authenticated-user-email": `${userId}@example.test`,
  };
}

async function api(resource, { userId = ownerId, method = "GET", body, tenant = tenantId } = {}) {
  const url = new URL(resource, baseUrl);
  if (tenant) url.searchParams.set("tenant_id", tenant);
  const response = await fetch(url, {
    method,
    headers: method === "GET" ? {
      "oai-authenticated-user-id": userId,
      "oai-authenticated-user-email": `${userId}@example.test`,
    } : identityHeaders(userId),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function book(userId, contactId, startsAt) {
  return api("/api/appointments", {
    userId,
    method: "POST",
    body: { action: "book", tenant_id: tenantId, contact_id: contactId, starts_at: startsAt },
  });
}

function nextTuesdayAt(hour = 15) {
  const date = new Date();
  const daysUntilTuesday = (2 - date.getUTCDay() + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilTuesday);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

async function readRows(resource, userId = ownerId) {
  return api(`/api/appointments?resource=${resource}`, { userId });
}

before(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "saaslaunchup-appointments-test-"));
  persistPath = path.join(tempRoot, "d1");
  const env = { ...process.env };
  delete env.CF_ACCESS_AUD;
  delete env.CF_ACCESS_TEAM_DOMAIN;
  Object.assign(env, {
    CLOUDFLARE_WORKER_NAME: "saaslaunchup-route-test",
    SAASLAUNCHUP_D1_DATABASE_NAME: "saaslaunchup-route-test",
    SAASLAUNCHUP_D1_DATABASE_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  if (process.env.APPOINTMENT_TEST_SKIP_BUILD !== "1") run(process.execPath, ["scripts/run-framework.mjs", "build"], { env });

  const serverDir = path.join(root, "dist", "server");
  const config = JSON.parse(await readFile(path.join(serverDir, "wrangler.json"), "utf8"));
  config.name = "saaslaunchup-route-test";
  config.workers_dev = false;
  delete config.vars;
  config.d1_databases = config.d1_databases.map(binding => ({
    ...binding,
    database_name: "saaslaunchup-route-test",
    database_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }));
  configPath = path.join(serverDir, "appointments-test.wrangler.json");
  await writeFile(configPath, JSON.stringify(config, null, 2));

  const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  const configArgs = ["--config", configPath, "--local", "--persist-to", persistPath];
  run(process.execPath, [wrangler, "d1", "migrations", "apply", "saaslaunchup-route-test", ...configArgs]);

  const seed = `
    INSERT INTO organizations (id, name, timezone) VALUES ('${tenantId}', 'Appointment Route Test', 'UTC');
    INSERT INTO organizations (id, name, timezone) VALUES ('${otherTenantId}', 'Other Route Test', 'UTC');
    INSERT INTO users (id, email) VALUES ('${ownerId}', 'owner@example.test');
    INSERT INTO users (id, email) VALUES ('${repId}', 'rep@example.test');
    INSERT INTO users (id, email) VALUES ('${managerId}', 'manager@example.test');
    INSERT INTO users (id, email) VALUES ('${outOfScopeManagerId}', 'other-manager@example.test');
    INSERT INTO users (id, email) VALUES ('${otherTenantUserId}', 'other-owner@example.test');
    INSERT INTO teams (id, tenant_id, name) VALUES ('team-route-a', '${tenantId}', 'Route Test Team');
    INSERT INTO teams (id, tenant_id, name) VALUES ('team-route-b', '${tenantId}', 'Other Route Team');
    INSERT INTO memberships (id, tenant_id, user_id, team_id, role, record_scope) VALUES ('mem-owner', '${tenantId}', '${ownerId}', NULL, 'business_owner', 'organization');
    INSERT INTO memberships (id, tenant_id, user_id, team_id, role, record_scope) VALUES ('mem-rep', '${tenantId}', '${repId}', 'team-route-a', 'sales_representative', 'own');
    INSERT INTO memberships (id, tenant_id, user_id, team_id, role, record_scope) VALUES ('mem-manager', '${tenantId}', '${managerId}', 'team-route-a', 'sales_manager', 'team');
    INSERT INTO memberships (id, tenant_id, user_id, team_id, role, record_scope) VALUES ('mem-other-manager', '${tenantId}', '${outOfScopeManagerId}', 'team-route-b', 'sales_manager', 'team');
    INSERT INTO memberships (id, tenant_id, user_id, team_id, role, record_scope) VALUES ('mem-other-tenant', '${otherTenantId}', '${otherTenantUserId}', NULL, 'business_owner', 'organization');
    INSERT INTO pipelines (id, tenant_id, name) VALUES ('pipe-route-a', '${tenantId}', 'Route Test Pipeline');
    INSERT INTO stages (id, tenant_id, pipeline_id, name, position) VALUES ('stage-route-a', '${tenantId}', 'pipe-route-a', 'Qualified', 0);
    INSERT INTO contacts (id, tenant_id, name, email, lifecycle_stage, pipeline_id, stage_id, owner_user_id) VALUES ('${ownerContactId}', '${tenantId}', 'Owner Contact', 'owner-contact@example.test', 'Qualified', 'pipe-route-a', 'stage-route-a', '${ownerId}');
    INSERT INTO contacts (id, tenant_id, name, email, lifecycle_stage, pipeline_id, stage_id, owner_user_id) VALUES ('${teamContactId}', '${tenantId}', 'Team Contact', 'team-contact@example.test', 'Qualified', 'pipe-route-a', 'stage-route-a', '${repId}');
    INSERT INTO contacts (id, tenant_id, name, email, lifecycle_stage, pipeline_id, stage_id, owner_user_id) VALUES ('${uiContactId}', '${tenantId}', 'Playwright Booking Contact', 'ui-contact@example.test', 'Qualified', 'pipe-route-a', 'stage-route-a', '${ownerId}');
    INSERT INTO appointment_availability (id, tenant_id, owner_user_id, timezone, duration_minutes, windows_json) VALUES ('avail-route-rep', '${tenantId}', '${repId}', 'UTC', 30, '[{"weekday":2,"start":"09:00","end":"17:00"}]');
  `;
  run(process.execPath, [wrangler, "d1", "execute", "saaslaunchup-route-test", ...configArgs, "--command", seed]);

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  worker = spawn(process.execPath, [
    wrangler, "dev", "--config", configPath, "--local", "--persist-to", persistPath,
    "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0",
    "--show-interactive-dev-session", "false", "--log-level", "error",
  ], { cwd: root, env: { ...env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  worker.stdout.on("data", chunk => { logs += chunk.toString(); });
  worker.stderr.on("data", chunk => { logs += chunk.toString(); });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (worker.exitCode !== null) throw new Error(`Wrangler dev exited before ready:\n${logs}`);
    try {
      const response = await fetch(`${baseUrl}/api/crm?resource=organizations`, { headers: identityHeaders(ownerId) });
      if (response.status === 200) { ready = true; break; }
    } catch {}
    await delay(250);
  }
  if (!ready) throw new Error(`Wrangler dev did not become ready:\n${logs}`);

  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (worker && worker.exitCode === null) {
    const exited = new Promise(resolve => worker.once("exit", resolve));
    worker.kill("SIGINT");
    await Promise.race([exited, delay(5000)]);
  }
  if (configPath) await rm(configPath, { force: true });
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
});

test("real appointment route persists booking, deduplicates overlap, enforces scopes, and records CRM audit", async () => {
  const windows = [{ weekday: 2, start: "09:00", end: "17:00" }];
  const ownerAvailability = await api("/api/appointments", { userId: ownerId, method: "POST", body: { action: "set_availability", tenant_id: tenantId, timezone: "UTC", duration_minutes: 30, windows } });
  const repAvailability = await api("/api/appointments", { userId: repId, method: "POST", body: { action: "set_availability", tenant_id: tenantId, timezone: "UTC", duration_minutes: 30, windows } });
  assert.equal(ownerAvailability.status, 200);
  assert.equal(repAvailability.status, 403);

  const slot = nextTuesdayAt(15);
  const booked = await book(repId, teamContactId, slot);
  assert.equal(booked.status, 201);
  assert.equal(booked.body.appointment.status, "booked");
  appointments.push(booked.body.appointment.id);

  const duplicate = await book(repId, teamContactId, slot);
  assert.equal(duplicate.status, 409);

  const visibleToManager = await readRows("appointments", managerId);
  assert.equal(visibleToManager.status, 200);
  assert.ok(visibleToManager.body.items.some(item => item.id === booked.body.appointment.id), `Manager could not see team appointment (${visibleToManager.status}): ${JSON.stringify(visibleToManager.body)}`);

  const hiddenFromOtherManager = await api(`/api/appointments?resource=appointments`, { userId: outOfScopeManagerId });
  assert.equal(hiddenFromOtherManager.status, 200);
  assert.ok(!hiddenFromOtherManager.body.items.some(item => item.id === booked.body.appointment.id));

  const managerReschedule = await api("/api/appointments", { userId: managerId, method: "POST", body: { action: "reschedule", tenant_id: tenantId, appointment_id: booked.body.appointment.id, starts_at: nextTuesdayAt(16) } });
  assert.equal(managerReschedule.status, 200);
  assert.equal(managerReschedule.body.appointment.version, 2);
  assert.equal(managerReschedule.body.appointment.owner_user_id, repId);

  const outOfScopeCancel = await api("/api/appointments", { userId: outOfScopeManagerId, method: "POST", body: { action: "cancel", tenant_id: tenantId, appointment_id: booked.body.appointment.id } });
  assert.equal(outOfScopeCancel.status, 404);

  const wrongTenant = await api(`/api/appointments?resource=appointments`, { userId: otherTenantUserId, tenant: tenantId });
  assert.equal(wrongTenant.status, 403);

  const jobsAfterMove = (await readRows("appointments", ownerId)).body.reminder_jobs.filter(job => job.appointment_id === booked.body.appointment.id);
  assert.ok(jobsAfterMove.some(job => job.appointment_version === 1 && job.status === "skipped"));
  assert.ok(jobsAfterMove.some(job => job.appointment_version === 2 && job.status === "dry_run"));
  assert.ok(jobsAfterMove.every(job => job.status === "dry_run" || job.status === "skipped"));

  const cancelled = await api("/api/appointments", { userId: ownerId, method: "POST", body: { action: "cancel", tenant_id: tenantId, appointment_id: booked.body.appointment.id } });
  assert.equal(cancelled.status, 200);
  const final = await readRows("appointments", ownerId);
  assert.equal(final.body.items.find(item => item.id === booked.body.appointment.id).status, "cancelled");
  assert.ok(final.body.reminder_jobs.filter(job => job.appointment_id === booked.body.appointment.id).every(job => job.status === "skipped"));
  const audit = await api("/api/crm?resource=audit", { userId: ownerId });
  assert.equal(audit.status, 200);
  assert.ok(audit.body.items.some(item => item.target_type === "appointment" && item.target_id === booked.body.appointment.id && item.kind === "appointment.booked"));
  assert.ok(audit.body.items.some(item => item.target_type === "appointment" && item.target_id === booked.body.appointment.id && item.kind === "appointment.rescheduled"));
  assert.ok(audit.body.items.some(item => item.target_type === "appointment" && item.target_id === booked.body.appointment.id && item.kind === "appointment.cancelled"));
});

test("concurrent booking requests cannot double-book a slot in the D1 route", async () => {
  const slot = nextTuesdayAt(14);
  const results = await Promise.all([book(ownerId, ownerContactId, slot), book(ownerId, ownerContactId, slot)]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const created = results.find(result => result.status === 201).body.appointment;
  appointments.push(created.id);
  const cancelled = await api("/api/appointments", { userId: ownerId, method: "POST", body: { action: "cancel", tenant_id: tenantId, appointment_id: created.id } });
  assert.equal(cancelled.status, 200);
});

test("concurrent cancellation and reschedule leave no active jobs on a cancelled appointment", async () => {
  const booked = await book(ownerId, ownerContactId, nextTuesdayAt(13));
  assert.equal(booked.status, 201);
  const appointmentId = booked.body.appointment.id;
  appointments.push(appointmentId);
  const [reschedule, cancel] = await Promise.all([
    api("/api/appointments", { userId: ownerId, method: "POST", body: { action: "reschedule", tenant_id: tenantId, appointment_id: appointmentId, starts_at: nextTuesdayAt(12) } }),
    api("/api/appointments", { userId: ownerId, method: "POST", body: { action: "cancel", tenant_id: tenantId, appointment_id: appointmentId } }),
  ]);
  assert.ok([200, 409].includes(reschedule.status));
  assert.ok([200, 404].includes(cancel.status));
  const state = await readRows("appointments", ownerId);
  const row = state.body.items.find(item => item.id === appointmentId);
  const jobs = state.body.reminder_jobs.filter(job => job.appointment_id === appointmentId);
  if (row.status === "cancelled") assert.ok(jobs.every(job => job.status === "skipped"));
  else {
    assert.equal(row.status, "booked");
    assert.equal(row.version, 2);
    assert.ok(jobs.filter(job => job.appointment_version === 1).every(job => job.status === "skipped"));
    assert.ok(jobs.filter(job => job.appointment_version === 2).every(job => job.status === "dry_run"));
  }
});

test("Playwright covers availability, booking, visible collision errors, reschedule, and cancel", async () => {
  const page = await browser.newPage();
  const browserEvents = [];
  page.on("pageerror", error => browserEvents.push(`pageerror: ${error.message}`));
  page.on("requestfailed", request => browserEvents.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  page.on("response", async response => {
    if (!response.url().includes("/api/")) return;
    browserEvents.push(`response: ${response.status()} ${response.url()} ${(await response.text()).slice(0, 300)}`);
  });
  await page.route(`${baseUrl}/api/**`, route => route.continue({ headers: {
    ...route.request().headers(),
    "oai-authenticated-user-id": ownerId,
    "oai-authenticated-user-email": "owner@example.test",
  } }));
  try {
    await page.goto(`${baseUrl}/workspace`);
    await page.evaluate(() => document.addEventListener("submit", event => { window.__appointmentTestSubmit = event.target?.id; }, true));
    await page.getByRole("button", { name: "Calendars" }).click();
    await page.getByRole("button", { name: "Availability" }).click();
    await page.getByLabel("IANA timezone").fill("UTC");
    const tuesday = page.locator('input[name="weekday"][value="2"]');
    await tuesday.check();
    assert.equal(await tuesday.isChecked(), true);
    await page.getByRole("button", { name: "Save availability" }).click();
    await assert.doesNotReject(() => page.getByRole("status").filter({ hasText: "Availability saved." }).waitFor());
    const savedAvailability = await api("/api/appointments?resource=availability", { userId: ownerId });
    assert.equal(savedAvailability.status, 200);
    assert.deepEqual(savedAvailability.body.availability.windows.map(window => window.weekday), [2]);

    await page.getByRole("button", { name: "Booking pages" }).click();
    await page.getByRole("heading", { name: "Demo appointments" }).waitFor();
    await page.getByLabel("CRM contact").selectOption(uiContactId);
    const initial = nextTuesdayAt(11).slice(0, 16);
    await page.getByLabel(/Start time/).fill(initial);
    await delay(150);
    const bookingFormState = await page.locator("#appointment-booking-form").evaluate(form => ({
      valid: form.checkValidity(),
      fields: [...new FormData(form).entries()],
      buttonDisabled: form.querySelector('button[type="submit"]').disabled,
      invalid: [...form.elements].filter(element => !element.validity.valid).map(element => ({ name: element.name, value: element.value, message: element.validationMessage })),
    }));
    assert.equal(bookingFormState.valid, true, JSON.stringify(bookingFormState));
    assert.equal(bookingFormState.buttonDisabled, false, JSON.stringify(bookingFormState));
    assert.ok(bookingFormState.fields.some(([name, value]) => name === "contact_id" && value === uiContactId), JSON.stringify(bookingFormState));
    assert.ok(bookingFormState.fields.some(([name, value]) => name === "starts_at" && value === initial), JSON.stringify(bookingFormState));
    await page.evaluate(() => { window.__appointmentTestSubmit = undefined; });
    const bookingResponse = page.waitForResponse(response => response.url().includes("/api/appointments?tenant_id=") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Book demo" }).click();
    const bookingResult = await bookingResponse;
    assert.equal(bookingResult.status(), 201, await bookingResult.text());
    await page.waitForFunction(() => document.body.innerText.includes("Demo appointment · Playwright Booking Contact"), null, { timeout: 10000 }).catch(() => {});
    const afterBooking = await page.locator("body").innerText();
    const submittedForm = await page.evaluate(() => window.__appointmentTestSubmit || "no submit event");
    assert.ok(afterBooking.includes("Demo appointment · Playwright Booking Contact"), `UI booking did not appear (submit=${submittedForm}):\n${afterBooking}\nBrowser events:\n${browserEvents.join("\n")}`);

    await page.getByLabel("CRM contact").selectOption(uiContactId);
    await page.getByLabel(/Start time/).fill(initial);
    await page.getByRole("button", { name: "Book demo" }).click();
    await page.getByRole("status").filter({ hasText: "That time is already booked." }).waitFor();

    const appointmentForm = page.locator("form.appointment-reschedule-form").first();
    await appointmentForm.locator('input[name="starts_at"]').fill(nextTuesdayAt(12).slice(0, 16));
    await appointmentForm.getByRole("button", { name: "Reschedule" }).click();
    await page.getByText(/Demo rescheduled\./).waitFor();
    await page.locator("form.appointment-reschedule-form").first().getByRole("button", { name: "Cancel" }).click();
    await page.getByText(/Demo cancelled\./).waitFor();
    await page.getByText("Reminder schedule is dry-run only.").waitFor();
  } finally {
    await page.close();
  }
});

test("connection API reports providers disconnected and OAuth fails closed without app registration secrets", async () => {
  const response = await fetch(`${baseUrl}/api/integrations?tenant_id=${tenantId}`, { headers: { ...identityHeaders(ownerId) } });
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.twilio.connected, false);
  assert.equal(status.stripe.connected, false);
  assert.equal(status.email.connected, false);
  assert.ok(Object.values(status.oauth_providers).every(provider => provider.configured === false));
  assert.ok(!JSON.stringify(status).includes("client_secret"));

  const start = await fetch(`${baseUrl}/api/integrations/oauth`, {
    method: "POST", headers: identityHeaders(ownerId),
    body: JSON.stringify({ action: "start", tenant_id: tenantId, provider: "meta" }),
  });
  assert.equal(start.status, 503);
  assert.match((await start.json()).error, /not configured/);
});

test("Playwright connection page makes providers clickable and states setup truthfully", async () => {
  const page = await browser.newPage();
  await page.route(`${baseUrl}/api/**`, route => route.continue({ headers: {
    ...route.request().headers(),
    "oai-authenticated-user-id": ownerId,
    "oai-authenticated-user-email": "owner@example.test",
  } }));
  try {
    await page.goto(`${baseUrl}/workspace`);
    await page.getByRole("button", { name: /Open profile menu/ }).click();
    await page.getByRole("menuitem", { name: "API connections" }).click();
    await page.getByRole("heading", { name: "API connections" }).waitFor();
    await page.locator(".connection-card").first().waitFor({ timeout: 15000 });
    const cardCount = await page.locator(".connection-card").count();
    assert.equal(cardCount, 12, `Expected 12 connection cards, found ${cardCount}:\n${(await page.locator("main").innerText()).slice(0,1600)}`);

    await page.getByRole("button", { name: "Social & ads" }).click();
    await page.getByLabel("Search connections").fill("LinkedIn");
    assert.deepEqual(await page.locator(".connection-card h2").allTextContents(), ["LinkedIn"]);
    await page.locator(".connection-card").filter({ has: page.getByRole("heading", { name: "LinkedIn" }) }).getByRole("button", { name: "Connection details" }).click();
    await page.getByRole("heading", { name: "OAuth app setup required" }).waitFor();
    const linkedinDetails = await page.locator("#integration-detail-content").innerText();
    assert.match(linkedinDetails, /client ID and client secret/i, linkedinDetails);
    assert.match(linkedinDetails, /api\/integrations\/oauth\?callback=1&provider=linkedin/, linkedinDetails);
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByLabel("Search connections").fill("");
    await page.getByRole("button", { name: "All" }).click();
    await page.locator(".connection-card").filter({ has: page.getByRole("heading", { name: "Stripe" }) }).getByRole("button", { name: "Connect account" }).click();
    await page.getByLabel("Stripe secret key").waitFor();
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "Domains & sites" }).click();
    await page.locator(".connection-card").filter({ has: page.getByRole("heading", { name: "Domains & DNS" }) }).getByRole("button", { name: "Domain options" }).click();
    await page.getByText("Use any domain you own", { exact: false }).waitFor();
    await page.getByText(/Any domain you own can be used/).waitFor();
  } finally {
    await page.close();
  }
});
