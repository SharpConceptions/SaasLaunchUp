CREATE TABLE `customer_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`rating` integer NOT NULL,
	`note` text,
	`observed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_feedback_tenant_date` ON `customer_feedback` (`tenant_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `purchase_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`product_name` text NOT NULL,
	`reference` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`monthly_amount_cents` integer DEFAULT 0 NOT NULL,
	`subscription_status` text DEFAULT 'none' NOT NULL,
	`purchased_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_purchases_tenant_reference` ON `purchase_records` (`tenant_id`,`reference`);--> statement-breakpoint
CREATE INDEX `idx_purchases_tenant_date` ON `purchase_records` (`tenant_id`,`purchased_at`);