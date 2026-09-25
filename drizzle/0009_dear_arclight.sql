CREATE TABLE `inbound_call_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`business_hours_start` text DEFAULT '09:00' NOT NULL,
	`business_hours_end` text DEFAULT '17:00' NOT NULL,
	`during_hours` text DEFAULT 'sales_queue' NOT NULL,
	`after_hours` text DEFAULT 'voicemail' NOT NULL,
	`greeting` text DEFAULT 'Thank you for calling. Please hold while we connect you.' NOT NULL,
	`voicemail_message` text DEFAULT 'Please leave your name, number, and a brief message.' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `service_tickets` ADD `subscription_reference` text;--> statement-breakpoint
ALTER TABLE `service_tickets` ADD `requested_effective_date` text;