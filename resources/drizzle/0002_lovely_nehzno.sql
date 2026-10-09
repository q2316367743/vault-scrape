CREATE TABLE `resource` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`dir_path` text NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`extname` text DEFAULT '' NOT NULL,
	`mime` text DEFAULT '' NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`modified_at` integer DEFAULT 0 NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`indexed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_resource_dir` ON `resource` (`connection_id`,`dir_path`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_resource_conn_path` ON `resource` (`connection_id`,`path`);--> statement-breakpoint
ALTER TABLE `scrape_file` ADD `cover_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `scrape_file` ADD `cover_path` text DEFAULT '' NOT NULL;