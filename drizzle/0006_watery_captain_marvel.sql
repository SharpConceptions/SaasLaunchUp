CREATE TABLE `pipeline_automation_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`pipeline_id` text NOT NULL,
	`stage_id` text,
	`name` text NOT NULL,
	`trigger_kind` text NOT NULL,
	`action_kind` text NOT NULL,
	`config_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stage_id`) REFERENCES `stages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pipeline_rules_tenant_pipeline` ON `pipeline_automation_rules` (`tenant_id`,`pipeline_id`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `pipeline_id` text REFERENCES pipelines(id);--> statement-breakpoint
ALTER TABLE `contacts` ADD `stage_id` text REFERENCES stages(id);--> statement-breakpoint
UPDATE `contacts` SET `pipeline_id` = (SELECT p.id FROM pipelines p WHERE p.tenant_id = contacts.tenant_id ORDER BY p.created_at, p.id LIMIT 1) WHERE `pipeline_id` IS NULL;--> statement-breakpoint
UPDATE `contacts` SET `stage_id` = (SELECT s.id FROM stages s WHERE s.tenant_id = contacts.tenant_id AND s.pipeline_id = contacts.pipeline_id AND s.name = contacts.lifecycle_stage ORDER BY s.position LIMIT 1) WHERE `stage_id` IS NULL;--> statement-breakpoint
UPDATE `contacts` SET `stage_id` = (SELECT s.id FROM stages s WHERE s.tenant_id = contacts.tenant_id AND s.pipeline_id = contacts.pipeline_id ORDER BY s.position LIMIT 1) WHERE `stage_id` IS NULL;
