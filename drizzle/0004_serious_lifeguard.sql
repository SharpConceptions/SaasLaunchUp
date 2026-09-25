ALTER TABLE `tasks` ADD `source_note_id` text REFERENCES notes(id);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_tasks_tenant_source_note` ON `tasks` (`tenant_id`,`source_note_id`);