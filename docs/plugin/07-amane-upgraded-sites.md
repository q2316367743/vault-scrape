# 重复站点插件升级记录：用 amane 新源就地合并

本文记录 **11 个已有影片插件（`kind: 'movie'`）的就地升级**：`meta.id`、`env` 里已有的 key、以及应用里已经能用到的能力全部保持不变，只把 amane 新源（`/Users/esion/Documents/workspace/remote/amane/src/amane/crawlers/sites/`）里多出来的字段、接口、选择器与容错合进原实现。与 [06-imported-r18-sites.md](./06-imported-r18-sites.md) 的「新站移植」不同，这批的判定口径一律是「**只增不减**」：新路径失败就 `ctx.log` 后回落到原路径，绝不因为合入 amane 而砍掉原有能力。`script/` 被 `.gitignore` 忽略，所以本文是仓库内唯一的书面记录；插件契约与字段映射见 [01-plugin-module.md](./01-plugin-module.md) §2 / §3。

## 1. 升级总表

行数为 `wc -l` 实测（「前」是升级前快照，「后」是当前文件）。

| 插件（`script/movie/r18/`） | 升级前 → 后行数 | 对应 amane 源 | 主要新增 |
| --- | --- | --- | --- |
| `faleno.js` | 334 → 499 | `wp_works.py`（1-181）+ `faleno.py`（12-19） | WP REST slug 精确存在性判定、ACF 字段映射、发行商前缀映射、`numberFromSlug` |
| `dahlia.js` | 349 → 496 | `wp_works.py`（1-181）+ `dahlia.py`（6-14） | 同上（无 `rest_prefix`）、发行商恒 `DAHLIA`、slug 还原展示番号 |
| `avbase.js` | 498 → 500 | `avbase.py`（1-244） | `work_key` 去前导零、`query_forms` 多形态、`pick_candidate` 择一、`volume` 时钟串时长 |
| `javdb.js` | 363 → 461 | `javdb.py`（12-151） | 条目声明番号字段比对、多轮 terms 检索、`時長 → duration`、`&locale=zh`、封禁 / 版权文案 |
| `javbus.js` | 340 → 418 | `javbus.py`（13-121） | 详情直链探测、折叠番号比对、`長度 → duration`、poster 路径变体 |
| `jav321.js` | 454 → 497 | `jav321.py`（11-67） | 品番 / 発売日 / レーベル / 女優字段、`収録時間 → duration`、`ジャンル` 字段范围、snapshot 直链 |
| `fc2.js` | 329 → 349 | `fc2.py`（16-90） | 番号锚定剥离、卖家名新来源、`a.tagTag` 标签 |
| `mgstage.js` | 320 → 395 | `mgstage.py`（12-102） | 详情直链探测 + 品番 / 剧照校验、`収録時間 → duration`、`a#EnlargeImage`、`ul#sample-photo`、`dl#introduction` |
| `prestige.js` | 221 → 355 | `prestige.py`（1-174） | SKU JSON 主路径、`num` 与 `duration`、发售日兜底链、maker / label / series 三形态、`/api/media/` 拼装、403 提示 |
| `dmm.js` | 1096 → 1313 | `dmm.py`（12-580）+ `dmm_api.py`（129-238） | `cidToNumber` 番号还原、搜索候选三段优先级、数字版 GraphQL 兜底、dt/dd 新版详情页、JSON-LD 标题 / 封面兜底 |
| `dmm-tv.js` | 1054 → 1362 | `dmm.py`（19-530）+ `dmm_api.py`（1-159） | FANZA TV / DMM TV 两条 GraphQL、GraphQL 请求层泛化、TV 搜索兜底、按资产主机切 Referer |

## 2. 共同约定

