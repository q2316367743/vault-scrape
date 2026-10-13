CREATE TABLE `media_translation` (
	`item_id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`language` text NOT NULL,
	`source_language` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`original_title` text DEFAULT '' NOT NULL,
	`overview` text DEFAULT '' NOT NULL,
	`maker` text DEFAULT '' NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`series` text DEFAULT '' NOT NULL,
	`director` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`actors` text DEFAULT '[]' NOT NULL,
	`plugin_id` text DEFAULT '' NOT NULL,
	`translated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_media_translation_library` ON `media_translation` (`library_id`);--> statement-breakpoint
ALTER TABLE `library` ADD `language` text DEFAULT '' NOT NULL;