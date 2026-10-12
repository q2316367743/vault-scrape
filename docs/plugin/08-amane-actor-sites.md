# 新增演员信息插件：amane 源移植记录

本文记录从 amane（`/Users/esion/Documents/workspace/remote/amane/src/amane/crawlers/actor/sites/`）移植过来的 **6 个新增演员信息（`kind: 'actor'`）插件**的落地口径。原仓库的演员插件只有 Javrate / 老师图鉴 / TMDB 三个（见 [04-actor-plugin-examples.md](./04-actor-plugin-examples.md)），这 6 个都是新增。`script/` 被 `.gitignore` 忽略，所以本文是仓库内唯一的书面记录 —— 插件实例本身的风格范例见 [04-actor-plugin-examples.md](./04-actor-plugin-examples.md)，演员类契约见 [01-plugin-module.md](./01-plugin-module.md) §2.5，同批影片插件的移植记录见 [06-imported-r18-sites.md](./06-imported-r18-sites.md)。

## 1. 清单

| 插件（`script/actor/`） | 行数 | 数据来源 | 定位方式 | 产出字段 |
| --- | --- | --- | --- | --- |
| `avbase.js` | 382 | avbase.net（Next.js SSR） | 姓名直连 `/talents/{名}`（站点无检索入口） | name / aliases / gender（仅男優）/ birthday / birthProvince / height / bust / waist / hip / cup / poster / sourceUrl |
| `gfriends.js` | 246 | GitHub raw `Filetree.json` | 艺名 + 后缀精确查表 | name / sourceUrl / poster |
| `javdb.js` | 363 | javdb.com | 搜索页 `f=actor&locale=zh` + 列表精确比对 | name / aliases / gender / poster / sourceUrl |
| `minnano.js` | 490 | minnano-av.com | `search_result.php` + `table.tbllist.actress` 精确比对 | name / aliases / gender（恒 female）/ birthday / birthProvince / birthCity / height / bust / waist / hip / cup / poster / sourceUrl |
| `theporndb.js` | 426 | Stash-box GraphQL | `searchPerformer` + name / aliases 精确比对 | name / aliases / gender / birthday / birthCountry / height / bust / waist / hip / cup / tagline / poster / still / sourceUrl |
| `wikipedia.js` | 496 | Wikidata + 各语言维基百科 | `wbsearchentities` ja→zh→en（各前 5 条）+ 实体双重校验 | name / aliases / gender / birthday / birthCountry / birthProvince / birthCity / tagline / overview / poster / sourceUrl |

## 2. 共同约定

- **返回一位，不是数组**：`actor(name, env, ctx)` 返回一个 `PluginActorDetail`；宿主拿返回的 `name` 去匹配已有演员（姓名 → 别名 → 新建）。`normalizeActorDetail()` 会把空 name 兜底成入参姓名，所以「查不到」**不能**靠返回 `{}` 或 `{name}` 表达。
- **未命中必须抛错，不返回空资料**：6 个插件查不到时一律 `throw new Error('…未收录「X」…')`。返回空资料会被宿主当成命中，既写坏记录，又会**堵住后续演员插件**（后面的源拿不到机会）；HTTP 失败 / 结构变化 / 挑战页同样走 throw，宿主只记一条 warn 日志，不影响影片刮削主流程。
- **`provider_ids` 无位置一律丢弃**：amane 的 `ActorMetadata.provider_ids`（avbase 的 talent id、gfriends 的艺名、javdb 的 actor_id、theporndb 的 `urls { url type }`、wikipedia 的 wikidata / imdb / tmdb / twitter / instagram / fanza）在 `PluginActorDetail` 里没有对应字段，全部丢弃，不是漏抓。
- **身高 / 三围做范围校验**：身高 100–250、胸围 40–150、腰围 30–150、臀围 40–180，越界或非正整数一律当脏值丢弃。amane 多数源只做正则取值（`_int` / `_positive_int`）不校验，这一层是插件补的。
- **模块级缓存**：6 个插件的 TTL 都是 **10 分钟**；条数上限按站点体量与请求成本定（avbase / javdb / minnano / theporndb / wikipedia 各 64 条，gfriends 缓存整份索引故 4 条）。宿主**会分别调用 `actor()` 与 `actorAssets()`**，两者共用同一份缓存，所以同一位演员在一次抓取里只请求一次。
- **纯 JS、无模块系统**：工具函数内联，不 `import` / `require`；失败文案统一 `插件名：…` 前缀，决策用 `ctx.log('debug' | 'warn', …)` 记录，不写 `console.log`。

