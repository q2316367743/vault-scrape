# vault-scrape（搭手插件）

影视库扫描、刮削与播放。已从 Electron 桌面应用重构为**搭手（da-shou）插件**：

- **一个 core 后台进程**（`src-dashou/index.ts`）：数据库、文件访问、刮削流水线、插件沙箱、离线数据包、媒体服务；
- **两个窗口**：主窗口（`index.html`）与按需创建的播放窗口（`play.html`），都是沙箱页面，只通过 `@dashou/api` 调 core。

## 技术栈

| 方向 | 选型 |
| --- | --- |
| 插件规范 | 搭手插件（`src-dashou/plugin.json` + esbuild 生成的 `core.mjs`） |
| 界面 | Vue 3 + TDesign Vue Next + tdesign-icons-vue-next + UnoCSS + less |
| 状态与路由 | pinia + vue-router（hash 模式） |
| 数据 | Node 内置 `node:sqlite`（`DatabaseSync`），表结构在 `src-dashou/assets/schema.sql` |
| 文件访问 | 本机磁盘 + WebDAV（webdav）+ SMB（@awo00/smb2）+ OpenList + 存储插件，core 内统一 `FileClient` 接口 |
| 媒体地址 | core 起一个只绑 `127.0.0.1` 的 HTTP 服务，按媒体 ID 提供 Range 流 |
| 播放 | 内置 artplayer（插件无法把 mpv 原生窗口嵌进宿主窗口，已移除 mpv） |
| 工具库 | es-toolkit、@vueuse/core、dayjs、axios、cheerio |

## 目录结构

```
index.html / play.html   # 两个窗口的 Vite 入口
src/                     # 窗口前端（原 src/renderer/src）
├── api/                 # core API 包装（含长任务通道）
├── assets/              # 全局样式
├── components/          # 跨页面组件
├── windows/main|play/   # 两个窗口的页面、router、store
└── common/              # 窗口与 core 共用的纯类型 / 纯函数
src-dashou/              # 插件根（开发者工具选这一层）
├── plugin.json          # 清单：窗口、命令、能力与 CSP
├── index.ts             # core 入口
├── assets/              # 图标与 schema.sql
└── core/                # core 实现（db / modules / runtime）
docs/                    # 技术文档（见 docs/README.md）
```

## 常用命令

```bash
pnpm install            # 安装依赖（pnpm-workspace.yaml 已放行 esbuild / vue-demi 的安装脚本；postinstall 应用 patches/@awo00+smb2）
pnpm typecheck          # 类型检查（窗口 vue-tsc + core tsc），提交前唯一必需的校验
pnpm dev                # 前端 dev server（5188）
pnpm plugin:dev         # 常驻：起前端 + 生成并 watch src-dashou/core.mjs
pnpm plugin:build       # 打包出 src-dashou/dashou-dist/<id>-<version>.dsp
```

## 开发流程

1. 终端常驻 `pnpm plugin:dev`；
2. 搭手 → 插件管理 → 开发者工具 → 添加项目，选 **`src-dashou/`**；
3. 改 core / `plugin.json` 后点「重新加载」，UI 走 dev server 的 HMR；
4. 开发版窗口按 F12 打开开发者工具。

## 数据位置

插件数据在宿主给的私有目录（`ctx.paths.data`），布局：

```
db/vault-scrape.db   系统库（SQLite）
db/r18.db            离线数据包（可选）
setting/settings.json
file/connections.json
plugin/<类别>/        刮削插件脚本与索引
media/actor/          演员图片（可在设置里换目录）
cache/media/          远端媒体缓存
log/scrape/           刮削日志
```

## 与 Electron 版本的差异

- **不再有托盘 / 自动更新**：插件只从 `.dsp` 安装包安装，窗口关闭由用户显式操作；
- **不再有 mpv**：播放窗口统一用内置 artplayer；
- **不再有自定义协议**：`storage://` 换成 core 的本机 HTTP 媒体服务（地址里带一次性 token）；
- **没有 drizzle**：仓储改成手写 SQL + `node:sqlite`，原生模块不再需要按 Electron ABI 编译；
- **密钥**：没有系统钥匙串，改用插件数据目录里的本机密钥（AES-256-GCM）加密敏感值。

## 注意事项

- 根目录不放业务代码（`index.html` / `play.html` / 构建配置除外）。
- 窗口不直接访问 `window.dashou`，统一走 `@/api`。
- 颜色一律使用 TDesign CSS 变量，裸色值只允许出现在 `src/assets/style/theme.less`。
- 弹窗与抽屉使用命令式 `DialogPlugin` / `DrawerPlugin`。
- 改表结构时同步 `src-dashou/assets/schema.sql` 与 `src-dashou/core/db/columns.ts`。
- 打包时全部样式会内联进 `index.html` / `play.html`（`cssCodeSplit: false` + `inlineCssPlugin`），包内没有独立 CSS 文件；改样式后重跑 `pnpm build` 即可。
- 任何可能超过 30 秒的操作（扫描、单条刮削、翻译、系统选择框等）都要走 `@/api` 的长任务通道（`runJob`）。