- **REST / JSON 优先，HTML 兜底**：新接口能用就用，解析不出版本差异的字段就回落原选择器；`faleno` / `dahlia` 的 WP REST、`prestige` 的 SKU JSON 都是主路径，`mgstage` / `javbus` / `jav321` 的「详情直链探测」都是搜索前的第一跳。
- **新增路径失败只降级，不抛错**：探测 4xx、非 JSON、字段缺失一律 `ctx.log('debug' | 'warn', …)` 后走原路径（`faleno.js:241-244` 的 `restUnavailable` 是范例）；只有「详情页确实拿到了但标题解析不出来」才抛中文解析失败错——宿主 `normalizeDetail()` 把空标题判为未命中，所以标题为空等于失败。
- **`search` 未命中返回 `[]`，服务级错误才抛中文错**：源里「全失败即抛 `RequestError`」的地方（`prestige.py:69-70` 等）在插件里改成回落。
- **番号折叠口径**：大小写、短横线、空格无关，**下划线 `_` 不参与 `-` 折叠**（`javdb.js` 的 `isSameNumber` / `javbus.js` 的 `foldNumber`）；数字段前导零另按 `work_key` 口径消去（`avbase.py:107-110`）。
- **唯一命中才认**：候选多条时不再盲取首个（源里 `urls[0]` 的习惯不搬），要么按声明番号精确比对，要么按归一化包含关系取唯一一条，否则返回 `[]`；`javbus` 的 `/{番号大写}` 与 `avbase` 的四级评分是仅有的两处显式兜底，都带 `matched` / 日志标记。
- **不引入模块系统**：每个文件顶部内联自己用得到的工具函数（`toText` / `normalizeCode` / `uniqueStrings` / `toAbsoluteUrl` / `parseDateValue` / `parseRuntime` / `extractText` / `buildRequestHeaders` / `buildAssetHeaders` …），不 `import` / 不 `require`。
- **日志一律 `ctx.log`**，不写 `console.log`；**图片 asset 带站点 Referer**（部分站点还要 Cookie，见各站）。
- **契约里没有位置的字段直接丢弃**（`score` / `external_id` / `source_url` / `genres` / `provider_ids` 等），不是漏抓。

## 3. 逐站口径

### 3.1 `faleno.js` / `dahlia.js`（WordPress 系 CMS）

两站共用 `wp_works.py` 的框架，只有站点常量不同（`faleno.py:12-19`：`rest_prefix="/top"`、`studio="FALENO"`、`default_publisher="FALENOstar"`、`publisher_prefixes={"mgold":"maryGOLD","jimmy":"JimmyScandal"}`；`dahlia.py:9-10`：无 `rest_prefix`，厂商与发行商同为 `DAHLIA`）。

- **`meta.id`**：`faleno` / `dahlia`；**`env`**：`baseUrl`、`cookies`（年龄确认 / 登录墙）、`userAgent`，三项全选填。
- **search 的存在性判定**：`slugify`（`wp_works.py:74-76`，只留 `0-9a-z` 并小写）→ `GET {base}{rest_prefix}/wp-json/wp/v2/works?slug=<slug>`（`wp_works.py:126-127`）→ 只认 `post.slug` 小写全等（`_search` 146-156）。**REST 正常但未命中即判定「不存在」，直接返回 `[]`，禁止改用 HTML 详情页判定存在性**（`wp_works.py:1-8`：站点会把未发布 slug 302 到别的作品，例 `/works/fns1/` → `/works/fns108/`）。只有 REST 不可用（网络 / 状态码 / 非数组 JSON）才回落：`faleno` 走原 `/top/?s=` + `.text_name a`，`dahlia` 走直链 `/works/<番号去横线小写>/`（页面有 `h1` 就复用该文档，否则 `.text_name a` 按归一化番号比对）。
- **detail / covers / extras**：REST 的 ACF 字段与预生成图片为主（`wp_works.py:158-181`），HTML 详情页补标签 / 导演 / 系列 / 剧照 / 预告。ACF 映射：`作品名` → 标题、`出演女優` → actors（`splitActors` 按 `/`、`、`、`,`、空白切，`wp_works.py:87-91`；标题尾部演员串按 `wp_works.py:94-103` 剥掉）、`作品紹介文` → plot、`収録時間` → duration、`発売日（表示用）` → releaseDate；`images.main_photo_url` → thumb、`sub_photo_url` → poster、`gallery_urls` → still（**gallery 里的 `null` 单项丢弃**，`wp_works.py:43-47` + `59-62`）。
- **`num`**：由 URL 末段 slug 还原展示形态（`numberFromSlug`，`wp_works.py:79-84`）：`fns241sp` → `FNS-241SP`、`dldss001` → `DLDSS-001`。
- **publisher**：`faleno` 按番号前缀映射（`mgold` / `jimmy`）→ 页面 `メーカー` → 缺省 `FALENOstar`；`dahlia` 恒 `DAHLIA`。
- **已知限制**：两站都有图片防盗链，asset 一律带 Referer；REST 挂掉时只回落到 HTML 搜索，HTML 兜底的命中率依赖站内搜索质量。

