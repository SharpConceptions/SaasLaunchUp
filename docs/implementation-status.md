# Implementation Status

Updated: 2026-09-25

Status meanings follow `docs/product-blueprint.md`: Not started, UI only, Backend exists, Integrated, Verified. `Verified` requires a real tenant walkthrough, permissions, failure handling, automated critical-path tests, and reproducible runtime evidence. No feature below is marked Verified based only on source inspection or local tests.

## Navigation inventory

| Workspace | Route and backend | Data and dependencies | Status and evidence | Next task |
| --- | --- | --- | --- | --- |
| Funnels & Automation | `/workspace`; `/api/v1/forms/:siteId`; CRM automation rules at `/api/crm?resource=automation-rules` | `website_connections`, `website_form_events`, contacts, opportunities, tasks, `pipeline_automation_rules`; website key for intake | Integrated form intake: [app/api/v1/forms/[siteId]/route.ts](../app/api/v1/forms/%5BsiteId%5D/route.ts) and [lib/website-forms.ts](../lib/website-forms.ts). Automation rules save as drafts and remain paused. | Exercise form intake with a deployed tenant; add reviewed automation runner only with delivery and suppression controls. |
| Sales | `/workspace`, `/foundation`; `/api/crm`, `/api/sales-dashboard` | Contacts, companies, pipelines, stages, opportunities, tasks, notes, audit events; Cloudflare Access identity | Integrated CRM persistence and tenant/role checks: [app/api/crm/route.ts](../app/api/crm/route.ts), [app/api/sales-dashboard/route.ts](../app/api/sales-dashboard/route.ts), [app/foundation/page.tsx](../app/foundation/page.tsx). Sales dialer remains disabled. | Verify multiple roles and record scopes against live tenant data. |
| Marketing | `/workspace`; `/api/marketing`, `/api/marketing-scan`, `/api/templates` | `marketing_documents`, templates, consent/suppression records; no outbound provider delivery | Backend exists for saved drafts and owned-page markup scans: [app/api/marketing/route.ts](../app/api/marketing/route.ts), [app/api/marketing-scan/route.ts](../app/api/marketing-scan/route.ts). Sending and publishing are not connected. | Add provider adapters and consent/suppression enforcement as separate slices. |
| Customer service | `/workspace`; `/api/service` | `service_tickets`, CRM contacts, audit events | Backend exists for persisted service records: [app/api/service/route.ts](../app/api/service/route.ts). External inbox and provider notifications are not connected. | Verify ticket workflow and linked improvement-task flow. |
| Calendars | `/workspace` Calendar, Booking pages, Availability, Appointments; `/api/appointments` | `appointment_availability`, `appointments`, `appointment_reminder_jobs`, CRM contacts/opportunities, activities, audit events; no external calendar/email/SMS provider | Integrated in isolated staging: availability, CRM-linked booking, duplicate rejection, rescheduling, cancellation, dry-run job states, and cross-tenant denial were exercised through the Access-protected Worker and UI. Evidence: [app/api/appointments/route.ts](../app/api/appointments/route.ts), [lib/appointments.ts](../lib/appointments.ts), [public/views.js](../public/views.js), [db/schema.ts](../db/schema.ts), [drizzle/0016_robust_veda.sql](../drizzle/0016_robust_veda.sql), [tests/appointments.test.mjs](../tests/appointments.test.mjs). Manager mutation scope has automated coverage but was not tested with a second live staging identity, so this navigation item is not marked Verified. | Test manager operations with a second staging identity; add external calendar sync separately. |
| Ads | `/workspace`; no connected campaign backend | No ad-account data model/provider integration evidenced for live campaign operations | UI only; [public/views.js](../public/views.js) presents a preview and states accounts are not connected. | Implement read-only provider reporting before any campaign changes. |
| Sites & content | `/workspace`; `/api/website-connections`, `/api/v1/forms/:siteId` | `website_connections`, form events, CRM contacts/opportunities; domain/site publishing provider not verified | Integrated website form intake; a production website-builder/publishing workflow is not verified. See [app/api/website-connections/route.ts](../app/api/website-connections/route.ts) and [app/api/v1/forms/[siteId]/route.ts](../app/api/v1/forms/%5BsiteId%5D/route.ts). | Verify a full published-site-to-CRM workflow and record its deployment evidence. |

