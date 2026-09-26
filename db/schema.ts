import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = () => text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(), name: text("name").notNull(), legalName: text("legal_name"),
  primaryDomain: text("primary_domain"), timezone: text("timezone").notNull().default("America/Chicago"),
  status: text("status").notNull().default("active"), createdAt: timestamp(),
});
export const users = sqliteTable("users", {
  id: text("id").primaryKey(), email: text("email"), displayName: text("display_name"), createdAt: timestamp(),
});
export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  name: text("name").notNull(), createdAt: timestamp(),
}, table => [index("idx_teams_tenant").on(table.tenantId)]);
export const memberships = sqliteTable("memberships", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  userId: text("user_id").notNull().references(() => users.id), teamId: text("team_id").references(() => teams.id),
  role: text("role").notNull(), recordScope: text("record_scope").notNull().default("own"),
  status: text("status").notNull().default("active"), createdAt: timestamp(),
}, table => [uniqueIndex("uidx_memberships_tenant_user").on(table.tenantId, table.userId), index("idx_memberships_user").on(table.userId)]);
export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  name: text("name").notNull(), domain: text("domain"), ownerUserId: text("owner_user_id").references(() => users.id),
  researchSummary: text("research_summary"), researchSourceUrl: text("research_source_url"), researchedAt: text("researched_at"),
  createdAt: timestamp(),
}, table => [index("idx_companies_tenant_name").on(table.tenantId, table.name)]);
export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  companyId: text("company_id").references(() => companies.id), name: text("name").notNull(),
  email: text("email"), phone: text("phone"), timezone: text("timezone"), source: text("source"),
  lifecycleStage: text("lifecycle_stage").notNull().default("New lead"),
  pipelineId: text("pipeline_id").references(() => pipelines.id), stageId: text("stage_id").references(() => stages.id),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  createdAt: timestamp(), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("idx_contacts_tenant_owner").on(table.tenantId, table.ownerUserId), index("idx_contacts_tenant_created").on(table.tenantId, table.createdAt)]);
export const consentRecords = sqliteTable("consent_records", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  contactId: text("contact_id").notNull().references(() => contacts.id), channel: text("channel").notNull(),
  status: text("status").notNull(), source: text("source"), wordingVersion: text("wording_version"),
  evidenceJson: text("evidence_json"), createdAt: timestamp(),
}, table => [index("idx_consent_tenant_contact").on(table.tenantId, table.contactId)]);
export const suppressionRecords = sqliteTable("suppression_records", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  contactId: text("contact_id").notNull().references(() => contacts.id), channel: text("channel").notNull(),
  reason: text("reason").notNull(), revokedAt: text("revoked_at"), createdAt: timestamp(),
}, table => [index("idx_suppression_tenant_contact").on(table.tenantId, table.contactId)]);
export const pipelines = sqliteTable("pipelines", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  name: text("name").notNull(), createdAt: timestamp(),
}, table => [index("idx_pipelines_tenant").on(table.tenantId)]);
export const stages = sqliteTable("stages", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  pipelineId: text("pipeline_id").notNull().references(() => pipelines.id), name: text("name").notNull(),
  position: integer("position").notNull(),
}, table => [index("idx_stages_tenant_pipeline_position").on(table.tenantId, table.pipelineId, table.position)]);
export const pipelineAutomationRules = sqliteTable("pipeline_automation_rules", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  pipelineId: text("pipeline_id").notNull().references(() => pipelines.id),
  stageId: text("stage_id").references(() => stages.id),
  name: text("name").notNull(), triggerKind: text("trigger_kind").notNull(), actionKind: text("action_kind").notNull(),
  configJson: text("config_json").notNull(), status: text("status").notNull().default("draft"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp(), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("idx_pipeline_rules_tenant_pipeline").on(table.tenantId, table.pipelineId)]);
export const opportunities = sqliteTable("opportunities", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  contactId: text("contact_id").references(() => contacts.id), companyId: text("company_id").references(() => companies.id),
  stageId: text("stage_id").notNull().references(() => stages.id), title: text("title").notNull(),
  valueCents: integer("value_cents").notNull().default(0), status: text("status").notNull().default("open"),
  dealType: text("deal_type"), outcomeReason: text("outcome_reason"), closedAt: text("closed_at"),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  createdAt: timestamp(), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("idx_opportunities_tenant_stage").on(table.tenantId, table.stageId), index("idx_opportunities_tenant_owner").on(table.tenantId, table.ownerUserId)]);
