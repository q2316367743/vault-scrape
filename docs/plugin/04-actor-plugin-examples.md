# 演员信息插件实例：老师图鉴（laoshi.ink）与 Javrate（javrate.com）

本文记录两个真实站点的**演员信息插件**（`kind: actor`）落地口径，既当编写 actor 插件的可复制范例，也当站点适配的踩坑记录。协议本体见
[plugin/01-plugin-module.md](./01-plugin-module.md)，三类契约与触发场景见 [plugin/03-plugin-categories.md](./03-plugin-categories.md)。

## 0. 总览

| 项 | 老师图鉴 | Javrate |
| --- | --- | --- |
| 插件文件 | `script/actor/laoshi.js`（576 行） | `script/actor/javrate.js`（314 行） |
| `meta.id` | `laoshi` （= 文件名 `laoshi.js`） | `javrate` |
| `meta.kind` | `actor` | `actor` |
| 实现方法 | `actor` + `actorAssets` | `actor` + `actorAssets` |
| 资料数据源 | 静态人物索引 JSON + 档案页 HTML | 唯一公开接口 `POST /api/hot` |
| 是否解析 HTML | 是（cheerio，档案页） | **否**（页面被 Cloudflare 拦住） |
| 图集 | 站点无图集，只有头像 | 图集页被 CF 拦住，只有头像（+ 与头像不同的背景图） |
| 三围 / 罩杯 | 站点全站无此数据，一律缺省 | 接口直接给，全部产出 |
| `env` 声明 | `baseUrl`、`userAgent` | `baseUrl`、`userAgent` |

两个文件都在 `script/actor/`，而 `.gitignore` 明确忽略 `script/`（本地参考用的站点脚本不进仓库），所以**本文件是这两个插件在仓库里唯一的书面记录**，站点口径与字段取舍都写在这里。

通用骨架（两个插件一致）：纯 JS、无 `import`，脚本以 `definePlugin({ ... })` 结尾；`meta` 只填 `id / kind / name / version / author / description / homepage`；失败一律 `throw new Error('中文原因')` —— 宿主侧
`actorScrape` 只把它记为一条 `warn` 日志（「插件 X 获取「Y」的资料失败：…」），不影响影片刮削主流程，所以错误文案要写清站点侧原因。

---

## 1. 老师图鉴（laoshi.ink）

### 1.1 姓名定位：不走搜索页

* **`/search.html?q=` 是纯 JS 渲染**：服务端返回的 HTML 里结果容器（`div#content.search-results-grid`）是空的，抓下来什么都拿不到。
* 因此改用站点自己的静态索引：`GET {baseUrl}/assets/data/light/jav.json`（约 412 KB、711 条），字段有
  `author`（中文名）/ `native_name`（日文名）/ `romanized_name`（罗马音）/ `aliases[]`（563 条）/ `actor_rank`（档案号）/
  `profile_completeness`（`high` / `medium` / `basic`）/ `profile_tags` / `description` / `image`。
* 兜底：`GET {baseUrl}/actresses/` 是服务端渲染的 711 条索引（`a[href*="/actresses/actor-"]`，锚内 `strong` 是中文名）。
  这条兜底**只有中文名**，命中率低于 JSON，仅在 JSON 拉取失败或解析为空时启用。
* 详情页 URL 只能**按索引里的档案号拼**：`{baseUrl}/actresses/actor-<NNN>.html`（`NNN = String(rank).padStart(3,'0')`）。
  档案号存在 8 个缺口（231 / 253 / 305 / 336 / 472 / 528 / 698 / 702），绝不能按 `1..max` 遍历探测；带 `.html` 时站点会
  308 跳到无扩展名形式，交给宿主跟随即可。

### 1.2 姓名归一化与择优

