# NectCon CRM

This repository contains the NectCon private Sites application. `/` opens the existing demonstration workspace. `/foundation` is the persistent CRM foundation backed by Cloudflare D1.

The foundation includes organizations, contacts, companies, tasks, pipelines, notes, membership checks, and an append-only audit trail. Database schema and initial migration are in `db/schema.ts` and `drizzle/`. The Sales Dialer demonstration includes a collapsible number pad and movable call script; calls remain disabled until Twilio is connected.

Run `npm ci` and `npm run build`. After schema changes, regenerate the migration. The hosted Site is owner-private. Customer identity and invitations are not yet implemented. Do not onboard external companies until that access model is complete.

See `../docs/FOUNDATION_AND_INTEGRATIONS.md` for the rollout and provider requirements.