### 3.2 `avbase.js`

`meta.id` = `avbase`；`env`：`baseUrl`、`cookies`、`userAgent`（全选填）。数据全部来自页面内嵌 `script#__NEXT_DATA__`（`avbase.py:1-9`：站点无公开 API，`/api` 404 且 robots 禁止；`/works/{番号}` 404，规范条目是 `/works/{prefix}:{work_id}`）。

- **番号归一**：`workKey`（`avbase.py:107-110`）去分隔符 + 小写，再按 `\d+ | [a-z]+` 分段、数字段取整消前导零，因此 `SSIS-049 ≡ SSIS-49`。
- **多形态检索**：`queryForms`（`avbase.py:91-104`）依次试「原样 → 去分隔符 → 补短横线」（补横线只在原串没有 `-` 时），逐个请求 `/works?q=`；归一化后相等才算候选。
- **择一**：`pickCandidate`（`avbase.py:113-128`）单条即取；多条时按「含本番号商品的条目」`hasNumberProduct`（131-141）排序后取唯一，再取无 `prefix` 的唯一者；两个信号都不唯一时退回原有四级评分（商品数 → 元数据丰富度 → 剧照数 → `min_date`）。
- **时长**：取 `iteminfo.volume`（`avbase.py:220-229`）：纯数字当分钟、时钟串 `1:49:00` 按「时 × 60 + 分」换算，其它形态才沿用原有的「首个 1-4 位数字当分钟」——这修掉了旧实现把 `1:49:00` 当 1 分钟的 bug。`release` 取 `min_date` 的 JS `Date.toString()`，按字面月 / 日 / 年解析（232-240）。
- **已知限制**：剧照取「剧照最多、元数据最全」的商品的 `sample_image_urls`（`pickSceneImageProduct`），可能不是用户真正点开的那件商品；`iteminfo.description` 是截断文本，plot 质量有限。

### 3.3 `javdb.js`

`meta.id` = `javdb`；`env`：`baseUrl`、`cookies`（`_jdb_session`，会员内容才需要）、`userAgent`（全选填）。

- **检索**：`GET {base}/search?q=<term>&locale=zh`（`javdb.py:50-59` 固定 `locale=zh`；页面按 `Accept-Language` 本地化，请求头固定 `zh-TW,zh;q=0.9`，否则解析规则对不上）。`terms=[number, western.alternate]`（`javdb.py:33-48`）：`xx.xx.xx` 形式的旧番号前缀补成 `20xx` 后，再用另一种年份写法补搜一轮。
- **判等**：先按条目**声明的**番号字段 `div.video-title strong`（`javdb.py:50-59`）与入参 `isSameNumber` 比对（大小写 / 短横线 / 空格折叠，`_` 不折叠；欧美日期号另按折叠片商 + 日期判等）；不中再按「标题含大写番号」精确命中，最后按「标题 + meta 归一化后含归一化番号」模糊命中，都比不中返回 `[]`。
- **新增字段**：`時長|时长|Duration` → `duration`（`javdb.py:61-137` + `_parse_runtime:139-144`）；`num` 取 `a.button.is-white.copy-to-clipboard` 的 `data-clipboard-text`（源实现的声明番号来源）；演员优先 `a.actor-female`，缺失时退回 `演員:` 行内链接。
- **covers / extras**：`img.video-cover` 作 thumb，poster 由 thumb 的 `/covers/` 换成 `/thumbs/`；`div.tile-images.preview-images a.tile-item` 作剧照，`video#preview-video source` 作预告。
- **登录态与 Cloudflare 的边界**：源里所有请求都带 cookie，会员内容要填浏览器 Cookie；但源过 Cloudflare 挑战靠 amane 的 `net/browser.py`（切浏览器后端），**插件沙箱没有浏览器后端**——遇到「Just a moment」挑战页只能先在浏览器完成验证、再把 Cookie 填进配置。IP 封禁 / 版权地区限制走源里的独有文案，抛中文提示。
- **已知限制**：图片站校验 Referer，所有图片 asset 带站点 Referer 与 Cookie。