站点自身（`search.js`）只做 `trim → toLowerCase → 片假名转平假名（0x30A1–0x30F6 减 0x60）→ 去分隔符`，**完全没有简繁转换**，
所以「三上悠亞」「河北彩伽」连站点自己都搜不到。插件在归一化里补了一张常见异体字表（`LAOSHI_NAME_VARIANTS`：
亚/亞→亜、優→优、澤→泽、結→结、櫻→樱、島→岛、戶/戸→户、嵜→崎、髙→高、恵→惠、紗→纱、瀬/瀨→濑、齊/斉→齐 等），
查询串与候选名走同一次归一化，再用三级打分：

| 分数 | 条件 |
| --- | --- |
| 100 | 归一化后全等 |
| 60 | 双向互相包含（`target.length >= 2`） |
| 40 | 拉丁词全部命中候选键（罗马音 / 英文别名） |

同分时先比 `profile_completeness`（high > medium > basic），再取**档案号更小**者；0 分不算命中，直接报「未收录」。

### 1.3 档案页解析

* 姓名：`h1#profile-name`，先 `clone()` 再 `.find('.spot-roman').remove()` 去掉罗马音小字。
* 资料行：`.spot-fact-table > div`，每行 `span` 是 label、`strong` 是 value，收成 map 后按 label 取值
  （label 去空白后比对，因为页面写的是「国家 / 地区」带空格）——**必须遍历取值，不能依赖行序**。
* 兜底：`script[type="application/ld+json"]` 里 `@graph` 的 `schema.org Person`（`name` / `alternateName[]` / `image` 为绝对 URL）。
  取原始文本时优先 `.html()`，为空再退回 `.text()`（不同 cheerio 解析器对 `script` 内容的暴露方式不同）。
* 简介：`p.profile-lead`；标签：`.spot-tag-cloud span`（全量，`.profile-tags` 只是子集）；`sourceUrl` 取 `link[rel="canonical"]`。
* 出生地拆解：先剥掉国家前缀（`LAOSHI_COUNTRY_TOKENS`），再按「都 / 道 / 府 / 县 / 州」切一刀成
  省州 → `birthProvince`、其后 → `birthCity`；站点没有区县信息，`birthCounty` 从不产出。
* 出生日期同时吃 ISO（`2000-02-29`）与中文（`1993 年 8 月 16 日`）；**只有月日、没有年份的一律丢弃**（站点有 3 条这种数据）。
* `「待补充」「待核验」「暂无」「未知」「无」「-」` 等占位值统一按「没有」处理（`isPlaceholder`）。

### 1.4 字段产出与不产出

| 插件字段 | 来源 | 覆盖率 / 说明 |
| --- | --- | --- |
| `name` | `#profile-name` | 685 / 685 |
| `aliases` | 资料表「别名」「日文名」「罗马音」+ ld+json `alternateName` | 去掉与 `name` 重复项；96 条真别名 |
| `gender` | **硬编码 `female`** | 站点是日本女优专库且全站无性别字段 |
| `birthday` | 资料表「出生日期」 | 178 / 685 |
| `birthCountry` | 资料表「国家 / 地区」 | 685 / 685 |
| `birthProvince` / `birthCity` | 资料表「出生地」拆解 | 154 / 685 |
| `height` | 资料表「身高」（`158cm` / `162 cm` / `155 cm（公开历史资料）` 都能吃） | 79 / 685 ≈ 11.5% |
| `tagline` | 资料表「代表身份」「职业」→ 简介首句 | 站点无 tagline 概念 |
| `overview` | `p.profile-lead` | — |
| `tags` | `.spot-tag-cloud span` | — |
| `sourceUrl` | `link[rel="canonical"]` | 无 `.html` 后缀 |
| **不产出** | `bust` / `waist` / `hip` / `cup` | **站点全站零命中**，不是漏抓 |
| **不产出** | `birthCounty` | 站点无区县粒度 |

图片（`actorAssets`）：

* 头像取 `figure.profile-cover img` 的 `src`，用 `new URL(src, baseUrl)` 转绝对地址（中文文件名由 `URL` 自动编码），
  兜底 ld+json 的 `image`。
