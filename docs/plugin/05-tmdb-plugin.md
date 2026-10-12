# TMDB 插件实例：影片信息 + 演员信息（themoviedb.org）

本文记录一个真实站点的两个插件落地口径：TMDB（The Movie Database）的**影片信息插件**（`kind: movie`）与
**演员信息插件**（`kind: actor`）。影片侧是「**电影 + 剧集都能刮**」的参考实现——剧集走
[剧集支持](../media/02-series-support.md) 的多季多集三层产物；演员侧是「**只按姓名检索 JSON API、不解析 HTML**」的参考实现。

协议本体（`meta` / 方法 / `env` / `ctx` / 沙箱白名单 / 错误码）见 [plugin/01-plugin-module.md](./01-plugin-module.md)，
类别划分与演员抓取的四个触发场景见 [plugin/03-plugin-categories.md](./03-plugin-categories.md)；候选匹配由宿主负责，口径见
[刮削模块 §5.2](../scrape/01-scrape-module.md)。

两个插件文件分别是 `script/movie/tv/tmdb.js`（影片信息，§1–§7）与 `script/actor/tmdb.js`（演员信息，§8），
而 `.gitignore` 忽略 `script/`（本机参考脚本不进仓库），所以**本文件是这两个插件在仓库里唯一的书面记录**：
站点口径、字段取舍、与宿主的耦合点都写在这里，改插件前先看这里，改完同步这里。

## 0. 总览：两个插件

**影片信息插件**（`kind: movie`，§1–§7）：

| 项 | 值 |
| --- | --- |
| 插件文件 | `script/movie/tv/tmdb.js`（约 580 行，纯 JS、无 `import` / `require`，结尾一句 `definePlugin({ … })`） |
| `meta.id` | `tmdb`（= 文件名 `tmdb.js`，kebab-case 校验通过） |
| `meta.kind` | `movie` |
| 实现方法 | `search` / `detail` / `covers` / `extras`（影片类四个全必填） |
| 数据源 | TMDB v3 REST（`https://api.themoviedb.org/3`，纯 JSON，**不解析 HTML**、不需要 cheerio） |
| 鉴权 | `apiReadAccessToken`（v4 读访问令牌，`Authorization: Bearer`）优先；否则 `apiKey`（v3，`api_key` 查询参数） |
| 覆盖内容 | 电影与剧集：标题 / 原名 / 简介 / 上映（首播）日期 / 时长 / 出品公司 / 导演 / 系列 / 题材 / 关键词 / 演员 |
| 图片 | `poster`（w500）、`fanart`（w1280）、`still`（w780，影片取背景图、**剧集按集**） |
| 剧集分集 | `detail.episodes[]`，逐季请求 `/tv/{id}/season/{n}` |
| 预告片 | **不产出**（见 §4） |

**演员信息插件**（`kind: actor`，见 §8）：

| 项 | 值 |
| --- | --- |
| 插件文件 | `script/actor/tmdb.js`（约 380 行，纯 JS，结尾一句 `definePlugin({ … })`） |
| `meta.id` | `tmdb`——与影片插件**同 id 但不同类别**，宿主按类别各存一份（索引、源码、缓存、环境变量都分开） |
| `meta.kind` | `actor` |
| 实现方法 | `actor`（必填）+ `actorAssets`（可选，实现了才生效） |
| 数据源 | TMDB v3 REST：`/search/person` + `/person/{id}`（纯 JSON，**不解析 HTML**、不需要 cheerio） |
| 鉴权 | 与影片插件同口径（`apiReadAccessToken` 优先，否则 `apiKey`），但**凭据是另一份配置，要在此类别里再填一次** |
| 产出内容 | 别名、性别、生日、出生地（国家 / 州省 / 城市）、职业（`tagline`）、简介、来源页 |
| 图片 | `poster`（头像，w500）；`still`（图集：其余写真 + `tagged_images` 电影剧照，w500 / w780） |
| 不产出 | 身高 / 三围 / 罩杯（TMDB 没有）、标签（`tags` 宿主从不写进演员资料） |