### 3.4 `javbus.js`

`meta.id` = `javbus`；`env`：`baseUrl`、`cookies`（可留空）、`userAgent`（全选填）。

- **检索**：先按源 `_search`（`javbus.py:24-56`）直访 `{base}/<番号>`，正文含 `movie-box` 且 `h3` 有标题即当详情页命中；否则回退 `/search/<番号>&type=&parent=ce`，逐条比对 `a.movie-box` 里 `div.photo-info date` 声明的番号（先大小写无关全等，再 `foldNumber` 折叠比对），最后保留既有兜底：按 href 末段归一化比对，全不中回落 `/{番号大写}`（**这条路径源里没有**，只有 debug 日志标 `matched=false`）。
- **新增字段**：`長度|长度|Length|収録時間` → `duration`（`javbus.py:58-114` + `_parse_runtime:116-121`）；poster 由缩略图推导，按源口径分形态：`/pics/` 走 `/cover/` → `/thumb/`、`/imgs/` 走 `/cover/` → `/thumbs/`，其余统一 `/cover/` → `/thumb/`。
- **Cookie 口径**：源 profile 固定带 `cookies={"dv":"1"}`（`javbus.py:13-22`，站点自己的地区 / 年龄开关），插件默认带上，用户填的 Cookie 追加在后面（同名以后者为准）；年龄 / 地区验证页与登录墙抛中文提示。covers 产 thumb + poster，extras 取 `#sample-waterfall a`，asset 带站点 Referer。
- **已知限制**：沙箱无浏览器后端，验证墙只能靠 Cookie。

### 3.5 `jav321.js`

`meta.id` = `jav321`；`env`：`baseUrl`、`cookies`（`PHPSESSID`，部分内容需要登录）、`userAgent`（全选填）。

- **检索**：先按源 `_search`（`jav321.py:16-24`）探测 `GET {base}/video/<番号>`，`div.panel-heading h3` 有标题即命中；否则回退既有 POST `/search`（表单 `sn=<番号>`）——若响应里的 `div.panel-heading h3` 有标题说明搜索被重定向成详情页，此时 `id` 用 `{base}/search?sn=<番号>`，`detail` 据此重放 POST；否则在 `a[href*='/video/']` 里按归一化番号挑详情链接（`pickSearchResultDetailUrl:93-115`）。
- **新增字段**：`div.col-md-9` 的 `<b>标签</b>: 值` 内联 HTML 里抠 `品番` / `配信開始日` / `発売日` / `メーカー` / `レーベル` / `出演者` / `女優` / `ジャンル` / `収録時間`；`収録時間` → `duration`（源 `jav321.py:43-44` + `_parse_runtime:62-67`），`レーベル` → label（缺失回落 studio）。`num` 的兜底链：`品番` → 标题里的 `[A-Za-z]+-\d+` → `/video/<番号>` 末段 → 搜索入参。
- **covers / extras**：`img.img-responsive` 作 thumb（缺失回落 `div.panel-body` 内首个 img）；`a[href*='/snapshot/']` 逐条解析剧照直链（`data-original` / `src` / `onerror` 回落，实在拿不到才按 `/snapshot/<contentId>/<n>/<i>` 拼 `jp-<i>.jpg`）。类别优先取 `ジャンル` 字段内的链接，缺失时回落页面内全部 `a[href*='/genre/']`。
- **已知限制**：源里没有搜索页路径，POST 兜底是既有实现；演员范围仍以全页 `/star/` 链接优先、`出演者` 字段链接兜底。

### 3.6 `fc2.js`

`meta.id` = `fc2`；`env`：`baseUrl`、`cookies`（年龄确认）、`userAgent`（全选填）。

