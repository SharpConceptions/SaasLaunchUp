CREATE TABLE `onboarding_profiles` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`industry` text,
	`team_size` text,
	`goals_json` text,
	`phone` text,
	`website` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);CREATE TABLE `onboarding_profiles` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`industry` text,
	`team_size` text,
	`goals_json` text,
	`phone` text,
	`website` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);