## 1. 鉴权：两项都选填，调用时才校验

TMDB 有两套凭据，插件把两面都留着，`env` 里**两项都 `required: false`**：

| `env.key` | 对应 TMDB 后台 | 用法 |
| --- | --- | --- |
| `apiReadAccessToken` | 「API 读访问令牌」（v4） | `Authorization: Bearer <token>` |
| `apiKey` | 「API 密钥」（v3） | `?api_key=<key>` |

`readAuth(env)` 在**每次请求前**决定用哪一个：读访问令牌非空就优先用它（请求头更干净，也不会把密钥写进 URL 与日志），
否则退回 API 密钥；两者都为空才 `throw new Error('TMDB 插件未配置凭据：…')`。

- 为什么不做成 `required: true`：两项是**二选一**，单个字段标必填会让另一种配法填不进去（`envReady` 直接把调用卡在 `envMissing`，连错误文案都到不了插件）。
- 为什么在插件里校验而不是靠宿主：宿主的必填校验是「逐字段」，表达不了「至少一个」这种关系。
- `env` 里的值统一存 safeStorage 密文、界面明文不回显，所以令牌只进内存与请求头；**错误文案里绝不能回显令牌本身**（401 文案只说「读访问令牌 / API 密钥无效」，不含值）。

## 2. `search`：把文件名洗成检索词

宿主的 `keyword` 已经洗过一遍（`extractKeyword`：去掉 `[...]【...】(…)` 内容、`[_+.,]+` 换成空格），但**影片库的关键字仍是文件名**，
例：`Inception.2010.1080p.BluRay.x264-GROUP.mkv` → `Inception 2010 1080p BluRay x264-GROUP`。直接丢给 TMDB 是查不出东西的，
所以插件再洗一遍（`buildQuery`）：

1. 按 `[\s._+]+` 切词，去掉词首尾残留的括号；
2. 剔除噪声词（`NOISE_TOKEN_PATTERN`：`1080p` / `2160p` / `4k` / `BluRay` / `Web-DL` / `Remux` / `x264` / `x265` / `HEVC` / `DDP` / `中字` / `国语` / `无删减` …）；
3. 带连字符的词按 `-` 前半段再判一次（`x264-GROUP` → `x264` 命中噪声 → 整个词扔掉，`Spider-Man` 不会被误伤）；
4. 全被剔光时**退回原关键字**（宁可查一次原样，也不要交空串）。

剧集库不用这一步：宿主给的关键字已经是**剧集目录名去结尾年份**（`Show 2019` → `Show`），基本就是标题本身。

请求 `/search/multi`（`include_adult=false`、`page=1`、`language`），只保留 `media_type` 为 `movie` / `tv` 的结果
（丢掉 `person`，成人结果直接跳过），最多 `SEARCH_LIMIT = 20` 条。候选字段：

| 候选字段 | 取值 | 说明 |
| --- | --- | --- |
| `id` | `` `movie-${id}` `` / `` `tv-${id}` `` | **必须带类型前缀**：TMDB 的影片与剧集是两套独立 id，不记类型无法请求详情 |
| `title` | `pickTitle(title/name, original_title/original_name, query)` | 见下 |
| `date` | `release_date` / `first_air_date` | 剧集用它给宿主做年份池过滤（`pickSeriesCandidate`） |
| `isSeries` | `media_type === 'tv'` | 语义标记，宿主目前只归一化读入、不参与判定 |
| `cover` | `poster_path` → `w500` | 仅用于界面展示 |
| `num` | **不返回** | TMDB 没有番号概念；乱填会让宿主的番号匹配更乱（见 §7） |

`pickTitle` 在「本地化标题」与「原始标题」之间按**字符重合度**（`sharedCharCount`）二选一：播放文件的命名（或剧集目录名）写的多半是原始标题，
所以 `original_title` 更贴合检索词时优先它；`language=zh-CN` 时若无明显偏好则用中文标题。返回的 `episodes`/`isSeries`/`episodeCount`
只填 `isSeries`——`episodeCount` 需要额外请求详情才知道，放在 `search` 里会拖慢每个候选。