## 3. 逐站口径

### 3.1 `avbase.js`（AVBASE，382 行）

- `meta.id = 'avbase'`；env：`baseUrl`（选填，默认 `https://www.avbase.net`）、`userAgent`（选填）、`cookies`（选填，**关键是 `cf_clearance`**）。
- 站点**没有演员检索入口**（`/talents?q=` 返回 404），只能按姓名直连 `{baseUrl}/talents/{quote(name, safe='')}`（`quote` 比 `encodeURIComponent` 多转义 `!*'()`）：站点自己把别名解析到人物页，页面 404 就是未命中，不是来源失败。
- 资料全取自 `script#__NEXT_DATA__` 的 `props.pageProps`：`talent.primary` 缺失或无 name 即未命中；`talent.actors[].name` → aliases；`primary.note === '男優'` → male，**站点女优不带性别标记，其余一律不产出 gender**（自由文本推不出）；`meta.basic_info` 给 birthday（ISO / 日文年月日 + 闰年校验）、`prefectures` → birthProvince、height / bust / waist / hip（`_int` 严格口径：NFKC 后必须纯数字，`158cm` 直接丢弃）、cup；`primary.image_url` → poster；sourceUrl 就是构造出的 URL。
- **实测需 `cf_clearance`，否则直连返回 403 `Just a moment...`**：`_cf_chl_opt` 判 challenge、`ray-id` + `cf-` 判 blocked，两种都抛中文提示让用户填 Cookie；amane 靠 Playwright 浏览器后端绕过，插件只有 Node HTTP 栈。
- 已知限制：`birthCountry` / `birthCity` / `birthCounty` 不产出（站点只给都道府县）；`overview` **源里明确不取**（`profile` 出现率仅 5% 且含 HTML）；`tagline` / `tags` 站点没有；无图集，actorAssets 只产一张 poster。

### 3.2 `gfriends.js`（gFriends 头像库，246 行）

- `meta.id = 'gfriends'`；env 只有两项：`baseUrl`（raw 根，默认 `https://raw.githubusercontent.com/gfriends/gfriends/master`）、`repoUrl`（默认 `https://github.com/gfriends/gfriends`，用来拼 sourceUrl 的 blob 页；填成 github.com 域名时会自动推导 raw 根）。
- 源 override 了 `fetch()`、`_search` / `_scrape` 均 `NotImplementedError`，插件同样只有一条「查索引」路径：只拉 `{rawBase}/Filetree.json`（**约 6.5 MB / 10.7 万条**，首次抓取是一次大请求，宿主单次请求超时 30s），按 **艺名 + `.jpg` / `.png` / `.JPG` / `.PNG` 精确匹配**（区分大小写、不做归一化），未命中抛「未收录「X」的头像 —— 索引按「艺名.jpg / 艺名.png」精确匹配，不支持别名、简繁或罗马音，写法不同就会落空」。
- 索引扁平化口径与源一致：`Content` 子目录**按目录名升序**遍历，同一文件名**先出现者保留**（`z-*` 低质量目录排在后面，不会覆盖前者）；值常是 `AI-Fix-xxx.jpg?t=...` 形态，取 `?` 前的部分拼 `Content/{子目录}/{目标文件}`，url 逐段 percent 编码。
- **只产出 name + sourceUrl + 头像**：站点没有任何资料字段（别名 / 性别 / 生日 / 出生地 / 身材 / 罩杯 / 简介 / 标签全都没有），actorAssets 也只有一张 poster；图片在 raw.githubusercontent.com 上，无防盗链，资源不带 headers。
- 已知限制：源把索引写到本地缓存文件（`data_dir/gfriends.json`），插件沙箱无文件系统，**改为模块级内存缓存**（TTL 10 分钟 / 4 条），保留「一次抓取里 actor 与 actorAssets 只拉一次索引」的性质；源的 `check_connectivity()`（探一次 Filetree.json 自检）**未搬**（宿主侧没有对应契约）。