* 占位图 `/assets/img/default.jpg`（7 条档案）按「没有头像」处理，返回空数组 —— 交给宿主保留用户手工设的头像。
* 索引 JSON 的 `image` 字段有 6 条 `picsum.photos` 脏数据，**一律以档案页为准**，不要优先用 JSON 的图。
* 站点没有图集：档案页里那 4–6 张 related-card 缩略图属于**别的演员**，绝不能当成 still 返回。

### 1.5 请求特征与缓存

* 站点在 Cloudflare 后面但**没有 Challenge**：不校验 UA、不要求 Cookie / Referer，robots 全放行；
  但对并发敏感（>16 会连接失败或拿到假 404），所以请求全部交给 `ctx.request` 走宿主的串行节奏。
* 404 判断：先看 `response.status >= 400`，再判解析结果里有没有姓名。
* 模块级缓存 10 分钟、上限 64 条：`actor` 与 `actorAssets` 会被宿主**分别调用两次**（见 actor/01 的抓取链路），
  缓存让两次调用只抓一次档案页；索引按 `baseUrl` 缓存，全流程只拉一次。

### 1.6 已知限制

* 「三上悠亞」（繁体）等站点自身未做简繁转换的写法：插件已补常见异体字表，但**未收录的冷僻异体字仍可能定位失败**。
* 档案号缺口的 8 个号里有 2 个（253 友崎亜希、305 青木りん）返回 200 但已下架，页面无姓名，插件会报「档案页解析失败」。
* 站点数据的脱敏程度不一致：索引 JSON 的 `profile_tags` / `description` 未脱敏（「前成人演员」），HTML 与 ld+json 已脱敏
  （「前演艺从业者」）。插件**只信 HTML / ld+json**，不使用 JSON 的这两个字段。

---

## 2. Javrate（javrate.com）

### 2.1 硬阻塞：HTML 页面全部拿不到

* 详情页 / 图集页 / 搜索页**全部被 Cloudflare 挑战保护**：宿主所用的 Node HTTP 栈（`fetch`、`undici`、`https`、axios）
  100% 返回 `403 + cf-mitigated: challenge`。
* 实测唯一可行的传输方式需要三件事同时满足：`curl --http1.1` 加**完整 Chrome UA**（curl 的 TLS ClientHello + HTTP/1.1 + 完整 UA），
  浏览器解出的 `cf_clearance` cookie 无效（绑定 TLS 指纹）。
* 宿主插件只能用 `ctx.request`（Node 栈），所以本插件**不解析任何 HTML** —— 这是与老师图鉴插件的根本差异。
* 镜像 `javrate.net` 是需要 JS 的跳转壳，必须用 `www.javrate.com`；站点无年龄墙 / 登录墙。

### 2.2 唯一可用接口

```
POST {baseUrl}/api/hot?q=<encodeURIComponent(name)>
```

* `GET` 同路径是 405；6 个前端 bundle 全量 grep `/api/` 只找到这一处，其余 `/api/*` 全 404。
* 返回 `{ code: 200, message: "", data: { actors: [...], movies: [...] } }`；**对任何客户端都放行**（不带 UA / Cookie 也 200）。
* 站点在服务端自己做别名、简繁与异体字归一：`三上悠亚` / `三上悠亞` / `Yua Mikami` / `鬼頭桃菜` 都能命中同一人。
* **查询串少于 3 个字符没有结果**（1 字符 `actors: null`，2 字符空数组）—— 定位失败时插件会把这条提示拼进报错文案。

### 2.3 字段映射

