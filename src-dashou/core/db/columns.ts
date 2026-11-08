/**
 * 每张表的 SELECT 列清单：把 snake_case 列别名成 camelCase，仓储直接拿对象用。
 *
 * 契约：列清单与 `src-dashou/assets/schema.sql` 必须同步；新增列时两边一起改。
 * 拼接进 SQL 时只用于本文件的常量，不接受外部输入。
 */

export const LOG_COLUMNS = `id, level, scope, message, detail, created_at AS createdAt`

export const TASK_COLUMNS = `id, name, status, connection_id AS connectionId, dir_path AS dirPath,
  total, finished, failed, message, created_at AS createdAt, updated_at AS updatedAt`

export const SCRAPE_FILE_COLUMNS = `id, task_id AS taskId, item_id AS itemId, path,
  final_path AS finalPath, name, keyword, status, plugin_id AS pluginId, title, message,
  updated_at AS updatedAt`

export const LIBRARY_COLUMNS = `id, name, type, scrapers, nsfw_protection AS nsfwProtection,
  min_file_size_mb AS minFileSizeMb, local_first AS localFirst, move_enabled AS moveEnabled,
  move_directory AS moveDirectory, language, last_scan_at AS lastScanAt,
  last_scrape_at AS lastScrapeAt, created_at AS createdAt, updated_at AS updatedAt`

export const LIBRARY_PATH_COLUMNS = `id, library_id AS libraryId, connection_id AS connectionId,
  path, created_at AS createdAt`

export const MEDIA_ITEM_COLUMNS = `id, library_id AS libraryId, connection_id AS connectionId,
  type, parent_id AS parentId, path, name, sort_name AS sortName, original_title AS originalTitle,
  num, season_number AS seasonNumber, episode_number AS episodeNumber, overview, tagline,
  premiere_date AS premiereDate, production_year AS productionYear,
  runtime_minutes AS runtimeMinutes, official_rating AS officialRating,
  community_rating AS communityRating, genres, studios, tags, provider_ids AS providerIds,
  maker, label, series, director, scraper_id AS scraperId, scraped_at AS scrapedAt,
  has_nfo AS hasNfo, date_added AS dateAdded, updated_at AS updatedAt`

export const MEDIA_SOURCE_COLUMNS = `id, item_id AS itemId, library_id AS libraryId,
  connection_id AS connectionId, path, name, extname, mime, size,
  modified_at AS modifiedAt, indexed_at AS indexedAt, scan_id AS scanId`

export const MEDIA_IMAGE_COLUMNS = `id, item_id AS itemId, library_id AS libraryId, type,
  connection_id AS connectionId, path, width, height, created_at AS createdAt`

export const ACTOR_COLUMNS = `id, name, name_key AS nameKey, gender, birthday,
  birth_country AS birthCountry, birth_province AS birthProvince, birth_city AS birthCity,
  birth_county AS birthCounty, height, bust, waist, hip, cup, tagline,
  source_url AS sourceUrl, overview, tags, avatar_image_id AS avatarImageId, locked,
  scraper_id AS scraperId, scraped_at AS scrapedAt, created_at AS createdAt,
  updated_at AS updatedAt`

/** 带 `actor.` 前缀的列清单：列表查询要同时取子查询（作品数）时用 */
export const ACTOR_COLUMNS_PREFIXED = `actor.id, actor.name, actor.name_key AS nameKey,
  actor.gender, actor.birthday, actor.birth_country AS birthCountry,
  actor.birth_province AS birthProvince, actor.birth_city AS birthCity,
  actor.birth_county AS birthCounty, actor.height, actor.bust, actor.waist, actor.hip,
  actor.cup, actor.tagline, actor.source_url AS sourceUrl, actor.overview, actor.tags,
  actor.avatar_image_id AS avatarImageId, actor.locked, actor.scraper_id AS scraperId,
  actor.scraped_at AS scrapedAt, actor.created_at AS createdAt, actor.updated_at AS updatedAt`

export const ACTOR_ALIAS_COLUMNS = `id, actor_id AS actorId, alias, alias_key AS aliasKey`

export const ACTOR_IMAGE_COLUMNS = `id, actor_id AS actorId, kind, path, name, extname, mime,
  size, width, height, source, created_at AS createdAt`

export const MEDIA_CAST_COLUMNS = `item_id AS itemId, actor_name AS actorName,
  name_key AS nameKey, ordinal`

export const MEDIA_TRANSLATION_COLUMNS = `item_id AS itemId, library_id AS libraryId, language,
  source_language AS sourceLanguage, title, original_title AS originalTitle, overview, maker,
  label, series, director, tags, actors, plugin_id AS pluginId, translated_at AS translatedAt`