### 3.3 `javdb.js` / `minnano.js`（搜索结果定位，363 / 490 行）

两站都是「搜索页 → 精确比对 → 详情页」，定位规则严格对齐源：

| | `javdb.js` | `minnano.js` |
| --- | --- | --- |
| `meta.id` | `javdb`（JavDB 演员） | `minnano`（みんなのAV 演员） |
| 检索入口 | `GET /search?q=<名>&f=actor&locale=zh` | `GET /search_result.php?search_scope=actress&search_word=<名>&search=Go` |
| 直接落详情 | 页内有 `span.actor-section-name` → 取 `link[rel="canonical"]`（无 canonical 即未命中） | 页内有 `div.act-profile` → 取 canonical / `og:url`，都没有则从头像 `p_actress` 路径的 `/(\d+)\.jpg` 回退 `/actress<id>.html` 重抓 |
| 列表比对 | `div.actor-box a` 的 `strong`（canonical 名）与 `title`（中英文逗号切分）NFKC + 大小写无关**精确比对，不回退首条** | `table.tbllist.actress` 行标题剥掉尾部注记括号后精确比对，href 必须匹配 `actress\d+\.html` |
| 缓存 | 10 分钟 / 64 条 | 10 分钟 / 64 条 |
| env | `baseUrl` / `cookies`（`_jdb_session=...`，部分内容需登录）/ `userAgent` | `baseUrl` / `cookies`（placeholder `age_verified=1`）/ `userAgent` |

- **javdb 字段**：`span.actor-section-name` 逗号切分（首项 name、其余 aliases）；`span.section-meta` 逐 token 认性别（男優 / 男优 / Male → male，女優 / 女优 / Female → female），影片数标注（`N部影片` / `movie(s)`）丢弃、其余并入 aliases；**未标注默认 `female`**（详情页只为男优标注）；头像取 `div.actor-avatar span.avatar` 的 style 里 `background-image: url(...)`，含 `actor_unknow` 按「没有头像」丢弃。源只给姓名 / 别名 / 性别 / 头像 / 来源页，**没有**生日、国籍出生地、身高三围、罩杯、简介、标签。源在直接落详情时会按 canonical 再抓一次，插件复用同一份 HTML（省一次请求，语义相同）。
- **minnano 字段**：名字行 `名前（かな / ローマ字）` 拆出读音进 aliases，`別名` 行可重复、每行一个旧名 + 读音同构解析；资料在 `tr` 行里（`td > span` 是 label、`td > p` 是 value），逐行收成 map 后按 label 取，**不依赖行序**；`生年月日` 归一化；`出身地` 按 都 / 道 / 府 / 県 / 县 切一刀 → birthProvince + birthCity（无标记则整串进 province）；`サイズ` 解析 T/B/W/H 与罩杯（cup 大写且长度 ≤ 4 才产出）；**gender 固定 `female`**（源 profile 声明该站只有女优，页面全站无性别字段）。`birthCountry` / `birthCounty` 从不产出。
- minnano **默认带 `age_verified=1` cookie**（站点用 JS 注入年龄确认弹层，仅在缺该 cookie 时出现），env 里填的 Cookie 按分号拆、**同名覆盖默认值**，与源 `config.cookie` 的合并口径一致；检索入口处于挑战保护，必要时可换浏览器 UA。javdb 图片站校验 Referer，头像资源带 `referer: {baseUrl}/` + UA + Cookie。
- 已知限制：javdb 源里的 `provider_ids = {'javdb': actor_id}` 明确丢弃；minnano 没有简介 / 标签 / 图集，actorAssets 只产一张 poster（地址去掉查询串与 hash）。

### 3.4 `theporndb.js`（Stash-box GraphQL，426 行）

