ALTER TABLE `library` ADD `min_file_size_mb` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `library` ADD `local_first` integer DEFAULT false NOT NULL;