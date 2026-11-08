# 工程结构与构建配置（搭手插件）

## 实现思路

工程从 Electron 桌面应用重构为**搭手插件**后，只保留两层运行单元：

- **core 后台进程**：`src-dashou/index.ts` 是唯一入口，esbuild 打成 `src-dashou/core.mjs`；数据库、文件访问、刮削流水线、插件沙箱、离线数据包、媒体服务全在这里；
- **窗口页面**：`index.html`（主窗口）与 `play.html`（播放窗口）是 Vite 的两个入口，构建到 `dist/`，由 CLI 复制成包内 `ui/`；页面是沙箱，没有 Node，只能通过 `@dashou/api` 调宿主能力或 core 自有 API。

`src/` 是窗口前端（不再有 `src/renderer/src` 这层），`src/common/` 是窗口与 core 共用的纯类型 / 纯函数。

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `index.html` / `play.html` | 两个窗口的 Vite 入口 |
| `vite.config.ts` | 窗口构建：`base: './'`、`@`/`@common` 别名、端口 5188、双入口；`cssCodeSplit: false` + `inlineCssPlugin` 把样式内联进两个 HTML |
| `tsconfig.json` | 窗口类型范围（`src/**/*`，含 `.vue` / `.tsx`） |
| `tsconfig.dashou.json` | core 类型范围（`src-dashou/**/*` + `src/common/**/*`，`types: ["node"]`） |
| `dashou.config.ts` | core 的 esbuild 别名：`$` → `src-dashou/core`、`@common` → `src/common` |
| `src-dashou/plugin.json` | 唯一清单：窗口、命令、能力、CSP、构建命令 |
| `src-dashou/index.ts` | core 入口：`onReady` 里初始化路径 / 数据库 / 媒体服务 / 长任务表 |
| `src-dashou/assets/schema.sql` | 系统库建表 SQL（幂等，启动时执行） |
| `src-dashou/assets/icon.png` | 插件图标 |
| `patches/` | `patch-package` 补丁（`@awo00+smb2+1.1.1.patch` 的区间读），`postinstall` 自动应用 |
| `pnpm-workspace.yaml` | pnpm 12 的工程级设置：只放行 `esbuild` / `vue-demi` 的安装脚本（不写 `packages`，不是 monorepo） |

## 目录结构

```
src/
├── api/                 # 窗口侧 API 包装（每个域一个文件 + invoke / job / events）
├── assets/style/        # theme / tdesign-cover / customer / vue3-context-menu
├── components/          # 跨页面组件
├── global/              # 主题与全局状态
├── hooks/ composables/ utils/
├── windows/main/        # 主窗口：App.vue、router、store、pages/*
├── windows/play/        # 播放窗口：PlayApp.vue、components、composables
└── common/              # 窗口 + core 共用：types / mediaRules / 通道名
src-dashou/
├── plugin.json
├── index.ts
├── assets/              # icon.png、schema.sql
└── core/
    ├── api.ts           # API 总表 + 长任务登记
    ├── require-shim.ts  # CJS 依赖的 require 兼容（必须是入口第一个 import）
    ├── runtime/         # paths / host / jobs / appApi / dialogApi
    ├── db/              # client(node:sqlite) / columns / query / schema / repo
    └── modules/         # actor / file / http / library / media / offline / player / plugin / scrape / setting / translate
```

## 路径别名

| 别名 | 指向 | 可用范围 |
| --- | --- | --- |
| `@/*` | `src/*` | 窗口（Vite + tsconfig.json） |
| `@common/*` | `src/common/*` | 窗口与 core |
| `$/*` | `src-dashou/core/*` | core（esbuild alias + tsconfig.dashou.json） |

改了别名要同步四处：`vite.config.ts`、`tsconfig.json`、`dashou.config.ts`、`tsconfig.dashou.json`。

## 构建配置要点

- **窗口**：`base: './'`（`plugin://<id>/ui/index.html` 下绝对路径会失败）、端口 5188、TDesign 自动导入 + UnoCSS；
  两个入口在 `build.rollupOptions.input` 里登记，产物是 `dist/index.html` 与 `dist/play.html`。
- **样式内联**：`cssCodeSplit: false` 把全部 CSS 收成一个文件，`inlineCssPlugin`（`enforce: 'post'` 的
  `generateBundle`）再把 `<link rel="stylesheet">` 换成 `<style>` 并删除 CSS 产物。安装版页面因此只有 HTML + JS，
  样式不依赖 `plugin://` 的额外请求；`style-src` 基线与清单都含 `'unsafe-inline'`，内联不会被 CSP 拦。
  开发版不受影响（dev server 自己注入样式）。
- **core**：`dashou-plugin build` 用 esbuild 把 `src-dashou/index.ts` 打成 ESM；命中 `node:*` 时切 Node 平台，
  `node:*` 自动外部化，其余依赖（axios / cheerio / webdav / @awo00/smb2 等）全部打进 `core.mjs`。
  因此这些包都放在 `devDependencies`：`dependencies` 留空，包里没有 `node_modules`，换机器不需要重编译。
- **require 兼容**：CJS 依赖内部会 `require('fs')` / `require('zlib')`，入口第一个 import 是
  `core/require-shim.ts`，用 `createRequire(import.meta.url)` 补全局 `require`。
- **不跑 drizzle-kit**：表结构就是 `src-dashou/assets/schema.sql`，启动时 `CREATE TABLE IF NOT EXISTS`。

## 依赖归类规则

- `dependencies`：留空。插件包不应再带原生模块；有必须外部化的包才放这里（会复制进包内 `node_modules`）。
- `devDependencies`：窗口打包用（vue / tdesign / unocss / artplayer 等）与 core 打包用（axios / cheerio / webdav /
  @awo00/smb2）的纯 JS 包，以及构建与校验工具（vite / typescript / vue-tsc / dashou cli）。
- `patches/`：`@awo00/smb2` 的区间读补丁按精确版本 `1.1.1` 命名，升级该包必须重新生成补丁。

## 注意事项

- 根目录禁止出现业务代码；`index.html` / `play.html` / 构建配置除外。
- 页面目录遵守 RL-09 分层，非公共组件放页面自己的 `components/`。
- 只做 `pnpm typecheck`（窗口 `vue-tsc` + core `tsc`）；`plugin:dev` / `plugin:build` 与实机加载交给用户。
- 改表结构必须同时改 `src-dashou/assets/schema.sql` 与 `src-dashou/core/db/columns.ts`（列清单与别名）。
- 运行期架构（API、事件、长任务、媒体服务、窗口创建）见 [02-plugin-runtime.md](./02-plugin-runtime.md)。