## 3. `detail`：`id` 必须是纯数字

`detail(movieId)` 收到的可能是带类型前缀的候选 id（`tv-1399`），也可能是**上一轮 detail 返回的纯数字 id**
（宿主把 `detail.id` 原样透给 `covers` / `extras`，见 §7）。`parseTarget` 两种都认，`resolvedTypes` 记下类型。

- **影片** → `GET /movie/{id}?append_to_response=credits,keywords,external_ids,images`
- **剧集** → `GET /tv/{id}?append_to_response=credits,keywords,external_ids`（剧集不需要 `images`：剧照按集拿）

返回的 `id` **用 TMDB 的纯数字 id**，不带上缀：

- 宿主把它写进 `providerIds`（`{ tmdb: 1399 }`）→ NFO 的 `<uniqueid type="tmdb" default="true">1399</uniqueid>`；带上缀会污染 NFO；
- `{providerId}` 命名占位符虽然读的是 `detail.providerId`（宿主从不赋值，恒为空串），但保持纯数字也让语义干净。

字段映射（`detail` 返回值 → 宿主落库 / 落 NFO）：

| `PluginMovieDetail` | 来源 | 备注 |
| --- | --- | --- |
| `title` | `title` / `name`，若空则回落原始标题 | 两者都空 → 抛错（接口结构变了） |
| `originalTitle` | `original_title` / `original_name` | 与 `title` 相同时不写 |
| `plot` | `overview` | `language=zh-CN` 时是中文简介 |
| `releaseDate` | `release_date` / `first_air_date` | 剧集流程的 `{year}` 占位符取自这里 |
| `duration` | `runtime` / `episode_run_time[0]` | 分钟；`>0` 才写 |
| `studio` | 影片 `production_companies[0]`；剧集 `networks[0]` 回落 `production_companies[0]` | 只取一条 |
| `director` | 影片 `credits.crew` 里 `job === 'Director'`（最多 3 人）；剧集 `created_by`（最多 3 人） | `、` 连接 |
| `series` | 影片 `belongs_to_collection.name` | 只喂命名占位符 `{series}`，不入库（见 §7） |
| `actors` | `credits.cast` 前 `CAST_LIMIT = 15` 人 | 去重、保序 |
| `genres` | `genres[].name` | 剧集 NFO 写 `<genre>` |
| `tags` | 影片 = 题材；剧集 = `keywords.results[].name` | 影片 NFO **只写 `<tag>`**（`genres` 不落影片 NFO），所以影片把题材同时塞进 `tags` |
| `episodes` | 见下 | 仅剧集 |

**分集清单（剧集）**：`data.seasons[]` 里 `episode_count > 0` 的季号（跳过 `0` 集的挂名季），排序后逐季
`GET /tv/{id}/season/{n}`，把 `episodes[]` 折成 `PluginEpisode[]`：

| `PluginEpisode` | 来源 |
| --- | --- |
| `index` | `episode_number`（`<= 0` 丢弃，宿主也会再挡一层） |
| `season` | `season_number`（缺省用请求的季号；宿主在 `=== 1` 时不落库） |
| `title` | `name`（缺省时宿主回落「第 N 集」） |
| `plot` | `overview` |
| `duration` | `runtime` |
| `releaseDate` | `air_date` |

季数上限：`maxSeasons`（`0` = 全部，内部硬上限 `SEASON_HARD_LIMIT = 20`），超限只取前 N 季并 `ctx.log('warn', …)`。
**分集是逐季一次请求**，而单次方法调用有超时（默认 ≥30s、随网络重试设置变长），所以长剧要么让用户调大超时，要么用 `maxSeasons` 收紧；
宿主侧还有 `PLUGIN_LIST_LIMIT = 500`，超长剧的 `episodes` / `assets` 会被截断并 warn。

## 4. `covers` / `extras`：剧照按集归属，不产预告片

