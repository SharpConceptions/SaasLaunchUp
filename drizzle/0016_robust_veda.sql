CREATE TABLE `appointment_availability` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`timezone` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`windows_json` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_appointment_availability_owner` ON `appointment_availability` (`tenant_id`,`owner_user_id`);--> statement-breakpoint
CREATE TABLE `appointment_reminder_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`appointment_version` integer NOT NULL,
	`reminder_kind` text NOT NULL,
	`channel` text NOT NULL,
	`due_at` text NOT NULL,
	`status` text DEFAULT 'dry_run' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_appointment_reminder_key` ON `appointment_reminder_jobs` (`appointment_id`,`appointment_version`,`reminder_kind`,`channel`);--> statement-breakpoint
CREATE INDEX `idx_appointment_reminders_tenant_due` ON `appointment_reminder_jobs` (`tenant_id`,`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`opportunity_id` text,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`timezone` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'booked' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_appointments_tenant_owner_start` ON `appointments` (`tenant_id`,`owner_user_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_appointments_tenant_contact` ON `appointments` (`tenant_id`,`contact_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_appointments_no_overlap_insert` BEFORE INSERT ON `appointments`
WHEN NEW.`status` = 'booked' AND EXISTS (
	SELECT 1 FROM `appointments` existing
	WHERE existing.`tenant_id` = NEW.`tenant_id`
		AND existing.`owner_user_id` = NEW.`owner_user_id`
		AND existing.`status` = 'booked'
		AND NEW.`starts_at` < existing.`ends_at`
		AND NEW.`ends_at` > existing.`starts_at`
)
BEGIN
	SELECT RAISE(ABORT, 'appointment_overlap');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_appointments_no_overlap_update` BEFORE UPDATE OF `tenant_id`, `owner_user_id`, `starts_at`, `ends_at`, `status` ON `appointments`
WHEN NEW.`status` = 'booked' AND EXISTS (
	SELECT 1 FROM `appointments` existing
	WHERE existing.`id` != NEW.`id`
		AND existing.`tenant_id` = NEW.`tenant_id`
		AND existing.`owner_user_id` = NEW.`owner_user_id`
		AND existing.`status` = 'booked'
		AND NEW.`starts_at` < existing.`ends_at`
		AND NEW.`ends_at` > existing.`starts_at`
)
BEGIN
	SELECT RAISE(ABORT, 'appointment_overlap');
END;