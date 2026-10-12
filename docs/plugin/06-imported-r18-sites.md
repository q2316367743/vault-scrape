# 新增影片站点插件：amane 源移植记录

本文记录从 amane（`/Users/esion/Documents/workspace/remote/amane/src/amane/crawlers/sites/`）移植过来的 **13 个影片信息（`kind: 'movie'`）插件**的落地口径。`script/` 被 `.gitignore` 忽略，所以本文是仓库内唯一的书面记录 —— 插件实例本身的风格范例见 [05-tmdb-plugin.md](./05-tmdb-plugin.md)，插件契约见 [01-plugin-module.md](./01-plugin-module.md)。

移植命令式的规范（沙箱硬约束、parsel xpath → cheerio CSS 对照表、字段映射表、自检清单）落在工作区内的 `script/_PORTING_BRIEF.md`（同样被 gitignore，属过程文档，不是长期契约）。

## 1. 清单

| 文件（`script/movie/r18/`） | 行数 | 站点 | amane 源 | 入口形态 |
| --- | --- | --- | --- | --- |
| `official.js` | 548 | 29 个制作商官网 | `official.py` | 番号 → 域名路由 → 详情页直连 |
| `avsox.js` | 365 | avsox.click | `avsox.py` | Yii JSON API |
| `theporndb.js` | 401 | theporndb.net | `theporndb.py` | Stash-box GraphQL |
| `iqqtv.js` | 387 | iqq5.xyz | `iqqtv.py` | 关键词搜索页 |
| `xcity.js` | 261 | xcity.jp | `xcity.py` | 关键词搜索页 |
| `airav.js` | 311 | airav.io | `airav.py` | 关键词搜索页 |
| `javlibrary.js` | 280 | javlibrary.com | `javlibrary.py` | 番号检索页 |
| `freejavbt.js` | 370 | freejavbt.com | `freejavbt.py` | 番号搜索页 + 番号复核 |
| `getchu.js` | 275 | getchu.com | `getchu.py` | 关键词搜索页 |
| `giga.js` | 270 | giga-web.jp | `giga.py` | 关键词搜索页 |
| `fc2club.js` | 219 | fc2club | `fc2club.py` | 番号直链探测 |
| `fc2ppvdb.js` | 215 | fc2ppvdb | `fc2ppvdb.py` | 番号直链探测 |
| `kin8.js` | 275 | kin8tengoku.com | `kin8.py` | 番号直链探测（从番号抽数字） |

## 2. 共同约定

13 个文件都遵守同一套房屋规则（与既有插件一致）：

- **纯 JS、无模块系统**：每个文件顶部内联自己用得到的工具函数（`toText` / `uniqueStrings` / `toAbsoluteUrl` / `parseDateValue` / `fetchHtml` / `buildRequestHeaders` / `buildAssetHeaders` …），不 `import` / 不 `require`；
- **`env` 一律 `baseUrl` + `cookies` + `userAgent`**（`official.js` 例外：它是多域名聚合，用 `routes` 代替 `baseUrl`，见第 3.1 节）；每项都是选填，留空回落到源里的官方域与宿主默认 UA；
- **未命中不抛错**：`search` 拿不到候选时返回 `[]`；**服务级错误抛中文错**（HTTP 失败、页面结构变化、被拦截），两类文案分开，宿主会把后者写进刮削日志；
- **`detail` 的 `title` 必须非空**：amane 的 `MediaMetadata.title` 允许 `None`，但宿主 `normalizeDetail()` 在标题为空时判为未命中（`src/common/types/plugin/normalize.ts:174-175`），所以 `airav.js` / `theporndb.js` / `javlibrary.js` 等源允许标题缺失的地方一律回落到番号；
- **`covers` 只产封面类 kind、`extras` 只产花絮类 kind**：这批源绝大多数只有一张横版封面 → 只产出 `thumb`，没有 `poster`；`extras` 多为 `[]`（源没有 `extrafanart` / `trailer_urls` 就不凭空补）；
- **`ctx.log('debug' | 'warn', …)` 记录决策**（命中 / 未命中 / 回落路径），不写 `console.log`；
- **丢弃契约里没有位置字段**：源的 `score` / `external_id` / `source_url` / `genres` / `provider_ids` 等按 [01-plugin-module.md](./01-plugin-module.md) §3 丢弃，不是漏抓。

## 3. 逐站口径

### 3.1 `official.js`（29 个制作商官网，Outvision / Will 集团共用一套 CMS）