- `covers`：`poster_path` → `poster`（w500）；`backdrop_path` → `fanart`（w1280）。只产封面类，越界的 kind 会被宿主丢弃。
- `extras`：
  - **影片**：`images.backdrops`（`detail` 里 append 进来的）最多 `MOVIE_BACKDROP_LIMIT = 10` 张作为 `still`，
    跳过已经被 `backdrop_path` 用作 `fanart` 的那一张（否则同一张图会被存两份）；
  - **剧集**：每集 `still_path` 产出一张 `still`，带**集号归属**：

    ```js
    { kind: 'still', url: '<w780 图片>' , episode: { season: 1, index: 3 } }
    ```

    宿主剧集流水线只认带 `episode` 的剧照，按季过滤、再按 `index` 匹配集号，落成 `<集基础名>-thumb.<ext>`；
    不带 `episode` 的剧照会落到**剧集根目录**（合法，但 TMDB 的剧集级图集另有 `images` 接口，本期没用）。
    数量受 `maxStills` 限制（默认 60，`0` = 不限）。
- **预告片不做**：TMDB 的 `videos` 只给 YouTube **观看页**地址（`https://www.youtube.com/watch?v=…`），
  而宿主的资源下载是**普通 HTTP GET 直链**（`downloadAsset` → 临时文件 → 上传），把观看页下下来只会得到一个 HTML 文件。
  要做就得让宿主换 yt-dlp 一类工具，属于宿主能力，本期明确不做。

图片尺寸固定为常量（`POSTER_SIZE` / `BACKDROP_SIZE` / `STILL_SIZE`），图片基址可被 `imageBaseUrl` 覆盖（走镜像 / 代理时用）。

## 5. 请求缓存与类型记忆

插件的**编译结果按源码 mtime 缓存在宿主的 `pluginRegistry` 里**，命中即复用同一个 vm context，
所以**模块级变量在多次调用之间是持续存在的**（这也是为什么插件顶层可以放缓存而不必每次重建）。本插件用了两层：

| 模块级状态 | 键 | 内容 | 上限 |
| --- | --- | --- | --- |
| `resolvedTypes` | 纯数字 id | `'movie'` / `'tv'` | `TYPE_CACHE_LIMIT = 200`（超限整体清空） |
| `detailCache` | `类型-id\|language`、`? -id\|language`（类型未知的裸数字 id）各写一份 | `{ type, id, data, episodes, stills }` | `DETAIL_CACHE_LIMIT = 16`（超限整体清空） |

效果：`detail` → `covers` → `extras` 是同一部片子，**只有第一次真的发请求**；剧集的分季请求也不会重复。
缓存是「可有可无的加速」——清空后靠 `resolvedTypes` 或「先按影片试、404 再按剧集试」的探测路径仍能恢复，
所以代码里没有精细的 LRU，只有「超限整体清空」这种最简策略（vm 里长期驻留不该无限增长）。

请求统一走 `requestJson`，集中处理状态码：`401` → 「读访问令牌 / API 密钥无效」、`404` → 返回 `null`（交给上层按「找不到」处理）、
`429` → 「请求过于频繁」、其它 `>= 400` → 带路径的失败文案；响应体 `JSON.parse` 失败也报中文错误。
宿主负责超时 / 重试 / 限速 / 代理 / 字符集，插件不自己塞 UA、不自己重试。

## 6. 环境变量

| `env.key` | 默认 | 说明 |
| --- | --- | --- |
| `apiReadAccessToken` | — | v4 读访问令牌，与 `apiKey` 二选一（都填时用它） |
| `apiKey` | — | v3 API 密钥 |
| `language` | `zh-CN` | TMDB `language` 参数；填 `en-US` 拿英文标题与简介 |
| `baseUrl` | `https://api.themoviedb.org/3` | 走镜像 / 代理时覆盖（结尾斜杠会被去掉） |
| `imageBaseUrl` | `https://image.tmdb.org/t/p` | 图片被墙或走代理时覆盖 |
| `maxSeasons` | `0` | 剧集逐季请求的季数上限，`0` = 全部（硬上限 20） |
| `maxStills` | `60` | 剧集按每集一张计数；影片背景图剧照另限 10 张；`0` = 不限 |

