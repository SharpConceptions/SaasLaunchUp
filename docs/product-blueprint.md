# SaaS Launchup: product blueprint and build checkpoints

Version: working draft, September 25, 2026

## Product promise

SaaS Launchup helps a SaaS company see and improve its entire customer journey in one place. It captures what people do across acquisition, the website, sales, trial, product use, support, renewal, and referrals; turns that evidence into prioritized actions; and lets the team execute those actions from the same workspace.

**The operating loop:** capture an event → connect it to a person/account and journey phase → show a metric and its evidence → recommend or create an action → execute it → measure its result. A dashboard card is complete only if its underlying data and next action work.

**Product boundary:** The customer journey is the organizing model. Sales, marketing, funnels, calendars, ads, support, and site building are workspaces that create or act on journey data. Customers may skip, repeat, or move backward between phases; phase labels are a useful reporting model, not a rigid funnel.

## Journey dashboard

The top-level journey views are Awareness, Consideration, Purchase, Experience, and Loyalty & Advocacy. Within the last view, show separate loyalty and advocacy panels so referrals do not get mistaken for retention.

| View | Questions to answer | Initial signals and measures | Action from the view |
| --- | --- | --- | --- |
| Awareness | Where are we found, and which sources bring qualified visitors? | Search Console impressions, clicks, CTR, position by query/page; referred visits, UTM source, paid reach; discovered brand mentions with source links. Distinguish search performance from site traffic and mentions. | Improve an underperforming page, make a content brief, create an ad or outreach task. |
| Consideration | Which content and forms move visitors toward a trial or demo? | Landing-page views, engaged sessions, CTA views/clicks, form starts/submits, demos booked. Compute `form completion = unique submitted forms / unique form starts`; show step and field exit rates when instrumented. | Propose a copy/layout experiment, edit a page, follow up on an opt-in lead. |
| Purchase | What happens from intent through signup, trial, and payment? | Signup started/completed, trial started, activation milestone reached, checkout started/completed, trial-to-paid, failed payments, reasons supplied for nonpurchase. Compute `trial-to-paid = paid conversions in a defined trial cohort / eligible trial starts in that cohort`. | Recover an abandoned checkout or assign a sales task with eligible contact permissions. |
| Experience | Can users get value, and what is blocking them? | Feature use, session duration with idle handling, errors, support requests, first response/resolution, onboarding steps, demo and follow-up outcomes, explicit feedback. | Create a support case, bug, onboarding improvement, or approved follow-up sequence. |
| Loyalty & Advocacy | Do customers stay and recommend us? | Renewal, retention/churn by cohort, active accounts, expansion, education engagement, referrals, reviews and testimonials with permission. | Launch education or appreciation, request a review/referral when appropriate, create a save task. |

**Phase boundary:** In-app usage and errors begin in the trial/purchase decision and continue through experience and loyalty. Record each event once and display it in the relevant view. Do not treat a page exit as proof of why someone left; label it as observed behavior, and use feedback, interviews, support notes, or experiments to test explanations. Show the numerator, denominator, cohort, period, timezone, source, and last sync for every rate.

## Existing navigation and what each area does

| Workspace | Current sections to preserve | Role in the shared journey |
| --- | --- | --- |
| Funnels & Automation | Funnels, Landing pages, Forms & assessments, Automations, Run history | Build capture paths; emit visitor/form events; trigger reviewed workflows with traceable runs. |
| Sales | My dashboard, Contacts, Pipeline, Tasks, Calls, Import contacts | Qualify leads, manage demos/deals, log calls and outcomes, move contacts through opportunities. A dialer is a later capability after contact permissions, provider integration, and call logging. |
| Marketing | Email marketing, Email templates, Email inbox, Email consent, Idea board, Media studio, SEO · GEO · AEO scan, Blog studio, Social Media | Turn one idea into channel-specific drafts, approvals, publishing, engagement and campaign results. Consent applies by channel and purpose; cold outreach needs its own eligibility rules and suppression controls. |
| Customer service | Cancellation requests, Billing overview, Billing issues, Bug reports, Reviews, Requests, Response inbox, Widgets | Unite customer conversations, record outcomes and feedback reasons, create product/sales/marketing tasks with links to evidence. |
| Calendars | Calendar, Booking pages, Availability, Appointments | Offer native booking pages, avoid double booking, sync connected Google/Microsoft calendars and later Calendly; trigger confirmations, rescheduling and reminders. |
| Ads | Ad accounts, Campaigns, Attribution, Alerts | Connect advertiser-owned accounts, import spend and results, and later create/pause campaigns with explicit spend limits and approvals. |
| Sites & content | Website builder, CMS, domains, publishing | Publish sites, landing pages, forms and blog content with the same tracking and contact flow. |