- **番号锚定剥离**：`normalizeFc2Number`（合并 `fc2.py:72-75`）先吃空白，再按**锚定前缀**剥 `FC2-PPV` / `FC2`，因此 `FC2 PPV 123`、`FC2123`、`fc2-ppv-123-` 都归一到 `123`；清洗后必须只剩数字，否则不发请求、直接返回 `[]`。
- **检索**：搜索页即详情页，直链 `{base}/article/<归一化番号>/`；命中「お探しの商品が見つかりません」等未找到标记时返回空候选（`fc2.py:16-21`）。
- **新来源**：卖家名（源 `fc2.py:51` 的 `items_article_headerInfo ul li:last a`）与标签（`fc2.py:53` 的 `a.tag.tagTag`）合入 `extractSellerName` / `extractGenres`，都排在既有选择器之后作兜底；标签结果过滤掉 `無修正`。标题里 FC2 塞的隐藏水印（带内联 `style` 的元素）会被剔除。
- **已知限制**：该站没有演员与预告片字段，`series` 固定「FC2系列」，`publisher` 与 `studio` 相同；番号展示形态沿用既有的 `FC2-<digits>`，**与 amane 的 `FC2-PPV-<digits>`（`fc2.py:32`）不同**。

### 3.7 `mgstage.js`

`meta.id` = `mgstage`；`env`：`baseUrl`、`cookies`（插件已固定带 `adc=1`，此处填其它 Cookie）、`userAgent`（全选填）。

- **详情直链探测**：先探 `{base}/product/product_detail/<番号>/`（`mgstage.py:19-29`），但判据加强为「能解析出标题 **且** 带详情页标记（`品番` 或剧照区）」，避免站点把不存在的番号重定向到首页后被误判；探不到再走搜索页 `a[href*='/product/product_detail/']`，按归一化番号比对取详情页，比对不中返回空候选（源 `mgstage.py:44` 是 `urls[0]` 盲取首个，不采纳）。
- **新增字段**：`収録時間` → `duration`（`mgstage.py:65-66` + `_parse_runtime:97-102`）；封面多一条 `a#EnlargeImage` 大图（`mgstage.py:73`）；剧照多一条 `ul#sample-photo li a`（`mgstage.py:76`）；简介多一条 `dl#introduction dd p.introduction`（`mgstage.py:78`）；出演与 `ジャンル` 走 `th → td` 里的链接作兜底（`mgstage.py:60` / `71`）。
- **请求头**：固定 `accept-language: ja-JP,ja;q=0.9` 与 **`cookie: adc=1`**（`mgstage.py:15` 的 profile cookie），用户 Cookie 以 `adc=1; <用户 Cookie>` 合并；封面与剧照都带站点 Referer。
- **已知限制**：`品番` 缺失时 `num` 回落 URL 末段；源里的 rating（レビュー平均 × 2）契约无位置，丢弃。

### 3.8 `prestige.js`

`meta.id` = `prestige`；`env`：`baseUrl`、`cookies`、`userAgent`（全选填）。

- **search 主路径**：SKU JSON `{base}/api/sku/item/<skuId>`（`prestige.py:34-35`），候选 4 形态：`ABW-350` / `ABW350` / `GOOEABW-350` / `GOOEABW350`（`prestige.py:40-47`）；命中 `parentProduct.uuid` 就取其 `${base}/api/product/<uuid>`（67）。单个候选的 4xx / 非 JSON 都只记日志继续试下一个（`prestige.py:49-72`）；`/api/search?...searchText=` 降为兜底，在 `hits.hits` 里找 `_source.deliveryItemId` 以「番号大写」结尾的那条。
- **新增字段**：`num` 取 `sku[]` 里**非** `GOOE` / `GOO` 前缀的 `deliveryItemId`（特典 SKU 不算番号，`prestige.py:79-90`）；`playTime` → `duration`（97）；发售日兜底链 `sku[0].salesStartAt`（既有）→ `mgsStartAt` → `createdAt`（93-95）；`maker` / `label` / `series` 支持对象、数组、裸字符串三种形态（118-126）；`maker` → studio（缺失缺省 `プレステージ`）、`label || maker` → publisher；演员 / 分类 / 导演从 `actress` / `genre` / `directors` 数组取名。
- **图片 / 预告**：`path` 已是 `http` 开头时直接用，否则拼 `${base}/api/media/<path>`（`prestige.py:133-137`）；`packageImage.path` 作 thumb、`thumbnail.path` 作 poster（源注释 `prestige.py:139` 说明两字段是**交叉使用**的：`thumbnail` 竖版前封走 poster 槽、`packageImage` 横版整幅走 thumb 槽），`media[]` 作剧照、`movie.path` 作预告。
- **403 提示**：站点限定日本 IP，非日本网络会被 CloudFront 拦成 403，插件对 403 抛中文提示「该站限定日本 IP，CloudFront 会拦截非日本网络」（`prestige.py:1-4`）。
- **已知限制**：`/api/search` 按源 docstring `prestige.py:3` 的口径「只索引在售商品、且有模糊匹配」，兜底检索可能有误匹配；源里的连通性探测 `_PROBE_SKU`（`prestige.py:16`）契约无位置，未搬。