七项全部 `required: false`：只有凭据是真的「必须有」（在插件里以「至少一项」的形式校验），其余都有可用默认值。

## 7. 与宿主的耦合点

1. **候选匹配（最容易踩的坑）**：TMDB 候选没有番号，而宿主的影片库任务行会带上从文件名猜出的番号
   （`Inception.2010.1080p.BluRay.mkv` → `INCEPTION 2010`，见 [刮削模块 §3](../scrape/01-scrape-module.md)）。
   过去 `pickCandidate` 在「有番号但匹配不上」时直接判失败，TMDB 这类插件会**永远匹配不上**；
   现在番号对不上会回落到标题判定（唯一候选 → 候选标题包含关键词 → 关键词包含候选标题），实测口径与验证步骤见
   [刮削模块 §5.2 / §8](../scrape/01-scrape-module.md)。**插件侧能做的是「别乱填 `num`」**，其余交给宿主。
2. **`detail.id` → `covers` / `extras` 的 `movieId`**：宿主拿 `detail` 返回的 id 继续调后两个方法，不是候选 id，所以两者都要能解析（§3）。
3. **`detail.id` → NFO `<uniqueid>`**：`providerIds = { [pluginId]: detail.id }`，故用纯数字。
4. **`series` / `label` / `maker` / `director` 各自入库**（`media_item` 的同名列，详情页「影片信息」按行展示），**同时也参与命名占位符**；`studio` 单独进 JSON 列 `studios`（详情页不展示）。本插件用 `studio` 装出品公司 / 电视台。
5. **集剧照**：带 `episode: { season, index }` 才是「某集的剧照」，落成 `<集基础名>-thumb.<ext>`；`season` 缺省算第 1 季。
6. **演员**：`detail.actors` 会被 `enqueueItemActorScrape` 按**姓名**写进 `media_cast` 并排队补全资料——
   TMDB 给的是英文名，所以演员页会多出一批英文名演员（限 15 个避免膨胀）。
7. **超时**：单次方法调用默认 ≥30s（`callTimeoutMs()`）；剧集分集是「1 次 search + 1 次 detail + N 次 season」，N 大时要靠 `maxSeasons` 兜。
8. **无需 `env` 的插件不显示配置区块**：本插件声明了 7 项，所以插件页右栏会出现配置区块（明文不回显、密文存 safeStorage）。

## 8. 演员信息插件（`script/actor/tmdb.js`）

类别 `actor` 与影片类别的差异：**只按姓名检索**（`actor(name, env, ctx)` 的第一个参数就是姓名，宿主从 `media_cast` 里取），
没有候选列表、没有 `num`；命中与否由「能不能给出合法资料」决定（§8.5 第 1 条）。

### 8.1 调用链与缓存

一次「抓这个演员」最多调两个方法：`actor`（必填）→ `actorAssets`（可选），两者拿到同一个姓名，所以插件用
**模块级缓存**避免重复请求——`pluginRegistry` 按源码 mtime 缓存编译结果，同一 vm context 会跨多次 invoke 复用，
模块级变量因此能活到下次抓取（见 [plugin/01 §6](./01-plugin-module.md)）：

```txt
actor(name)        ─┬─ 命中 personCache → 直接用
actorAssets(name)  ─┘   否则 /search/person → /person/{id}?append_to_response=images,tagged_images,external_ids
```

- 缓存键 `normalizeName(name)`（NFKC + 小写 + 去空白与常见标点），上限 `CACHE_LIMIT = 16`，超限整体清空（不做 LRU）。
- 缓存值是 `/person/{id}` 的响应，所以**一次抓取 = 2 次请求**（1 次搜索 + 1 次详情）；详情 404 时退回搜索条目本身。
- 两次请求都带 `language`，简介 / 别名跟着它走；但**姓名本身不本地化**，`name` 恒为原名。

