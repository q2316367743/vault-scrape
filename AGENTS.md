# AGENTS.md —— 前端工程约束规范

## 🚫 硬性红线（违反即错）

| 编号  | 规则                                                                           |
|-------|--------------------------------------------------------------------------------|
| RL‑01 | 语言：允许英文思考，但所有对外输出必须使用中文                                 |
| RL‑02 | 根目录洁净：禁止在根目录放置业务代码                                           |
| RL‑03 | 类型安全：禁止使用 `any`；禁止不必要的 `as` 断言                               |
| RL‑04 | UI 强制：所有 UI 元素必须使用 `tdesign`；禁用原生 `alert` / `select`           |
| RL‑05 | 文件长度：vue 文件 ≤ 300 行，ts 文件 ≤ 500 行，超出必须拆分                    |
| RL‑06 | 文档同步：功能实现后，必须将技术文档写入或更新 `docs/` 目录，供后续 AI 参考    |
| RL-07 | 不需要 build，只需要 typecheck，禁止做任何验证/测试，如需验证/测试，请让我来做 |
| RL-08 | 未经我的允许，禁止读取 node_modules 目录下文件                                 |
| RL-09 | 页面目录分层：禁止在页面目录下平铺多个页面文件，每个页面独占子目录（详见「页面目录组织」） |

---

## ⚙️ 编码原则

1. **方案先行**

- 需求模糊时必须提问，不做假设
- 存在多种理解时，全部列出后再确认

2. **简洁至上**

- 用最少代码解决问题
- 自检：「一位资深工程师会觉得这段代码过度设计吗？」

3. **精准修改**

- 只改必须改的部分，保持既有代码风格
- 只清理本次改动产生的孤儿代码

4. **目标驱动**

- 将任务拆成可验证目标（如：`加校验 → 先写非法输入失败用例 → 让用例通过`）

5. **文档先行落地**

- 功能实现完成后，把技术文档写入 `docs/`（新功能新建编号文档，旧功能更新对应文档）
- 文档应记录：实现思路、关键文件、数据结构 / API 契约、注意事项，供后续 AI 参考
- 新增 / 更新 / 删除文档后，必须同步更新 `docs/README.md` 索引（含标题与描述），保证索引不失效
- 需求简单、纯样式微调等无需文档的场景可豁免，但涉及逻辑 / 数据结构 / API 的变化必须记录

6. **红线优先**

- 上述原则与硬性红线冲突时，以红线为准

---

## 🧩 技术选型与设计约定

1. **UI 组件与图标**

- 统一使用 `tdesign` 组件库及图标，关于组件用法，使用 `tdesign-mcp-server` 这个 mcp 查看
- 禁止手写 SVG，除非 `tdesign` 未提供对应图标

2. **设计风格**

- 采用 **Fluent Design** 设计风格
- 强调层级、阴影、动效的自然流畅

3. **样式管理**

- 布局与尺寸可使用 `unocss`（如 `flex`、`m-8px`）
- 颜色类必须使用 `tdesign` 的 CSS Token，禁止直接使用裸色值

4. **弹窗与抽屉**

- 弹窗 / 抽屉一律使用 tdesign **命令式 API**：`DialogPlugin`（默认 `placement: 'center'`）或 `DrawerPlugin`（内容较多、需更宽编辑面板时）
- 每个弹窗拆成两个文件：
  - `.tsx` **外壳**：导出 `openXxx(options)` 打开函数，内部调用 `DialogPlugin` / `DrawerPlugin`，将 `.vue` 内容组件经
    `body: () => h(XxxContent, props)` 渲染进弹窗；`destroyOnClose: true`、`footer: false`（操作按钮由内容组件内部提供）
  - `.vue` **内容**：命名 `XxxContent.vue`，承载表单 / 按钮等全部 UI 与提交状态，通过 `emit('close' / 'success')` 与外壳通信
- 禁止：
  - 整个弹窗（含内容）全部写在 `.tsx` 中
  - 用声明式 `<t-dialog :visible>` + `v-if` 挂载实现业务弹窗
  - 弹窗内容使用 `.tsx` 渲染而非 `.vue` 组件
- 其余场景一律使用 `.vue` 组件

5. **组件存放规则**

- 非公共组件：放在当前页面目录下的 `components/`
- 通用组件：才可放入 `src/components/`
- 禁止将业务组件直接放入 `src/components`