### 3.9 `dmm.js`（DMM / FANZA 通販）

`meta.id` = `dmm`；`env`：`baseUrl`、`cookies`、`userAgent`（三项 key 与升级前一致，未新增）。源 `dmm.py`（580 行）+ `dmm_api.py`（238 行）里属于**通販（mono / digital / video / prime / monthly / rental）**的部分合入本文件，流媒体部分（FANZA TV / DMM TV）归 3.10。

- **番号还原**：`cidToNumber(cid)`（`dmm.py:532-543`）去 `^[a-z]_\d+` 前缀、去 `(so|sp|tk|hd|hhb|hib)$` 后缀、`^([a-z]+)0*(\d+)` → `PREFIX-digits`，其余形态 upper；**下划线只作前缀分隔符，不参与 `-` 折叠**。`deriveNumberFromUrl` 改走 `getDmmVideoContentId` / `extractUrlContentId`（`/(?:cid|id|content)=([^/&?]+)/`，`dmm.py:149-165`）再交给 `cidToNumber`。
- **搜索候选排序**（`collectDetailCandidates`）：第一键仍是既有的 `matchIndex`，之后依次是 `dmmSearchDetailPriority`（digital / video 100、`tv.dmm.co.jp` 90、`tv.dmm.com` 80、mono 60、prime 50、monthly 40、rental 30，`dmm.py:19-39` + `42-57`）与 `exact`（cid 与检索番号含 00 变体全等者优先，`sora00652a` 这类带后缀变体排后，`dmm.py:149-165` 的 `_selection_key` / `_url_content_id`），最后才是页面顺序。`unescapeDetailUrl` 由「只还原 `\/`、`\u0026`」改成通用 `\uXXXX` 还原（`dmm.py:124-147`）。
- **数字版 GraphQL 只作兜底**：`DMM_DIGITAL_GRAPHQL_QUERY`（`FetchDigitalContent`）/ `buildDmmDigitalPayload` / `parseDmmDigitalGraphQlData` / `tryDmmDigitalGraphQl`（`dmm_api.py:164-191` + `dmm.py:183-233`），仅当 HTML 路径失败且 `parseDmmCategory === 'digital'` 时启用 —— 该查询不带 `relatedTags`，当主路径会丢「関連タグ」。`loadDmmDetail` 因此拆成 `parseDmmHtmlDetail`（原 HTML 体）+ `loadDmmDetail`（video-like 先走 video GraphQL；否则 HTML，catch 后按 digital 走数字版兜底，再失败重抛原错）。
- **新版详情页选择器**：`DMM_DETAIL_SCOPES = ['#multi-column', '#single-column']` + `findDmmDefinitionCell`（`dt` → `next('dd')`）+ `extractDmmDefinitionValues`（`span.content-detail__text` → `a` → `dd` 文本），**原 tr/th/td 表格路径完整保留作兜底**（`dmm.py:236-241` + `243-384`）。
- **`parseMonoLikeDetail` 升级**：`収録時間` → `durationMinutes`（在 `parseDmmHtmlDetail` 里 ×60 成 `durationSeconds`，保证 `detail()` 的 `toMinutes` 往返精确，`dmm.py:545-550`）；标题补 JSON-LD `name` 兜底；封面补 JSON-LD `image`（追加在既有 `og:image` 之后，不改既有封面输出）；plot 改为多段落 `join('\n')`；`メーカー` / `レーベル` / `シリーズ` / `監督` / `出演者` / `ジャンル` 全走 dt/dd + 表格双通道。
- **已知限制**：`発売日` 仍优先于 `配信開始日`（与源相反，保留通販插件既有语义；digital 路径另有 GraphQL `deliveryStartDate`）。

### 3.10 `dmm-tv.js`（DMM TV 流媒体：FANZA TV + tv.dmm.com）

