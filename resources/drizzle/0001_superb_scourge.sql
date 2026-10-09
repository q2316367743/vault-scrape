CREATE TABLE `scrape_file` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`path` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`keyword` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`plugin_id` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_scrape_file_task` ON `scrape_file` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_scrape_file_status` ON `scrape_file` (`task_id`,`status`);--> statement-breakpoint
ALTER TABLE `task` ADD `connection_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `dir_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `failed` integer DEFAULT 0 NOT NULL;