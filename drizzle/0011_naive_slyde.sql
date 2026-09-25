CREATE TABLE `phone_number_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`partner_name` text NOT NULL,
	`country` text NOT NULL,
	`region` text,
	`number_type` text NOT NULL,
	`capabilities` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'recorded_for_partner_review' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_phone_requests_tenant_created` ON `phone_number_requests` (`tenant_id`,`created_at`);