6. **页面目录组织**

- 禁止在一个页面目录下平铺多个页面文件：每个页面（含子页面）独占一个子目录，页面 `.vue`、该页私有的 `components/` 与 `composables/` 都放进这个子目录
- 子目录用页面语义命名（如 `home` / `wall` / `detail`），页面组件名保持 `XxxPage.vue`
- 跨页面共用的页内组件与组合式，放进「最近的共用层级」新建的独立子目录，禁止复制多份；同一页面目录内多个页面共用时，放该页面目录下的 `components/` / `composables/`
- 示例（影视墙）：`pages/media/{components,home,wall,detail,library}/`——`home/MediaHomePage.vue` + `home/components/` + `home/composables/`；`wall/MediaWallPage.vue` + `wall/composables/`；`detail/MediaDetailPage.vue`；`components/` 放 home 与 wall 共用的影片卡片；`library/` 放共用的资料库管理（抽屉 / 表单 / 远程目录选择器）
- 从本规则加入之日起，新写或重写的页面目录必须遵守；存量目录不强制回改

7. **单文件组件（SFC）块顺序**

- `.vue` 文件一律按 `template` → `script` → `style` 排列，`template` 在最上面
- 从本规则加入之日起，新写或重写的组件必须遵守；存量文件不强制回改

---

## 📁 目录结构示例 + 错误示例对照表

### ✅ 推荐目录结构

```text
src/
├── api/
│   └── user.ts
├── pages/
│   ├── dashboard/
│   │   ├── index.vue
│   │   ├── components/
│   │   │   └── StatCard.vue
│   │   └── modals/
│   │       └── FilterDrawer.tsx
│   └── media/                  # 一个页面目录下按页面分层，禁止平铺页面文件
│       ├── components/         # 该页面目录内多个页面共用的页内组件
│       │   └── MediaWallCard.vue
│       ├── home/
│       │   ├── MediaHomePage.vue
│       │   ├── components/
│       │   │   └── LibraryCard.vue
│       │   └── composables/
│       │       └── useMediaHome.ts
│       ├── wall/
│       │   ├── MediaWallPage.vue
│       │   └── composables/
│       │       └── useMediaWall.ts
│       ├── detail/
│       │   └── MediaDetailPage.vue
│       └── library/            # home 与 wall 共用的资料库管理
│           ├── components/
│           │   └── LibraryFormContent.vue
│           └── composables/
│               └── useMediaLibraries.ts
├── components/
│   └── BaseTable.vue
```

### ❌ 错误示例与原因

| 错误示例                                  | 原因                                                        |
|-------------------------------------------|-------------------------------------------------------------|
| `src/UserList.vue`                        | 违反 RL‑02，业务代码不应放在根目录                          |
| `pages/dashboard/api.ts`                  | 违反 RL‑03，API 必须集中在 `@/api`                          |
| `components/OrderDetailModal.vue`         | 违反组件存放规则，非通用组件不应放在 `src/components`       |
| 页面中直接使用 `fetch('/api/user')`       | 违反 RL‑03，绕过 `@/api`                                    |
| 使用 `<select>` 或 `alert()`              | 违反 RL‑05，必须使用 `tdesign`                              |
| 手写 SVG 图标                             | 违反 UI 约定，应使用 `tdesign` 图标                         |
| `const data: any = res.data`              | 违反 RL‑04，禁止 `any`                                      |
| `color: #1677ff;`                         | 违反样式约定，应使用 tdesign CSS Token                      |
| `FilterModal.vue` 作为弹窗                | 违反约定，弹窗外壳必须用 `.tsx`（`DialogPlugin` 命令式）    |
| 弹窗内容直接写在 `.tsx` 内                | 违反约定，弹窗内容必须用 `.vue` 组件（`XxxContent.vue`）    |
| `<t-dialog :visible>` + `v-if` 声明式弹窗 | 违反约定，应使用 `DialogPlugin` / `DrawerPlugin` 命令式 API |
| 单文件超过 300 行未拆分                   | 违反 RL-06                                                  |
| `pages/media/` 下平铺 `MediaWallPage.vue`、`MediaHomePage.vue` | 违反 RL-09，页面必须各占一个子目录（`media/{home,wall,detail,library}/`） |