## Demo booking slice

- Availability is a per-tenant, per-owner weekly schedule with an IANA timezone and appointment duration. Booking timestamps are stored as UTC instants; invalid zones, past times, out-of-window times, and tenant-mismatched records are rejected.
- Appointments require a visible CRM contact and may reference a tenant- and scope-visible opportunity. Booking, rescheduling, and cancellation append CRM activity and audit records.
- Overlap checks run in the service and are also enforced by SQLite insert/update triggers, scoped to a tenant and appointment owner. Back-to-back appointments are allowed.
- Reminder jobs use the blueprint's confirmation and 24-hour/4-hour/15-minute schedule, omit elapsed reminders, and have a unique appointment/version/kind/channel key. Reschedule advances the version and skips old jobs; cancellation skips outstanding jobs. Status is `dry_run`; there is no sender or job dispatcher in this slice.
- Appointment mutations use the same tenant/record-scope visibility as appointment listing. Managers can reschedule/cancel visible team or organization appointments while availability and collision checks remain tied to the appointment owner. Lifecycle audit/activity identifiers are deterministic per appointment version to avoid duplicate entries on retries.
- Reschedule jobs and lifecycle logs are inserted only when the appointment remains booked at the expected new version inside the D1 batch. A concurrent cancellation therefore cannot leave orphaned reminder jobs or a false reschedule audit event.
- Existing form intake routes and payloads are unchanged. CRM contact deletion now cleans linked appointment jobs and records; private API opportunity deletion unlinks appointments before deleting the opportunity.

## Staging walkthrough evidence

- Isolated Worker: `saaslaunchupcrm-staging`; custom domain `staging.saaslaunchup.com` remains behind the existing Cloudflare Access owner allowlist. The production apex remains attached to `saaslaunchupcrm`.
- Isolated D1: `saaslaunchup-staging` (`02d7282f-339e-4587-91c6-1ef085250113`); migration ledger reports no pending migrations through `0016_robust_veda.sql`. The production D1 was not modified.
- A staging-only organization and contacts were created through the authenticated CRM API. Live UI/API checks: book returned `201`; duplicate slot returned `409`; UI reschedule incremented the appointment version and invalidated the old schedule; cancel marked it cancelled and skipped remaining jobs; an unknown tenant returned `403`.
- A concurrent staging reschedule/cancel check returned `409` for the stale reschedule and `200` for cancellation; the final appointment was cancelled, all seven existing jobs were skipped, and no stale-version jobs were created.
- Website form intake returned `201` for a new staging lead and `200` with `duplicate: true` on retry with the same idempotency key. The generated website API key remained in the browser execution context and was not written to this document.
- All reminder rows remained `dry_run`; no email, SMS, calling, payment, or external calendar delivery was attempted.

## Test and build evidence

- `npm test`: 15 tests passed, 0 failed on 2026-09-25. Covers availability/timezone and closing boundaries, overlap boundaries, booking, manager/owner reschedule and cancellation scopes, stale reschedule cancellation races, tenant isolation, deterministic duplicate reminder jobs, and SQLite migration triggers/unique constraints.
- `npx eslint app/api/crm/route.ts 'app/api/v1/private/[resource]/route.ts' app/api/appointments/route.ts lib/appointments.ts db/schema.ts public/views.js tests/appointments.test.mjs`: 0 errors; two existing unused-variable warnings in `public/views.js` (`renderCompanies`, `dashboardTenantId`).
- `npm run build`: passed and includes `/api/appointments`.
- `npx tsc --noEmit --pretty false`: appointment changes type-check; the command still reports three existing WebCrypto/JWK typing errors in `lib/access-identity.ts` (`JsonWebKey.kid` and `BufferSource` compatibility).
- No deployed authenticated booking walkthrough has been performed for this change. The slice is not Verified.

## Provider and delivery boundaries

This work does not send email or SMS, place calls, charge or process payments, or synchronize an external calendar. Reminder rows are dry-run records only. The existing Twilio credential verification is not evidence of calling or SMS delivery. Do not describe any of those provider operations as working until a real integration has been tested end to end.