export const purchaseRecords = sqliteTable("purchase_records", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  customerName: text("customer_name").notNull(), productName: text("product_name").notNull(),
  reference: text("reference").notNull(), amountCents: integer("amount_cents").notNull(),
  monthlyAmountCents: integer("monthly_amount_cents").notNull().default(0),
  subscriptionStatus: text("subscription_status").notNull().default("none"),
  purchasedAt: text("purchased_at").notNull(), createdAt: timestamp(),
}, table => [uniqueIndex("uidx_purchases_tenant_reference").on(table.tenantId, table.reference), index("idx_purchases_tenant_date").on(table.tenantId, table.purchasedAt)]);
export const customerFeedback = sqliteTable("customer_feedback", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  customerName: text("customer_name").notNull(), rating: integer("rating").notNull(),
  note: text("note"), observedAt: text("observed_at").notNull(), createdAt: timestamp(),
}, table => [index("idx_feedback_tenant_date").on(table.tenantId, table.observedAt)]);
export const serviceTickets = sqliteTable("service_tickets", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  kind: text("kind").notNull(), title: text("title").notNull(), description: text("description").notNull(),
  customerName: text("customer_name"), customerEmail: text("customer_email"),
  subscriptionReference: text("subscription_reference"), requestedEffectiveDate: text("requested_effective_date"),
  priority: text("priority").notNull().default("normal"), status: text("status").notNull().default("open"),
  createdBy: text("created_by").notNull().references(() => users.id), createdAt: timestamp(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("idx_service_tickets_tenant_kind_status").on(table.tenantId, table.kind, table.status)]);
export const inboundCallSettings = sqliteTable("inbound_call_settings", {
  tenantId: text("tenant_id").primaryKey().references(() => organizations.id),
  businessHoursStart: text("business_hours_start").notNull().default("09:00"),
  businessHoursEnd: text("business_hours_end").notNull().default("17:00"),
  duringHours: text("during_hours").notNull().default("sales_queue"),
  afterHours: text("after_hours").notNull().default("voicemail"),
  greeting: text("greeting").notNull().default("Thank you for calling. Please hold while we connect you."),
  voicemailMessage: text("voicemail_message").notNull().default("Please leave your name, number, and a brief message."),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  contactId: text("contact_id").references(() => contacts.id), sourceNoteId: text("source_note_id").references(() => notes.id), title: text("title").notNull(),
  dueAt: text("due_at"), status: text("status").notNull().default("open"),
  assigneeUserId: text("assignee_user_id").notNull().references(() => users.id), createdAt: timestamp(),
}, table => [index("idx_tasks_tenant_assignee_status").on(table.tenantId, table.assigneeUserId, table.status), uniqueIndex("uidx_tasks_tenant_source_note").on(table.tenantId, table.sourceNoteId)]);
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  contactId: text("contact_id").notNull().references(() => contacts.id), body: text("body").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id), createdAt: timestamp(),
}, table => [index("idx_notes_tenant_contact").on(table.tenantId, table.contactId)]);
export const marketingDocuments = sqliteTable("marketing_documents", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  kind: text("kind").notNull(), title: text("title").notNull(), contentJson: text("content_json").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp(), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("idx_marketing_documents_tenant_kind").on(table.tenantId, table.kind, table.updatedAt)]);
export const messageTemplates = sqliteTable("message_templates", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  channel: text("channel").notNull(), name: text("name").notNull(), subject: text("subject"),
  body: text("body").notNull(), createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp(), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("idx_message_templates_tenant_channel").on(table.tenantId, table.channel, table.updatedAt)]);
export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  contactId: text("contact_id").notNull().references(() => contacts.id), kind: text("kind").notNull(),
  summary: text("summary").notNull(), actorUserId: text("actor_user_id").references(() => users.id),
  createdAt: timestamp(),
}, table => [index("idx_activities_tenant_contact_created").on(table.tenantId, table.contactId, table.createdAt)]);
export const appointmentAvailability = sqliteTable("appointment_availability", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id), timezone: text("timezone").notNull(),
  durationMinutes: integer("duration_minutes").notNull(), windowsJson: text("windows_json").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [uniqueIndex("uidx_appointment_availability_owner").on(table.tenantId, table.ownerUserId)]);
export const appointments = sqliteTable("appointments", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id), contactId: text("contact_id").notNull().references(() => contacts.id),
  opportunityId: text("opportunity_id").references(() => opportunities.id), title: text("title").notNull(),
  startsAt: text("starts_at").notNull(), endsAt: text("ends_at").notNull(), timezone: text("timezone").notNull(),
  version: integer("version").notNull().default(1), status: text("status").notNull().default("booked"),
  createdAt: timestamp(), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("idx_appointments_tenant_owner_start").on(table.tenantId, table.ownerUserId, table.startsAt), index("idx_appointments_tenant_contact").on(table.tenantId, table.contactId)]);
