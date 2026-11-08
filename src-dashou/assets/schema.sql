-- 系统库结构（SQLite）。
--
-- 与原 Electron 版本的 4 个 drizzle 迁移合并成一份幂等 DDL：
-- 插件第一次启动时直接建表，不需要迁移工具；后续加列请追加 `ALTER TABLE ... ADD COLUMN`
-- 并在 `client.ts` 里按 `PRAGMA user_version` 做增量。

CREATE TABLE IF NOT EXISTS `log` (
  `id` text PRIMARY KEY NOT NULL,
  `level` text NOT NULL,
  `scope` text NOT NULL,
  `message` text NOT NULL,
  `detail` text DEFAULT '' NOT NULL,
  `created_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `idx_log_created` ON `log` (`created_at`);
CREATE INDEX IF NOT EXISTS `idx_log_level` ON `log` (`level`);

CREATE TABLE IF NOT EXISTS `task` (
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
CREATE INDEX IF NOT EXISTS `idx_task_status` ON `task` (`status`);
CREATE INDEX IF NOT EXISTS `idx_task_created` ON `task` (`created_at`);

CREATE TABLE IF NOT EXISTS `scrape_file` (
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
CREATE INDEX IF NOT EXISTS `idx_scrape_file_task` ON `scrape_file` (`task_id`);
CREATE INDEX IF NOT EXISTS `idx_scrape_file_status` ON `scrape_file` (`task_id`,`status`);
CREATE INDEX IF NOT EXISTS `idx_scrape_file_item` ON `scrape_file` (`item_id`);

CREATE TABLE IF NOT EXISTS `library` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `type` text DEFAULT 'movie' NOT NULL,
  `scrapers` text DEFAULT '[]' NOT NULL,
  `nsfw_protection` integer DEFAULT 1 NOT NULL,
  `min_file_size_mb` integer DEFAULT 10 NOT NULL,
  `local_first` integer DEFAULT 0 NOT NULL,
  `move_enabled` integer DEFAULT 0 NOT NULL,
  `move_directory` text DEFAULT '' NOT NULL,
  `language` text DEFAULT '' NOT NULL,
  `last_scan_at` integer DEFAULT 0 NOT NULL,
  `last_scrape_at` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `library_path` (
  `id` text PRIMARY KEY NOT NULL,
  `library_id` text NOT NULL,
  `connection_id` text NOT NULL,
  `path` text NOT NULL,
  `created_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `idx_library_path_library` ON `library_path` (`library_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_library_path_conn_path` ON `library_path` (`connection_id`,`path`);

CREATE TABLE IF NOT EXISTS `media_item` (
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
  `season_number` integer DEFAULT 0 NOT NULL,
  `episode_number` integer DEFAULT 0 NOT NULL,
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
  `maker` text DEFAULT '' NOT NULL,
  `label` text DEFAULT '' NOT NULL,
  `series` text DEFAULT '' NOT NULL,
  `director` text DEFAULT '' NOT NULL,
  `scraper_id` text DEFAULT '' NOT NULL,
  `scraped_at` integer DEFAULT 0 NOT NULL,
  `has_nfo` integer DEFAULT 0 NOT NULL,
  `date_added` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `idx_media_item_library` ON `media_item` (`library_id`);
CREATE INDEX IF NOT EXISTS `idx_media_item_parent` ON `media_item` (`parent_id`);
CREATE INDEX IF NOT EXISTS `idx_media_item_library_conn_num` ON `media_item` (`library_id`,`connection_id`,`num`);

CREATE TABLE IF NOT EXISTS `media_source` (
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
CREATE INDEX IF NOT EXISTS `idx_media_source_item` ON `media_source` (`item_id`);
CREATE INDEX IF NOT EXISTS `idx_media_source_library` ON `media_source` (`library_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_media_source_conn_path` ON `media_source` (`connection_id`,`path`);

CREATE TABLE IF NOT EXISTS `media_image` (
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
CREATE INDEX IF NOT EXISTS `idx_media_image_item` ON `media_image` (`item_id`);
CREATE INDEX IF NOT EXISTS `idx_media_image_library` ON `media_image` (`library_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_media_image_conn_path` ON `media_image` (`connection_id`,`path`);

CREATE TABLE IF NOT EXISTS `actor` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `name_key` text NOT NULL,
  `gender` text DEFAULT '' NOT NULL,
  `birthday` text DEFAULT '' NOT NULL,
  `birth_country` text DEFAULT '' NOT NULL,
  `birth_province` text DEFAULT '' NOT NULL,
  `birth_city` text DEFAULT '' NOT NULL,
  `birth_county` text DEFAULT '' NOT NULL,
  `height` integer DEFAULT 0 NOT NULL,
  `bust` integer DEFAULT 0 NOT NULL,
  `waist` integer DEFAULT 0 NOT NULL,
  `hip` integer DEFAULT 0 NOT NULL,
  `cup` text DEFAULT '' NOT NULL,
  `tagline` text DEFAULT '' NOT NULL,
  `source_url` text DEFAULT '' NOT NULL,
  `overview` text DEFAULT '' NOT NULL,
  `tags` text DEFAULT '[]' NOT NULL,
  `avatar_image_id` text DEFAULT '' NOT NULL,
  `locked` integer DEFAULT 0 NOT NULL,
  `scraper_id` text DEFAULT '' NOT NULL,
  `scraped_at` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_actor_name_key` ON `actor` (`name_key`);
CREATE INDEX IF NOT EXISTS `idx_actor_updated` ON `actor` (`updated_at`);

CREATE TABLE IF NOT EXISTS `actor_alias` (
  `id` text PRIMARY KEY NOT NULL,
  `actor_id` text NOT NULL,
  `alias` text NOT NULL,
  `alias_key` text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_actor_alias_actor_key` ON `actor_alias` (`actor_id`,`alias_key`);
CREATE INDEX IF NOT EXISTS `idx_actor_alias_key` ON `actor_alias` (`alias_key`);

CREATE TABLE IF NOT EXISTS `actor_image` (
  `id` text PRIMARY KEY NOT NULL,
  `actor_id` text NOT NULL,
  `kind` text DEFAULT 'photo' NOT NULL,
  `path` text NOT NULL,
  `name` text NOT NULL,
  `extname` text DEFAULT '' NOT NULL,
  `mime` text DEFAULT '' NOT NULL,
  `size` integer DEFAULT 0 NOT NULL,
  `width` integer DEFAULT 0 NOT NULL,
  `height` integer DEFAULT 0 NOT NULL,
  `source` text DEFAULT 'user' NOT NULL,
  `created_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `idx_actor_image_actor` ON `actor_image` (`actor_id`);

CREATE TABLE IF NOT EXISTS `media_cast` (
  `item_id` text NOT NULL,
  `actor_name` text NOT NULL,
  `name_key` text NOT NULL,
  `ordinal` integer DEFAULT 0 NOT NULL,
  PRIMARY KEY(`item_id`, `name_key`)
);
CREATE INDEX IF NOT EXISTS `idx_media_cast_name` ON `media_cast` (`name_key`);

CREATE TABLE IF NOT EXISTS `media_translation` (
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
CREATE INDEX IF NOT EXISTS `idx_media_translation_library` ON `media_translation` (`library_id`);
