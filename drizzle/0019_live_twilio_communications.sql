CREATE TABLE `twilio_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`from_number` text NOT NULL,
	`operator_number` text,
	`voice_enabled` integer DEFAULT false NOT NULL,
	`sms_enabled` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `communication_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`contact_id` text,
	`channel` text NOT NULL,
	`direction` text NOT NULL,
	`from_number` text NOT NULL,
	`to_number` text NOT NULL,
	`body` text NOT NULL,
	`provider_id` text,
	`status` text NOT NULL,
	`error_code` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `idx_communication_messages_tenant_created` ON `communication_messages` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_communication_messages_provider` ON `communication_messages` (`provider_id`);--> statement-breakpoint
CREATE TABLE `communication_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`contact_id` text,
	`from_number` text NOT NULL,
	`to_number` text NOT NULL,
	`provider_id` text,
	`status` text NOT NULL,
	`duration_seconds` integer,
	`error_code` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `idx_communication_calls_tenant_created` ON `communication_calls` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_communication_calls_provider` ON `communication_calls` (`provider_id`);