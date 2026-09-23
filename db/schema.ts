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
  createdAt: timestamp(),
}, table => [index("idx_companies_tenant_name").on(table.tenantId, table.name)]);
export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  companyId: text("company_id").references(() => companies.id), name: text("name").notNull(),
  email: text("email"), phone: text("phone"), timezone: text("timezone"), source: text("source"),
  lifecycleStage: text("lifecycle_stage").notNull().default("New lead"),
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
export const opportunities = sqliteTable("opportunities", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  contactId: text("contact_id").references(() => contacts.id), companyId: text("company_id").references(() => companies.id),
  stageId: text("stage_id").notNull().references(() => stages.id), title: text("title").notNull(),
  valueCents: integer("value_cents").notNull().default(0), status: text("status").notNull().default("open"),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  createdAt: timestamp(), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("idx_opportunities_tenant_stage").on(table.tenantId, table.stageId), index("idx_opportunities_tenant_owner").on(table.tenantId, table.ownerUserId)]);
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  contactId: text("contact_id").references(() => contacts.id), title: text("title").notNull(),
  dueAt: text("due_at"), status: text("status").notNull().default("open"),
  assigneeUserId: text("assignee_user_id").notNull().references(() => users.id), createdAt: timestamp(),
}, table => [index("idx_tasks_tenant_assignee_status").on(table.tenantId, table.assigneeUserId, table.status)]);
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  contactId: text("contact_id").notNull().references(() => contacts.id), body: text("body").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id), createdAt: timestamp(),
}, table => [index("idx_notes_tenant_contact").on(table.tenantId, table.contactId)]);
export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  contactId: text("contact_id").notNull().references(() => contacts.id), kind: text("kind").notNull(),
  summary: text("summary").notNull(), actorUserId: text("actor_user_id").references(() => users.id),
  createdAt: timestamp(),
}, table => [index("idx_activities_tenant_contact_created").on(table.tenantId, table.contactId, table.createdAt)]);
export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => organizations.id),
  actorUserId: text("actor_user_id").notNull().references(() => users.id), kind: text("kind").notNull(),
  targetType: text("target_type").notNull(), targetId: text("target_id").notNull(),
  detailsJson: text("details_json").notNull().default("{}"), createdAt: timestamp(),
}, table => [index("idx_audit_tenant_created").on(table.tenantId, table.createdAt)]);