### 8.2 挑人打分

`/search/person` 的结果按「像不像这个名字」打分，而不是取第一条：

| 情形 | 分值 |
| --- | --- |
| 本体姓名完全一致（`normalizeName` 后） | 100 |
| `also_known_as` 别名完全一致 | 80 |
| 本体姓名与查询互含 | 60 |
| 别名与查询互含 | 50 |
| `known_for_department === 'Acting'` 且分数 > 0 | +5 |

排序键 `score * 1000 + min(round(popularity), 999)`——**同分靠人气决胜**（同名演员很常见）；全部候选 `score === 0` 时直接抛错，不做「取第一条」兜底。

### 8.3 字段映射

| `PluginActorDetail` | 来源 | 说明 |
| --- | --- | --- |
| `name` | `person.name` | 必填，缺失即抛错 |
| `aliases` | `also_known_as` | 去掉与本体同名者，截 `ALIAS_LIMIT = 30` |
| `gender` | `person.gender` | `1 → female`、`2 → male`、`3 → other`、`0 / 缺失 → 不写`（宿主只认这四个值） |
| `birthday` | `birthday` | 取 `slice(0, 10)`，不匹配 `YYYY-MM-DD` 就不写 |
| `birthCountry` / `birthProvince` / `birthCity` | `place_of_birth` | 按 `[，,]` 拆：1 段 → 城市；2 段 → 城市 + 国家；≥3 段 → 城市 + 中间段（join `, `）作州省 + 末段作国家；拆不开时整串进城市 |
| `tagline` | `known_for_department` | 翻成中文职业（`Acting → 演员` 等，见 `DEPARTMENT_NAMES`） |
| `overview` | `biography` | 截 `BIO_LIMIT = 3000` 字 |
| `sourceUrl` | `id` | `https://www.themoviedb.org/person/{id}` |
| `height` / `bust` / `waist` / `hip` / `cup` / `tags` | **不产出** | TMDB 没有三围；`tags` 宿主在合并时根本不看 |

`birthCounty` 不产出（TMDB 只有「城市, 州省, 国家」三级）。

### 8.4 图片：头像用 `poster`，其余一律 `still`

类别 `actor` 只接受 `['poster', 'thumb', 'still']` 三种 kind（其余在归一化阶段丢弃），语义是 **`poster` = 头像、
`thumb` / `still` = 图集**；宿主把第一条 `poster` 存成头像（已有头像则跳过），其余按 `scrape.actorImageLimit` 限张存成图集
（`0` = 不存图），所以插件只发 `poster` + `still`：

- **头像**：`profile_path`；缺失时退回 `images.profiles` 里投票最高的那张（按 `vote_average` 降序去重）。
- **图集**：其余 `profiles`（名字 `写真 N`，`PROFILE_SIZE = 'w500'`）+ `tagged_images.results[].file_path`
  （名字取 `media.title` / `media.name`，`STILL_SIZE = 'w780'`），按 path 去重、跳过已被头像用掉的那张。
- 张数：`maxPhotos`（默认 20）限**图集**张数，另硬上限 50；头像不计入。

### 8.5 与宿主 / 影片插件的耦合点

1. **查不到必须抛错，不能返回空资料**：`buildActorPlugin` 把归一化失败（`name` 为空）当 `invokeFailed`；
   而宿主只有「插件抛错」时才 `warn` 并换下一个插件。返回空对象会被当成**命中**，反而堵住其它演员插件。
2. **凭据是另一份配置**：插件按类别独立存储（`meta.id` 相同也互不影响），`apiReadAccessToken` / `apiKey` 要在
   **演员类别里再填一次**——TMDB 密钥通用，复制即可。
3. **姓名口径**：宿主写进 `media_cast` 的是影片插件 `detail.actors` 的名字（TMDB 的英文名），按英文名检索最准；
   手工改成中文名后要靠 `also_known_as` 命中（TMDB 的中文别名并不完整）。