- **路由优先级**：`env.routes`（用户配置，每行 `前缀=厂牌或域名`，含 `.` 视为域名）→ **系列前缀表**（`OFFICIAL_SERIES`，如 `ssis` → `s1`）→ **厂牌别名表**（`OFFICIAL_ALIASES`）；详情页路径固定 `https://<域名>/works/detail/<番号小写去横线>`。
- **移植差异**：amane 吃的是 `SearchQuery.partial_result.studio`（前一站刮到的厂牌名），而插件契约里 `search` 只拿到 keyword，因此别名路由改成**在 keyword 文本里找厂牌别名**（先整词相等，再长度 ≥ 3 的子串包含；「美」「V」这类单字别名只做整词匹配，避免误命中）。
- **增补的「存在性校验 + 页面缓存」**：amane 有 `partial_result` 才敢直接拼 URL；插件里 `search` 必须自己抓一次详情页确认确实是作品页（正文以「品番」为唯一锚点判别，这些站的 404 页也带页脚导航），10 分钟内同一 URL 的 `detail` / `covers` / `extras` 共用一次抓取（`OFFICIAL_PAGE_CACHE`，TTL 10 分钟 / 8 条）。
- **年龄确认页**：以 `年齢確認|年齢認証|18歳以上|age verification|are you over 18` 单独识别，命中后抛中文错提示填 Cookie（`error.officialRestricted = true`）；`search` 只对受限页原样抛出，其余失败一律回落 `[]`。
- **字段**：品番（源正则 `([A-Za-z]+[0-9]+)`，与 amane 一样不带横线）、`<title>` 去最后一个 ` | ` 后缀作标题、女優、発売日、収録時間、ジャンル、シリーズ、`title` 后缀 `【…】` 里的厂牌名；`covers` 取`div[class*="p-slider"] img[class*="swiper-lazy"]` 的 `data-src`，回落 `og:image`。
- **asset Referer 取详情页 origin**（30 个厂牌域名各不相同，不能像单站插件那样用 `baseUrl`）。

### 3.2 `avsox.js`（Yii JSON API）

- 先 GET `/cn/` 取 CSRF token，再 POST `/javu/data/api/search`，payload `[{"search":番号,"lang":lang},60,1]`；**沙箱没有 cookie jar**，所以手工把取 token 那次响应的 `set-cookie` 拼到后续 POST（保持「同会话取 token 再调接口」的源语义）。
- `movieFanHao` 大小写无关精确优先、折叠番号兜底；`detail` 从 URL 正则解析 `lang` + `movieId` 再 POST `getMovie`，要求信封 `code == 200` 且 `movieFanHao` 非空。
- 字段映射：`star → actors`、`label → publisher`（输出 `label`）、`length → duration`、`genre → tags`、`description* → plot`、`posterSmall → poster`、`posterLarge → thumb`（按源口径不对调）、`sampleLarge[] → still`；`env.language` 接受 `zh_cn / zh_tw / jp / en`（也接受 `cn / tw / ja / en`，未知按 `cn`）。
- 站点若改成 JS 计算令牌或上 Cloudflare 挑战，插件无法实现（无浏览器渲染）。

### 3.3 `theporndb.js`（Stash-box GraphQL）

- `search` POST `searchScene(term:)`；命中判据与源 `pick_scene` 一致：`code` 非空且 `isSameNumber(code, 番号)`，否则按欧美日期号用「折叠片商 + 发布日期」比对，**只认唯一命中**（多条视为未命中，不回退首条）。
- `movieId` 用源里的伪地址 `gql://scene/<scene id>`（宿主对 `movieId` 不做 URL 校验，只用它回填 `detail`）。
- `apiToken` 是 **`required: true`**：未填写时插件页显示「待填写变量」、调用直接 `envMissing`（与源「无 token 不发请求」一致）；图片 asset 只带 `referer`，**不带 Authorization**，避免把 Token 发给图片 CDN。
- 源里依赖文件哈希的 `_FINGERPRINT_QUERY`（findSceneByFingerprint / OSHASH）与 `check_connectivity` 无法实现：插件契约没有 `file_hash` 入参，也没有连通性自检入口。

### 3.4 搜索页系（`iqqtv` / `xcity` / `airav` / `javlibrary` / `freejavbt` / `getchu` / `giga`）