`meta.id` = `dmm-tv`；`env` 同 `dmm.js`（未变）。源里两个流媒体入口按 URL 主机分派：`tv.dmm.co.jp` 的 FANZA TV（`content=`）与 `tv.dmm.com` 的 DMM TV（`seasonId=(\d+)`）。

- **两条新 GraphQL**：`api.tv.dmm.co.jp/graphql` + `DMM_FANZA_TV_QUERY`（`FetchFanzaTvPlusContent`，variables `{id, device, isForeign}`，`dmm_api.py:7-39`）→ `parseFanzaTvData`（`dmm.py:439-488`：`number = cid`、`duration = playInfo.duration`、actors = actresses、studio = maker、publisher = label ‖ maker、series、trailer 复用既有 `buildTrailerFromPlaylist`（`dmm.py:570-580`）、thumb = `packageLargeImage` / poster = `packageImage`（480-481）、剧照 = `samplePictures[].imageLarge`）；`api.tv.dmm.com/graphql` + `DMM_TV_COM_QUERY`（`FetchVideo`，`{seasonId, device}`，`dmm_api.py:98-127`）→ `parseDmmTvComData`（`dmm.py:490-530`：`staffs` 的「監督」→ director、`制作プロダクション` / `制作` / `制作著作` → studio、release = `startPublicAt`、thumb = `packageImage`、poster = `keyVisualImage`）。
- **端点分派**：`loadDmmTvDetail` 开头按主机直接走两条新 GraphQL，命中即返回；失败只 `ctx.log('debug')` 后回落原有的 `ContentPageData` + HTML 路径（`dmm.py:19-57`）。
- **请求层泛化**：`fetchGraphQlData(ctx, env, operation, {endpoint, siteBase})` + `buildGraphQlHeaders(env, siteBase)`（POST JSON、状态码 ≥400 抛错、`errors` / 缺 `data` 抛错、超时 2500ms），用宿主 `ctx.request` 实现，不照抄源的 HTTP 客户端类。
- **搜索兜底**：`unescapeSearchUrl`（`dmm.py:138-141`）→ `buildFanzaTvSearchTerms`（`dmm.py:86-91`：≥5 位且以 `00` 开头先剥 `00`，五位补零词 + 去填充词）→ `buildSearchPageUrls`（`www.dmm.co.jp` 主 + `www.dmm.com` + 用户显式镜像）→ `collectFanzaTvContentIds`（`dmm.py:124-165`：只收 `tv.dmm.co.jp` 候选，`content=` 精确者优先）→ `resolveFanzaTvViaSearch`；挂在 `search` 尾部，全失败仍返回 `[]`。
- **资产 Referer 按主机分派**：`resolveAssetReferer`（本批 Lead 补的一处修正）—— `tv.dmm.co.jp` → `https://tv.dmm.co.jp`、`dmm.com` → `https://tv.dmm.com`、其余 `dmm.co.jp` → `https://video.dmm.co.jp`，认不出的主机回落 `readBaseUrl(env)`；原先恒发 `video.dmm.co.jp`，两个 TV 入口的图墙会被判盗链。
- **一处防御**：`parseDmmTvComData` 的返回对象补 `scene_images: []`（`DMM_TV_QUERY` 无 `samplePictures`），否则该路径下 `extras()` 的裸 `data.scene_images.map(...)` 会抛 TypeError。
- **已知限制**：`parseDmmTvComData` 的 `number` 恒为 `''`（源 `dmm.py:515` 明示 DMM TV 不暴露与通販相同的 cid）；`detail()` 出口按 `data.number || fallbackNumber` 回落检索入参，番号不会空。

## 4. 未采纳的源逻辑及原因