**Idea board rule:** An idea has one canonical record and linked derivatives: blog draft, email draft, social post, ad concept, or landing-page experiment. Each derivative owns its content, channel status, approvals, publishing ID, and results. Editing a derivative must not silently overwrite other channels.

## Tracking and data contract

1. A tenant owns its workspaces, users, domains, integrations, contacts, sites, and events. All reads, writes, jobs, and exports enforce tenant isolation and roles.
2. Keep a stable anonymous visitor ID, optional session ID, identified person ID, and account ID. Merge anonymous history after a deliberate identification event; retain provenance and avoid merging on a shared IP address or weak guess.
3. Every event has `event_id`, `tenant_id`, `event_name`, `occurred_at`, `received_at`, `source`, schema version, actor IDs where known, object IDs, properties, and consent basis/flags where applicable. Deduplicate by event ID and preserve raw source references.
4. Provide a first-party website SDK and a server-side event ingestion API with scoped keys, rate limits, payload validation, idempotency, and server-side authorization. A private API alone cannot see actions inside someone else's SaaS: its developer must install an SDK or send events from their backend and explicitly define activation, error, cancellation, and billing events.
5. Initial event vocabulary: `page_viewed`, `cta_clicked`, `form_started`, `form_submitted`, `demo_booked`, `signup_started`, `signup_completed`, `trial_started`, `activation_reached`, `feature_used`, `app_error`, `checkout_started`, `payment_succeeded`, `payment_failed`, `subscription_canceled`, `support_case_opened`, `support_case_resolved`, `email_delivered`, `email_clicked`, `referral_created`. Add properties and validation per event; do not assume email opens are reliable engagement.
6. Define `session` with an inactivity timeout, suppress idle time from duration, and report a landing-page exit or form step abandonment only when the browser supplies enough evidence. Page unload and ad blockers create missing data; show data-quality indicators rather than fabricated precision.
7. Separate facts (`events`, provider reports, support messages) from interpretations (`drop-off hypothesis`, AI summary, inferred churn risk). Store citations back to source events and let a person accept or reject proposed actions.
8. Store integration credentials securely, provide disconnect/revoke, audit sensitive actions, apply retention/deletion policies, and exclude secrets, payment details, and message bodies from analytics events. Respect consent and channel rules in tracking and outreach.

## Key end-to-end workflows

**Visitor to demo:** Publish a landing page → record source and page/CTA/form events → create or link contact → book a slot → sync the appointment → send confirmation → update pipeline → show conversion in consideration/purchase views.

**Trial to paid:** Receive product events from installed SDK/server API → identify the trial and activation milestone → surface onboarding friction and support context → create an approved follow-up task → ingest a billing success event → show cohort conversion and campaign contribution.

**Support to improvement:** Support request or cancellation → agent tags explicit reason, outcome, and affected feature → link any error event → create product task and optional customer follow-up → reflect the issue trend in Experience/Loyalty.

**Idea to published content:** Capture one idea → create channel drafts → review copy and permissions → publish blog to connected site and approved posts to supported social accounts → track each URL/post and associated results.