| 插件 | 检索 | 命中判据 | 备注 |
| --- | --- | --- | --- |
| `iqqtv` | `${base}${prefix}/search.php?kw=` | `span.title` 子 `a` 的标题按空白切词，任一词与番号 `isSameNumber` | 排除「克破 / 无码破解 / 無碼流出」条目；`env.language` 决定 `/cn` `/jp` 前缀；`extras` 取 `div.cover img[data-src]` |
| `xcity` | `{base}/result_published/?q=<去横线番号>` | 取 `table.resultList` 第一个 `/titles/` 链接 | 默认带源 profile 的 `adc=1` cookie；封面相对地址补全（源没做 urljoin，不补下载侧拿不到图） |
| `airav` | `{base}/search_result?kw=<番号>` | 标题以番号开头且 `isSameNumber` 成立 | 内联了 amane 完整 `is_same_number`（含欧美日期号分支）；**源不解析片长，故不产出 `duration`** |
| `javlibrary` | `{base}/cn/vl_searchbyid.php?keyword=` | 番号大写包含于标题大写；都不匹配回落 `results[0]`（源兜底，可能是不相关影片） | 常年 Cloudflare 人机校验，只能靠 `env.cookies`（`cf_clearance`）+ 镜像域绕过 |
| `freejavbt` | `{base}/search/<番号>` | `div.category-page.video-list-item` 内首个链接，`numberFromUrl` 与番号 `isSameNumber` 才命中 | 七类标签解析；`extras` 取 `article a[href*=".jpg"]` |
| `getchu` | `/php/nsearch.phtml?search_keyword=&gc=gc` | 取 `a[href*="soft.phtml"]` 第一条（**源本身不做番号比对**） | 默认带 `getchu_adalt_flag` / `gc` cookie；通过率依赖关键词质量 |
| `giga` | `{base}/top/search?keyword=` | `div.item` 第一条 | `studio` 硬编码 `'GIGA'`；`extras` 取 `ul.sample-image-list img` |

### 3.5 直链探测系（`fc2club` / `fc2ppvdb` / `kin8`）

这三个源只有「用番号拼详情页 URL 再探测」一条路径（没有搜索页兜底），插件如实保留：

- `fc2club`：番号清洗 `fc2[-_]?(?:ppv[-_]?)?` → `{base}/html/FC2-{n}.html`，正文含 `show-top-grids` 即命中；`fc2ppvdb`：`{base}/articles/{n}`，正文**小写含 `"title"`** 即命中（源的判据就这么宽，为等价保留，有误命中风险）；
- `kin8`：从 keyword 抽第一段连续数字当 `movie_id` 探测 `/moviepages/<id>/index.html`（源如此，`KIN8-1234` 会抽到 `8`，amane 的 `docs/dev/content-routes.md` 因此未把该站纳入默认源）；
- 三者的 4xx / 5xx 一律按「没这部片」返回 `[]`（源会抛 `RequestError`，但插件契约要求未命中不抛错）。

## 4. 沙箱差异（本批共同的能力边界）

| amane 有 | 插件沙箱 | 本批的处理 |
| --- | --- | --- |
| httpx cookie jar | `ctx.request` 无 cookie jar | `avsox` 手工搬运会话 `set-cookie`；其余站靠 `env.cookies` |
| Playwright 浏览器后端（过 Cloudflare / JS 渲染） | 只有 Node HTTP 栈 | `javlibrary` / `official` 受限页只能抛中文错并提示填 Cookie |
| JournaledCrawler 抓取缓存 | 无跨方法缓存 | `official` 自己加了 10 分钟页面缓存；其余站 `detail` / `covers` / `extras` 各请求一次 |
| SQLite / 文件系统 | 无文件系统 | `avsox` 之外无影响；`gfriends`（演员类）把本地索引缓存改成内存缓存 |
| `file_hash` 入参、`check_connectivity` | 契约没有 | `theporndb` 的指纹查询与连通性自检未搬 |
| parsel 的 `/text()`（只取首个直系文本节点） | cheerio `.text()`（含全部后代） | 这些站里两者结果一致；`official.js` 因为「品番」栏会混入 `<span>DVD</span>`，单独实现了只取直接文本子节点的 `directText()` |

## 5. 已知欠账

1. ~~`freejavbt.js` 的 `isSameNumber` 只用了 fold 版，源里还带欧美日期号分支~~ —— **已结清**：按 `airav.js` / `theporndb.js` 的做法补齐了 `WESTERN_NUMBER_PATTERN`（`Studio.YY.MM.DD`，2 位年份按 20xx 解读）/ `foldStudio` / `parseWesternNumber` / `isValidYmd`（含闰年与月长校验），`isSameNumber` 现在是「折叠相等 **或** 同为欧美日期号且片商与发布日期相同」，对应源 `parsing.parse_western_number`（`freejavbt.js` 329 → 370 行）；
2. `official.js` 的别名路由是在 keyword 文本里匹配（源用的是上一站的 `studio`），同名前缀站（如 `bi`）的命中率依赖文件名里带厂牌名；
3. `xcity` / `freejavbt` 等站的 `search` 直接拼 URL 未做 `encodeURIComponent`（与源一致），番号里的特殊字符极少见但理论上会失败；
4. 本批全部只做了静态审查（宿主不构建 `script/`），没有跑过真实网络请求 —— 按项目约定（AGENTS.md RL-07）验证由用户执行。
