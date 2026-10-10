CREATE TABLE `log` (
	`id` text PRIMARY KEY NOT NULL,
	`level` text NOT NULL,
	`scope` text NOT NULL,
	`message` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_log_created` ON `log` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_log_level` ON `log` (`level`);--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`connection_id` text DEFAULT '' NOT NULL,
	`dir_path` text DEFAULT '' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`finished` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_task_status` ON `task` (`status`);--> statement-breakpoint
CREATE INDEX `idx_task_created` ON `task` (`created_at`);--> statement-breakpoint
CREATE TABLE `scrape_file` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`item_id` text DEFAULT '' NOT NULL,
	`path` text NOT NULL,
	`final_path` text DEFAULT '' NOT NULL,
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
CREATE INDEX `idx_scrape_file_item` ON `scrape_file` (`item_id`);--> statement-breakpoint
CREATE TABLE `library_path` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_library_path_library` ON `library_path` (`library_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_library_path_conn_path` ON `library_path` (`connection_id`,`path`);--> statement-breakpoint
CREATE TABLE `library` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scrapers` text DEFAULT '[]' NOT NULL,
	`nsfw_protection` integer DEFAULT true NOT NULL,
	`write_nfo` integer DEFAULT true NOT NULL,
	`rename_enabled` integer DEFAULT false NOT NULL,
	`move_enabled` integer DEFAULT false NOT NULL,
	`move_directory` text DEFAULT '' NOT NULL,
	`image_save_mode` text DEFAULT 'media' NOT NULL,
	`last_scan_at` integer DEFAULT 0 NOT NULL,
	`last_scrape_at` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_item` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`type` text DEFAULT 'movie' NOT NULL,
	`parent_id` text DEFAULT '' NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`sort_name` text DEFAULT '' NOT NULL,
	`original_title` text DEFAULT '' NOT NULL,
	`num` text DEFAULT '' NOT NULL,
	`overview` text DEFAULT '' NOT NULL,
	`tagline` text DEFAULT '' NOT NULL,
	`premiere_date` text DEFAULT '' NOT NULL,
	`production_year` integer DEFAULT 0 NOT NULL,
	`runtime_minutes` integer DEFAULT 0 NOT NULL,
	`official_rating` text DEFAULT '' NOT NULL,
	`community_rating` integer DEFAULT 0 NOT NULL,
	`genres` text DEFAULT '[]' NOT NULL,
	`studios` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`provider_ids` text DEFAULT '{}' NOT NULL,
	`scraper_id` text DEFAULT '' NOT NULL,
	`scraped_at` integer DEFAULT 0 NOT NULL,
	`date_added` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_media_item_library` ON `media_item` (`library_id`);--> statement-breakpoint
CREATE INDEX `idx_media_item_parent` ON `media_item` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_media_item_library_conn_num` ON `media_item` (`library_id`,`connection_id`,`num`);--> statement-breakpoint
CREATE TABLE `media_source` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`library_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`extname` text DEFAULT '' NOT NULL,
	`mime` text DEFAULT '' NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`modified_at` integer DEFAULT 0 NOT NULL,
	`indexed_at` integer NOT NULL,
	`scan_id` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_media_source_item` ON `media_source` (`item_id`);--> statement-breakpoint
CREATE INDEX `idx_media_source_library` ON `media_source` (`library_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_source_conn_path` ON `media_source` (`connection_id`,`path`);--> statement-breakpoint
CREATE TABLE `media_image` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`library_id` text NOT NULL,
	`type` text DEFAULT 'primary' NOT NULL,
	`connection_id` text NOT NULL,
	`path` text NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_media_image_item` ON `media_image` (`item_id`);--> statement-breakpoint
CREATE INDEX `idx_media_image_library` ON `media_image` (`library_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_image_conn_path` ON `media_image` (`connection_id`,`path`);