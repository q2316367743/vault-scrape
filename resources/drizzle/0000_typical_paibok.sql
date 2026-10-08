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
	`total` integer DEFAULT 0 NOT NULL,
	`finished` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_task_status` ON `task` (`status`);--> statement-breakpoint
CREATE INDEX `idx_task_created` ON `task` (`created_at`);