export const appointmentReminderJobs = sqliteTable("appointment_reminder_jobs", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id), appointmentVersion: integer("appointment_version").notNull(),
  reminderKind: text("reminder_kind").notNull(), channel: text("channel").notNull(), dueAt: text("due_at").notNull(),
  status: text("status").notNull().default("dry_run"), createdAt: timestamp(),
}, table => [uniqueIndex("uidx_appointment_reminder_key").on(table.appointmentId, table.appointmentVersion, table.reminderKind, table.channel), index("idx_appointment_reminders_tenant_due").on(table.tenantId, table.status, table.dueAt)]);
export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  actorUserId: text("actor_user_id").notNull().references(() => users.id), kind: text("kind").notNull(),
  targetType: text("target_type").notNull(), targetId: text("target_id").notNull(),
  detailsJson: text("details_json").notNull().default("{}"), createdAt: timestamp(),
}, table => [index("idx_audit_tenant_created").on(table.tenantId, table.createdAt)]);

export const providerConnections = sqliteTable("provider_connections", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  provider: text("provider").notNull(), accountId: text("account_id").notNull(), keyId: text("key_id").notNull(),
  secretCiphertext: text("secret_ciphertext").notNull(), secretIv: text("secret_iv").notNull(),
  status: text("status").notNull().default("connected"), lastVerifiedAt: text("last_verified_at"),
  createdBy: text("created_by").notNull().references(() => users.id), createdAt: timestamp(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [uniqueIndex("uidx_provider_connections_tenant_provider").on(table.tenantId, table.provider)]);

export const phoneNumberRequests = sqliteTable("phone_number_requests", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  partnerName: text("partner_name").notNull(), country: text("country").notNull(),
  region: text("region"), numberType: text("number_type").notNull(),
  capabilities: text("capabilities").notNull(), notes: text("notes"),
  status: text("status").notNull().default("recorded_for_partner_review"),
  createdBy: text("created_by").notNull().references(() => users.id), createdAt: timestamp(),
}, table => [index("idx_phone_requests_tenant_created").on(table.tenantId, table.createdAt)]);

export const websiteConnections = sqliteTable("website_connections", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  name: text("name").notNull(), stageId: text("stage_id").notNull().references(() => stages.id),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  mappingJson: text("mapping_json").notNull().default("{}"), keyHash: text("key_hash").notNull(),
  keyLast4: text("key_last4").notNull(), status: text("status").notNull().default("active"),
  lastReceivedAt: text("last_received_at"), createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp(), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("idx_website_connections_tenant").on(table.tenantId, table.status)]);

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  name: text("name").notNull(), description: text("description"), permissionsJson: text("permissions_json"), keyHash: text("key_hash").notNull(),
  keyLast4: text("key_last4").notNull(), scope: text("scope").notNull(),
  documentScope: text("document_scope").notNull().default("none"),
  status: text("status").notNull().default("active"),
  createdBy: text("created_by").notNull().references(() => users.id),
  expiresAt: text("expires_at").notNull(), lastUsedAt: text("last_used_at"),
  createdAt: timestamp(), revokedAt: text("revoked_at"),
}, table => [index("idx_api_tokens_tenant_status").on(table.tenantId, table.status)]);

export const documentTemplates = sqliteTable("document_templates", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  name: text("name").notNull(), kind: text("kind").notNull().default("document"),
  title: text("title").notNull(), bodyText: text("body_text").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp(), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("idx_document_templates_tenant").on(table.tenantId, table.createdAt)]);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  templateId: text("template_id").references(() => documentTemplates.id),
  contactId: text("contact_id").references(() => contacts.id),
  kind: text("kind").notNull().default("document"), title: text("title").notNull(),
  bodyText: text("body_text").notNull(), status: text("status").notNull().default("draft"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp(), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("idx_documents_tenant_created").on(table.tenantId, table.createdAt)]);

export const documentDeliveries = sqliteTable("document_deliveries", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  documentId: text("document_id").notNull().references(() => documents.id),
  contactId: text("contact_id").notNull().references(() => contacts.id),
  recipientEmail: text("recipient_email").notNull(),
  status: text("status").notNull().default("awaiting_email_connection"),
  createdAt: timestamp(), deliveredAt: text("delivered_at"),
}, table => [index("idx_document_deliveries_tenant_document").on(table.tenantId, table.documentId)]);

export const websiteFormEvents = sqliteTable("website_form_events", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  siteId: text("site_id").notNull().references(() => websiteConnections.id),
  idempotencyKey: text("idempotency_key"), contactId: text("contact_id").notNull().references(() => contacts.id),
  companyId: text("company_id").references(() => companies.id),
  opportunityId: text("opportunity_id").notNull().references(() => opportunities.id),
  receivedAt: timestamp(),
}, table => [uniqueIndex("uidx_website_events_site_key").on(table.siteId, table.idempotencyKey), index("idx_website_events_site_received").on(table.siteId, table.receivedAt)]);