1. **`wp_works._publisher` 的原序**（`wp_works.py:132-135`）：源在前缀未命中时直接落 `default_publisher`；`faleno.js` 的 `resolvePublisher` 未命中返回 `undefined`，把优先级让给页面 `メーカー`，再缺省 `FALENOstar` —— 页面真实厂商应高于硬编码缺省。
2. **`urls[0]` 盲取首个结果**（`mgstage.py:44`）：改成按归一化番号比对候选，不中即空，避免把别的作品当命中；`javbus.js` 保留的 `/{番号大写}` 兜底也标了 `matched=false` 只写 debug 日志。
3. **`avbase.pick_candidate` 的「两个信号都不唯一就放弃」**（`avbase.py:113-128`）：插件在两个信号都不唯一时退回既有的四级评分（`pickBestSearchWork`）——「不猜的前提」让位于「不丢结果」，这是本批唯一一处主动放宽源规则的地方。
4. **fc2 的 `_ensure_https`**（`fc2.py:78-81`）：内联的 `toAbsoluteUrl` 已经处理 `//` 前缀，不再单独搬一个函数。
5. **javdb 的 `_parse_score`**（`javdb.py:146-151`）与源里的 `score` 字段：目标契约（[01-plugin-module.md](./01-plugin-module.md) §3）没有 score 位置。
6. **avbase 声明图片走 DMM CDN**（`avbase.py:7-8`）：插件沿用站点自身的图片字段，避免引入第三方 CDN 与它的防盗链。
7. **源「全失败即抛错」**：`prestige.py:69-70` 的 `raise last_error`、javdb / jav321 探测失败即抛，在插件里 `search` 一律回落 `[]` 或走兜底；只有详情页拿到但标题解析失败才抛中文错。
8. **`check_connectivity` / `_PROBE_SKU`**（`prestige.py:16`、`24-32`）：插件契约没有连通性自检入口。
9. **`external_id` / `source_url`**（`fc2.py:68`、`mgstage.py:94`、`prestige.py:172-173` 等）：契约无位置。
10. **jav321 的小范围演员 / 封面**（`jav321.py:40` / `46`）：`出演者` 字段内联链接与 `div.panel-body//img` 只作兜底，优先沿用既有的全页 `a[href*='/star/']` 与 `img.img-responsive`，避免既有结果缩水。
11. **fc2 的番号展示形态**（`fc2.py:32` 的 `FC2-PPV-<digits>`）：沿用既有 `FC2-<digits>`，不改用户已见到的番号写法。
12. **prestige 的 `/api/search` 弃用**（`prestige.py:3`）：源明确「不允许用作检索」，插件仍把它留在 SKU 全灭之后作兜底。
13. **dmm 的 `_scrape_rental` 独立解析与 `_parse_release`**（`dmm.py:386-437` / `552-558`）：前者字段是既有 mono 解析的子集且不解析 JSON-LD，后者是 `parseDateValue` 的子集。
14. **dmm / dmm-tv 的评分、年份与 `_cid_to_number`**（`dmm.py:515-568` + `dmm_api.py` 模型）：契约没有 score / 年份位置；DMM TV 两个入口都不暴露与通販相同的 cid；`dmm_api.py:194-238` 的 `sampleImages.imageUrl` 源自己也没用。

## 5. 已知限制 / 沙箱差异

| amane 有 | 插件沙箱 | 本批的处理 |
| --- | --- | --- |
| JournaledCrawler 抓取缓存 | 无跨方法缓存 | 宿主分别调用 `detail` / `covers` / `extras`，**同一详情页可能被请求多次**；本批没有为任何站加内存页面缓存 |
| Playwright 浏览器后端 | 只有 Node HTTP 栈 | Cloudflare / 年龄墙 / 地区墙一律只能靠 `env.cookies`，插件内抛出中文提示 |
| httpx cookie jar | `ctx.request` 无 cookie jar | `javbus`（`dv=1`）、`mgstage`（`adc=1`）靠手工拼 `cookie` 头，用户 Cookie 追加在后 |
| 媒体文件下载 | 插件只返回 URL + headers | 下载与去重由宿主负责，插件不落盘 |
| SQLite / 文件系统 | 无文件系统 | 本批无影响（都是单作品直查） |
| `check_connectivity`、`file_hash` 入参 | 契约没有 | 见第 4 节第 8 条 |
| parsel `//text()`（只取首要直连文本） | cheerio `.text()`（含全部后代） | 这些站两种取法结果一致；`faleno` / `dahlia` 的 WP REST 路径不涉及 HTML |
| 单站多入口按 URL 主机分派（dmm 通販 / FANZA TV / tv.dmm.com） | 插件同样按 URL 主机分派 | `dmm-tv.js` 的两条 GraphQL 与 `resolveAssetReferer` 都按资产 / 详情页主机判定，不依赖用户填的 `baseUrl` |