- `meta.id = 'theporndb'`；env 只有两项：`baseUrl`（默认 `https://theporndb.net/graphql`）、`apiKey`（label「API 令牌」，**`required: true`**，与影片版 theporndb 插件是两份独立配置）。
- **没有令牌不发请求**：`readToken()` 为空即抛错，宿主也会因 `required` 在调用前拦下（envMissing）。请求 `POST` GraphQL，`Authorization: Bearer <令牌>`；401 / 403 抛「鉴权失败」、非 JSON 抛「可能被网关拦截」、`errors` 走 GraphQL 错误文案。
- 定位 `searchPerformer(term:)`，只做 name / aliases 的**精确匹配**（NFKC 折叠 + 大小写无关），**不回退首条**（模糊检索会认错人，宁可判未收录）；未命中抛「未收录「X」的演员档案（本站只按姓名与别名精确匹配，不做模糊回退）」。
- `deleted: true` 的条目按 `merged_into_id` 发 `findPerformer(id:)` **最多 4 跳**；成环（id 已见过）/ 过深 / 无目标一律当未命中。
- 字段映射：`name`（缺失即抛）、`aliases`（去同名去重）、`gender`、`birth_date` → birthday（规范成 `YYYY-MM-DD`,源是原样字符串）、`country` → birthCountry、`height`、`measurements.band_size / waist / hip` → bust / waist / hip、`measurements.cup_size` → cup、`disambiguation` → tagline、`/performers/<id>` → sourceUrl。查询字段串刻意只取 `measurements { … }` 而不取较新的顶层 `cup_size`，免得旧 stash-box 拒绝整个查询。
- actorAssets：`images` 按 **宽×高降序**、按 url 去重，第一张 `{kind:'poster', name:'头像'}`，其余 `{kind:'still', name:'写真 N'}`；图片是绝对地址且**无防盗链**，asset 不带 headers。
- 已知限制：overview 与 tags 在 Stash-box performer 结构里没有；`disambiguation` 这类同名消歧说明只够当 tagline；death_date / 出道年 / 发色瞳色 / ethnicity / breast_type / 纹身穿孔不取；`band_size` 按源原样当 bust（尺寸含义偏下胸围，不额外换算）；`urls { url type }` 在源里进 provider_ids，契约无处可放；小档案可能一张图都没有，此时 actorAssets 返回空数组（不是失败）。

### 3.5 `wikipedia.js`（Wikidata + 维基百科，496 行）

- `meta.id = 'wikipedia'`；env：`baseUrl`（Wikidata 接口地址，默认 `https://www.wikidata.org`）、`languages`（词条语言优先级，只认 zh / ja / en，按用户顺序去重，留空或全非法回落 `zh,ja,en`；**不影响 Wikidata 的检索语言**）。
- **实体检索**：`wbsearchentities` 按 **ja → zh → en 逐语言各取前 5 条**，只留 QID 以 `Q` 开头、description 命中 AV 关键词的候选（按 QID 去重、保持语言遍历顺序）；单语言失败不阻断，全部失败才冒泡最后一次异常。拉到 `Special:EntityData/<QID>.json` 后，候选必须同时满足「描述命中 AV 关键词 **或** P106 ∈ 三个 AV 职业 QID」+「labels 或 aliases 任一语言取值与本名 NFKC 折叠后相等」，否则换下一个候选。英文描述还允许「行业词 + 角色词」分离命中（如 `Japanese adult video actress`）。
- **正文**：词条地址来自实体的 `sitelinks`（与源同一个口径），按 `languages` 顺序取第一个有正文的词条，全都没正文时退回优先级最高的那个（元数据仍可用）；**中文维基走 `/zh-cn/` 变体路径**（`/wiki/` 不转换原文）；正文**必须按纯文本请求** —— 引用里的「年齢認証」等词会让 HTML 视图被误判成拦截页。
- **简介（overview）**：只取 `.mw-parser-output` 下的导语段落 + 白名单章节（人物 / 简历 / 经历 / 履历 / 略历 / 来历 / 生平 / 演艺生涯 / プロフィール / 生い立ち / early life / career / biography / personal life）的段落与列表；表格 / figure 内的段落不取、列表内的段落不重复取；标题去 `[編集]`，正文去 `[1]` / `[注 1]` / `[要出典]` 等引用标记；段落级拼装、**上限 1500 字符**，装不下的那一段截到句末再加「…」，剩余空间 < 30 字符不再续接。
- **字段**：name / aliases 取 labels（ja→zh→zh-cn→zh-tw→en→任意）；P21 → gender；P569 → birthday（源用正则取 `±YYYY-MM-DD`，**不校验日期合法性**；信息框「生年 / 出生」兜底走日期归一化）；信息框「出身 / 出生地」先剥国家词、再按逗号或 都道府县州省市 切一刀 → birthCountry / birthProvince / birthCity；P18 → poster（走 `commons.wikimedia.org/wiki/Special:FilePath/...`）；搜索 description（缺失回落实体 descriptions）→ tagline；取不到词条时 sourceUrl 回落 `https://www.wikidata.org/wiki/<QID>`；**`birthCounty` 从不产出**。
- 已知限制：**身高 / 三围 / 罩杯 / 标签结构性缺失**（Wikidata 有 P2048，amane 的源就没取，其余本就没有），不是漏抓；provider_ids（wikidata / imdb / tmdb / twitter / instagram / fanza）无位置；`baseUrl` **只作用于 Wikidata 接口**，词条正文固定直连各语言 `wikipedia.org`，被墙时改 `baseUrl` 走不了镜像；无图集，actorAssets 只产一张 poster。