**Ad to revenue:** Connect an ad account → import campaigns/spend → correlate tagged visits and subsequent conversions within a documented attribution window → propose changes → require approval before any campaign creation, budget change, or launch.

## Website builder scope and sequence

The long-term editor supports a free-form canvas with responsive breakpoints (including 1440/1200 desktop presets, tablet, mobile), stacks, relative/absolute positioning, reusable components, forms, content collections, accessibility guidance, SEO settings, localization, and publish/rollback. Design canvas and published output must be tested at each breakpoint. Basic animations and hover/scroll effects come after the core builder is reliable and accessible.

Start with a constrained page/landing-page editor, forms, domain mapping, versioned publish, a small CMS for blog content, and first-party tracking. Then add flexible layout, reusable components, preview/undo, animation, richer CMS and localization. AI page generation should produce editable drafts that pass through review; an AI agent must never silently publish changes. A global CDN, responsive image formats, caching and compression are infrastructure acceptance targets to measure, not features that can be promised before deployment tests.

**Pricing hypothesis:** free design/draft use with a paid per-site publishing tier; a Pro price near $30/month is a proposal for customer research, not a final commitment. Specify domain purchase/renewal, hosting, seats, traffic, storage, AI credits and overages before publishing a pricing page.

## Integration reality check

- Google Search Console's Search Analytics API supplies verified-property search traffic. It does not provide an unrestricted ranking or all-Internet mention crawler. Begin awareness with first-party site events plus Search Console. Build a separate mentions collector with approved sources, links, deduplication, rate limits and source-specific access rules. Search engine scraping and Reddit content collection need separate feasibility reviews. [Google Search Console API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [Reddit Data API Terms](https://redditinc.com/policies/data-api-terms)
- Google Ads, Meta Marketing API and Reddit Ads API support programmatic advertising, subject to their account, authorization and policy requirements. Ship read-only reporting first, then controlled editing and launch. [Google Ads API](https://developers.google.com/google-ads/api/docs/get-started/introduction), [Meta Marketing API](https://developers.facebook.com/documentation/ads-commerce/marketing-api/overview.md/), [Reddit Ads API](https://ads-api.reddit.com/docs/v3/)
- Google Calendar and Microsoft Graph support calendar events; booking availability, timezone handling, double-booking prevention, and two-way sync require application logic. Treat Calendly as a separate adapter. [Google Calendar API](https://developers.google.com/workspace/calendar/api/guides/overview), [Microsoft Graph events](https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0)
- SEO scoring can use owned-page crawls and Search Console. GEO/AEO scans should report specific inspectable findings and test methods rather than claim to measure universal AI-answer rankings. A Semrush integration, if selected, is an optional paid provider dependency; do not base core reporting on an assumed free ranking API.

## Build order and acceptance gates

Track each item as **Not started / UI only / Backend exists / Integrated / Verified**. “Verified” requires real tenant data, permissions, failure handling, an automated test for the critical path, and a short screen recording or reproducible demo. The supplied Ads screenshot is **UI only**: it explicitly says connections and delivery are unavailable. Status elsewhere requires code and runtime inspection.

| Gate | Build slice | Evidence required to mark verified |
| --- | --- | --- |
| 0. Audit | Inventory routes, data models, APIs, jobs, integrations, environment, tests and deployment. Mark every current screen against the five statuses. | Evidence links to code, a running walkthrough, and a gap list; no placeholder is marked integrated. |
| 1. Foundation | Tenants/roles, contact and account identity, event ingestion, consent, audit log, billing event adapter, metrics definitions. | Two tenant test accounts cannot read/write each other's records; duplicate events do not duplicate metrics; delete/export works; a test journey resolves across anonymous and known IDs. |
| 2. Capture and journey MVP | Landing page + form builder, publish, website SDK, Search Console connector, journey tabs with source/period/cohort controls. | A tagged visit → form → demo or trial → activation → payment/support appears once in the right views; each chart shows source and denominator. |
| 3. Operations | Sales pipeline/tasks and demo booking; support inbox/cases; automation rules/run history; email consent and approved sequences. | A lead is booked and followed up without duplicate sends; a failed job retries safely; support outcome creates a linked task; opt-out suppresses sends. |
| 4. Acquisition/content | Idea board derivatives, blog CMS/publishing, SEO audits, social publishing adapters, ad account read-only reporting. | One idea produces reviewed drafts and published content; provider IDs and sync times are visible; ad spend and attributed conversions use documented rules. |
| 5. Advanced creator and ads | Flexible site canvas, animation, AI-assisted drafts, native mentions collector where permitted, ad creation/editing, expanded calendar/social integrations. | Responsive/a11y/publish rollback checks pass; AI changes await review; ad changes respect account authorization and spend approvals; unsupported sources clearly say so. |

**Release rule:** A gate is blocked by broken tenant isolation, inaccurate revenue/conversion figures, unauthorized messaging or spend, missing consent/suppression, untraceable AI claims, or any button that says it succeeded when its provider operation failed.

## Working protocol for Codex, VS Code, and CodeRabbit

Keep this blueprint in the repository as `docs/product-blueprint.md` once the actual repo is available. Maintain `docs/implementation-status.md` with one row per navigation item: status, route, backend endpoint, model/table, external dependency, test, owner, next task. Implement in small vertical slices with migrations, API contract, UI, permissions, observability and a real-path test in the same change. Use CodeRabbit to review each pull request for tenant boundaries, auth, event deduplication, metric denominators, provider retries, accessibility, and misleading UI states; its review does not substitute for a working walkthrough.

**Prompt to start the repo audit:**

> Read `docs/product-blueprint.md`. Inspect the existing repository and running app without assuming visible screens are connected. Create `docs/implementation-status.md` with each navigation item, actual frontend route, backend endpoints, data model, integrations, tests, and status (Not started/UI only/Backend exists/Integrated/Verified). Cite file paths and describe one runnable end-to-end workflow. Do not mark a feature verified without real evidence. Then propose the smallest Gate 1 implementation slice and its acceptance tests.

**Prompt for each build slice:**

> Implement [one named workflow] from the blueprint, end to end. Before coding, list the existing paths and contracts you will reuse. Include migrations, tenant authorization, event/metric definitions, failure and retry behavior, UI loading/empty/error states, and tests for the critical path. Run the relevant checks, update implementation status with evidence, and report the remaining blockers.

## Decisions to settle before implementation

1. Which repository and deployment currently power saslaunchup.com? Provide a repository link or archive and access to a test environment for the Gate 0 audit.
2. Who is the first buyer and operator: solo founder, agency managing several SaaS clients, or an internal SaaS growth team? This determines tenant structure and the first slice.
3. Which systems are sources of truth for identity, billing, email, support, and product events? List the current providers and what is already connected.
4. Define the first SaaS client's activation event, trial length, paid conversion event, churn rule, and preferred attribution window.
5. Which three workflows should be live first? Suggested: landing page → form → booking; trial → activation → payment; support case → linked improvement task.

## Founder decisions received, September 25, 2026

- Repository: `https://github.com/SharpConceptions/SaasLaunchUp`. The checked-out source includes a Sites/Cloudflare D1 application, but a repository clone alone does not prove that the custom domain runs that commit. The current hosted Site ID is recorded in `.openai/hosting.json`; verify the deployment and domain mapping during release audit.
- Initial customer: a solo SaaS founder with one company workspace, one owner, optional collaborators. Agency managers, multiple client workspaces, delegated access, separate client billing, and white-label branding are a later product tier. Keep tenant IDs on data and provider connections from day one; do not force agency configuration into founder onboarding.
- First live workflows: (1) landing page → form → booking; (2) trial → activation → verified payment; (3) support case → linked improvement task; (4) sales call → demo scheduled → immediate email and SMS confirmation → SMS and email 24 hours before → SMS and email 4 hours before → SMS 15 minutes before. The fourth workflow can begin with a manually logged call while live dialing is still gated.

### Recommended sources of truth, to be confirmed per founder

| Domain | Initial source of truth | Integration plan |
| --- | --- | --- |
| SaaS Launchup user identity and tenant membership | Managed customer authentication plus SaaS Launchup D1 membership/roles | Current Cloudflare Access checks protect the owner-private app. Add customer signup/invitations and verified session identity before onboarding outsiders; migrate without weakening current checks. |
| CRM contacts, support, appointments, consent and automation state | SaaS Launchup D1 | Reuse current CRM and ticket models; add customer/appointment links, delivery records, and event/automation ledgers. |
| SaaS Launchup's own subscription billing | Stripe account controlled by SaaS Launchup, if selected | Verify signed webhooks; billing entitlement is driven by provider state, not a manual purchase row. |
| Each customer's SaaS revenue and trial | Their billing provider (Stripe first) or signed server events | Treat customer billing as separate from SaaS Launchup billing. Give each tenant its own connection and configuration. Import verified invoice/subscription events; accept an event adapter for other providers. |
| Outbound email | A transactional email service such as Resend, with a verified sending domain per sender | Track provider ID, delivery/bounce/complaint and unsubscribes. A genuine reply inbox requires inbound email routing, not just a send API. |
| Calling and appointment SMS | Twilio, initially the connection already present in the repo | Add approved sender/number, voice and messaging operations, signed status callbacks, eligibility and suppression checks. A verified credential does not mean the app can dial or text yet. |
| Product activity | Customer-installed first-party SDK plus authenticated server event API | Each founder defines tracked events and identity mapping. SaaS Launchup owns the normalized event ledger and derived metrics. |
| Calendar | SaaS Launchup appointment record and availability rules; connected Google/Microsoft calendars as busy-time and event sync providers | The booking record is authoritative for reminders. External edits/cancellations reconcile back into it before any queued send. |

### Per-tenant journey configuration

At onboarding, ask the founder to name one *activation milestone* (event + qualifying rule), choose a trial mode (none or a duration/actual subscription end date), map a verified paid event, define inactivity and churn rules, set account timezone, and choose an attribution model/window. Supply editable examples: activation = first project created; trial = 14 days; paid = first successful subscription invoice; inactive = no meaningful event for 30 days; churn = canceled subscription at its effective end; attribution = last eligible non-direct touch within 30 days. These are examples, never silently applied across all SaaS products. Save effective dates and versions when definitions change; recalculate or annotate historical metrics. Show `not configured` when an event or provider is missing.

### Appointment reminder specification

| Trigger | Job | Default timing |
| --- | --- | --- |
| Demo booked after a logged call | Create appointment and send confirmation email and SMS after channel eligibility checks | Immediately |
| Appointment approaches | Send SMS and email | 24 hours before start |
| Appointment approaches | Send SMS and email | 4 hours before start |
| Appointment approaches | Send SMS | 15 minutes before start |

Store appointment start as UTC with an IANA timezone for display. Use a durable schedule/queue and one unique `(appointment_id, appointment_version, reminder_kind, channel)` job key. A reschedule increments the version, cancels or invalidates prior jobs, and queues the new schedule; cancellation suppresses all remaining jobs. Never send a reminder after the start, to an opted-out/suppressed recipient, or when the contact's channel eligibility fails. If booking occurs less than 24 or 4 hours before start, omit elapsed reminders rather than send a burst. Show queued, sent, delivered, failed and skipped with provider IDs in Run history. Confirmation and reminders should contain a clear reschedule/cancel path. The suggested timings should be configurable and respect the recipient's timezone and allowed hours; show the owner if a reminder is skipped.

**Next engineering gate:** Implement a real native appointment record and booking flow with calendar collision checks, then an email delivery adapter and audited scheduler, then SMS, and finally click-to-call. The existing dialer remains a preview until calling eligibility and Twilio voice callbacks are implemented. A proof run must cover a booking, a reschedule, a cancellation, a failed provider send, and a suppressed contact.