4. **只抓「没抓过 / 没头像 / 没生日」的演员**，批量补全上限 200 人（`ACTOR_SCRAPE_MISSING_LIMIT`），
   所以首次同步大批影片时不会一次打爆 API，但要分几轮才补齐。
5. **超时无压力**：一次抓取只有 2 次请求，远低于单次调用超时（≥30s），不需要像影片插件那样限季数。

## 9. 已知限制与本期不做

- **没有番号**：`search` / `detail` 都不返回 `num`，成人影片库的番号匹配只能靠宿主回落（§7.1）。
- **不产预告片**：YouTube 观看页不是可下载直链（§4）。
- **分集靠逐季请求**：季数多时耗时接近宿主超时；`PLUGIN_LIST_LIMIT = 500` 会截断超长剧。
- **剧集级图集未接**：TMDB 另有 `/tv/{id}/images`（剧集级海报 / 背景图），本期只用了 `poster_path` + `backdrop_path`。
- **不做成人内容**：`include_adult=false`，成人结果跳过。
- **只支持 TMDB 一种数据源**：不带 `external_ids` 反查（IMDb id 只来自 `external_ids`，宿主也没地方用）。
- **不做本地化降级**：`language` 拿不到中文时 TMDB 会回落英文（接口行为），插件不额外重试。
- **演员没有三围**：TMDB 不提供身高 / 三围 / 罩杯，演员插件不产出这些字段（成人演员插件才有）。
- **演员图集全看 TMDB 收录**：冷门演员可能一张 `tagged_images` 都没有，`profile_path` 也可能为空（此时退回投票最高的一张）。
- **演员姓名不本地化**：`/search/person` 的 `name` 恒为原名，中文名只在 `also_known_as` 里，中文名可能命中不了。

## 10. 关键文件

| 文件 | 作用 |
| --- | --- |
| `script/movie/tv/tmdb.js` | 影片信息插件本体（`kind: movie`；`script/` 被 gitignore，本机参考脚本） |
| `script/actor/tmdb.js` | 演员信息插件本体（`kind: actor`，与影片插件互相独立） |
| [src/main/src/modules/scrape/scrapeMatcher.ts](../../src/main/src/modules/scrape/scrapeMatcher.ts) | 候选匹配：影片番号 → 标题判定回落、剧集年份池 + 标题判定 |
| [src/main/src/modules/scrape/scrapeJobPlan.ts](../../src/main/src/modules/scrape/scrapeJobPlan.ts) | 影片流水线的插件调用顺序（`search` → `detail` → `covers` / `extras`） |
| [src/main/src/modules/scrape/scrapeSeriesJob.ts](../../src/main/src/modules/scrape/scrapeSeriesJob.ts) | 剧集流水线：分集对齐、逐集剧照落盘 |
| [src/common/types/plugin/movie.ts](../../src/common/types/plugin/movie.ts) | `PluginMovieCandidate` / `PluginMovieDetail` / `PluginEpisode` 契约 |
| [src/common/types/plugin/normalize.ts](../../src/common/types/plugin/normalize.ts) | vm 返回值归一化与 `PLUGIN_LIST_LIMIT` 截断；演员资料 / 图片 kind 的白名单 |
| [src/main/src/modules/actor/actorScrape.ts](../../src/main/src/modules/actor/actorScrape.ts) | 演员抓取流水线：调用插件、逐字段合并、头像 / 图集落盘 |
| [src/common/types/plugin/actor.ts](../../src/common/types/plugin/actor.ts) | `PluginActorDetail` 契约与 `PLUGIN_ACTOR_ASSET_KINDS` |
| [docs/plugin/01-plugin-module.md](./01-plugin-module.md) | 插件协议本体（先读它） |
| [docs/scrape/01-scrape-module.md](../scrape/01-scrape-module.md) | 刮削流水线与候选匹配口径 |
| [docs/media/02-series-support.md](../media/02-series-support.md) | 剧集多季多集三层模型与还原口径 |