| 插件字段 | 接口字段 | 处理 |
| --- | --- | --- |
| `name` | `displayName` | 缺失即报错（接口结构变化的信号） |
| `aliases` | `names[]` | 排除与 `displayName` 归一化后相同的项（接口里有重复项） |
| `gender` | `gender` | 只接受 `female` / `male` / `other` |
| `birthday` | `birthDate`（`1993-08-16T00:00:00`） | 截前 10 位，再校验 `YYYY-MM-DD` |
| `height` | `tall` | 100–250 范围校验 |
| `bust` / `waist` / `hip` | `size_B` / `size_W` / `size_H` | 40–150 / 30–150 / 40–180 范围校验，脏值直接丢 |
| `cup` | `size_Cup` | 转大写，长度 > 4 丢弃 |
| `overview` | `description` | — |
| `tagline` | `description` 首句 | 站点无 tagline 概念 |
| `tags` | `keywords[]` | 优先 `keywordName`（与标签页 URL `/keywords/actor/<name>` 同名），回落 `displayContent` |
| `sourceUrl` | `id` | `{baseUrl}/actor/detail/<API id>.html`（宿主 301 到 canonical id，浏览器打开没问题） |
| `birthCountry` | `country`（GUID） | **只映射日本** `197f3e2e-cc49-4ad2-8a90-62dc8c814391`；其余 GUID 留空不猜 |

站点**不提供出生地**（无「出生地 / 國家 / 國籍 / 地區」字段），所以 `birthProvince` / `birthCity` / `birthCounty` 一律缺省。

### 2.4 取值与去重

* 命中择优：先在本地按「归一化全等 100 → 双向互相包含 60」打分；全都不打中时直接用**接口返回的第一条**
  （接口已按相关度排序，站点自己的答案就是它）。归一化只做 `NFKC + 小写 + 去分隔符`，异体字归一交给站点。
* 图片 CDN 是 `https://picture.avking.xyz`（BunnyCDN，无防盗链，不需要任何 header）：
  `actorAssets` 返回 `poster = coverUrl_Thumb`（`..._thumbnail.webp`）。
* `coverUrl`（`..._s.webp` 背景大图）只有在**文件名主干与头像不同**时才额外产出一张 `still`（`imageStem` 去掉目录、扩展名与
  `_thumbnail / _s / _t / _b` 等尺寸后缀后比较），避免同一张图被下载两次。

### 2.5 已知限制

* **图集（still）拿不到**：唯一的图集数据在 `/actor/picture/<API id>.html` 的 HTML 里（每页 40 张，
  `.waterfall-item.picture-item a[data-picture-url]`），而该页同样被 CF 拦住；接口的 `pictures` 字段恒为 `null`。
  要补图集需要宿主提供 curl 类 / curl-impersonate 传输层，或由用户在浏览器里另取。
* 详情页里 A 片 tab 的路径带 6 位随机前缀（如 `/gep8us/actor/movie/<id>.html`），**不可硬编码**；插件不需要它。
* `country` GUID 只采到 2 个样本（日本、國產），因此只映射日本，其余国籍留空，等后续补样本再扩表。

---

## 3. 手工验证清单（由用户执行）

插件不参与 `yarn typecheck`（`script/` 不在 tsconfig 范围内），因此装上后建议按下面顺序各验一次：

1. 插件页导入 `script/actor/laoshi.js`、`script/actor/javrate.js`，确认落在「演员信息」tab、id 不冲突。
2. `老师图鉴`：用「三上悠亚」抓一次 → 应命中 `actor-002`（中文名 / 别名 / 生日 1993-08-16 / 头像）；
   再用「三上悠亞」「Yua Mikami」各抓一次，应命中同一档案。
3. `Javrate`：用「三上悠亜」抓一次 → 应有身高 159、三围 85/57/88、罩杯 G、生日 1993-08-16、标签与头像；
   用「波多野結衣」应命中同一人。
4. 反例：老师图鉴故意用一个不存在的名字 → 报「未收录」且不影响影片刮削；Javrate 传 1–2 个字符 → 报错里带「少于 3 个字符」提示。

## 4. 后续可扩展点

* 两个插件都只声明了 `baseUrl` + `userAgent`：换域 / 镜像时在插件配置区块覆盖即可，不用改文件。
* 若宿主未来提供 curl-impersonate 类传输层，Javrate 的图集与老师图鉴之外的站点都能按同样套路（先试接口、再解析 HTML）补全。
