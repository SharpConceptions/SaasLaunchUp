CREATE TABLE `auth_password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_auth_password_resets_token_hash` ON `auth_password_resets` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_auth_password_resets_user` ON `auth_password_resets` (`user_id`);