## 4. 沙箱差异（本批共同的能力边界）

| amane 有 | 插件沙箱 | 本批处理 |
| --- | --- | --- |
| httpx cookie jar + `SiteConfig.cookie` 按同名合并 | `ctx.request` 无 cookie jar | 本批没有「先取 set-cookie 再拼回去」的场景；javdb / minnano 靠 `env.cookies`，minnano 另叠默认 `age_verified=1`（同名覆盖） |
| Playwright 浏览器后端（过 Cloudflare） | 只有 Node HTTP 栈 | avbase / minnano 的挑战页只能抛中文错并提示填 Cookie |
| 令牌直接从配置取 | env 必填校验在调用前 | theporndb 的 `apiKey` 是 `required: true`，未填即 envMissing（源是静默 `return None`） |
| 本地文件缓存（`data_dir`） | 无文件系统 | gfriends 的索引文件缓存改成模块级内存缓存 |
| `check_connectivity()` 连通性自检 | 契约没有 | gfriends / minnano 的自检未搬（minnano 源探的是 `search_result.php` 而非首页） |
| parsel 的 `/text()` / `_plain` | cheerio `.text()` | 这几站的取值口径一致，无需 `official.js` 那样的 `directText()` |
| `ActorMetadata.provider_ids` | `PluginActorDetail` 无此字段 | 6 站一律丢弃 |

- `ctx.request` **状态码不抛错**（`validateStatus` 恒 true），由插件自己判：404 在 avbase 里是未命中，>= 400 在其余站是服务级错误。
- 超时 = `max(1000, options.timeout ?? network.timeout * 1000)`；失败按配置重试、间隔 300ms；两次插件请求之间至少隔 `requestDelay` 秒（模块级串行）。
- 宿主**分别调用 `actor()` 与 `actorAssets()`**，模块级缓存是两者共享同一份数据的唯一手段 —— gfriends 的整份 Filetree 索引尤其依赖这一点。actorAssets 只允许 `poster` / `thumb` / `still`，本批只用 poster 与 still。

## 5. 已知欠账

1. 6 个插件都只做了静态审查（宿主不构建 `script/`），**没有跑过真实网络请求** —— 按项目约定（AGENTS.md RL-07）验证由用户执行；avbase / minnano 的挑战页、gfriends 首次拉 6.5 MB 索引的实际耗时都要真机确认。
2. `gfriends.js` 的索引没有持久化（无文件系统），TTL 一过就重新拉整份约 6.5 MB 的 `Filetree.json`；多演员批量刮削时靠 10 分钟缓存摊平，长任务尾声仍可能重拉一次。
3. `theporndb.js` 的令牌与影片版 theporndb 插件是两份独立配置（源里两者共用同一份 `api_token`），用户需要填两次。
4. `avbase.js` 的 Cloudflare 挑战、`minnano.js` 检索入口的挑战保护都只能靠人工喂 Cookie / 换 UA，插件自身无法自动通过。
5. `wikipedia.js` 的词条语言只认 zh / ja / en（源 `WIKI_LANGUAGES` 就这么窄），其它语言的维基词条拿不到正文，只剩 Wikidata 的结构化字段。
