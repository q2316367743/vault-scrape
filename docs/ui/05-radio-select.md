# 通用单选控件 RadioSelect

## 实现思路

翻译弹窗要「从全部翻译插件里挑一个」：既要能看出哪些插件不可用、为什么不可用，又要在插件多起来之后能搜。`t-select` 的下拉面板放不下两行说明、也不能一眼看全，`t-radio-group` 裸用又没有外框与搜索。于是照 `CheckboxSelect` 的外观做一份**单栏单选控件**——外框里上面是搜索框、下面是可滚动的 radio 列表，每项可以带一行灰字说明。

控件是通用表单控件（不依赖任何业务类型），放在 `src/renderer/src/components/RadioSelect.vue`，调用方用文件路径显式 import。

```vue
<radio-select v-model="pluginId" :options="pluginOptions" placeholder="搜索插件" />
```

## 数据结构与契约

| 名字 | 类型 | 说明 |
| --- | --- | --- |
| `modelValue` | `string` | 已选值（`v-model`），**空串表示未选** |
| `options` | `{ label: string; value: string; disabled?: boolean; description?: string }[]` | 候选项，与 `t-select` 的选项结构一致，`value` 收窄为 `string`，多一个可选的 `description`（选项下方灰字说明） |
| `placeholder` | `string` | 搜索框占位，默认「搜索」 |
| `disabled` | `boolean` | 整体禁用，默认 `false` |
| `update:modelValue` | `string` | 选中项的 `value` |
| `change` | `string` | 与 `update:modelValue` 同值，供只需监听变化的调用方 |

行为约定：

- **不在 `options` 里的值不会被清掉**。调用方可能把当前不可用的历史值传进来（例如已失效的插件 id），这时列表里没有任何一项被选中，值一直留着，直到用户点了别的选项才被替换。
- 搜索**只过滤展示**，匹配 `label` 与 `description`（都忽略大小写、去首尾空格）。搜索框带 `clearable`。
- 点已选中的项**保持原样**：单选没有「取消选中」语义，想清空由调用方自己决定（翻译弹窗靠「不选中任何项时禁用主按钮」把这种情况挡在提交之前）。
- `disabled` 的选项和整体 `disabled` 都不可选（`.radio-select-option-disabled` + `t-radio` 的 `disabled`）。
- 空列表文案随搜索态区分：「没有匹配的选项」/「暂无可选项」。

## 关键实现点

- **点击只选中一次**：整行 `@click="select(item)"`，`t-radio` 上再挂 `@click.stop="select(item)"`；`t-radio` 只绑 `:checked="modelValue === item.value"`，不绑 `@change`，保证「状态来源唯一」——和 `CheckboxSelect` 是同一套写法，只是把数组换成了单值。
- **两行排版**：`label` 与 `description` 装在 `.radio-select-text`（`flex-direction: column`）里，radio 图标是 `align-items: flex-start` + 1px 顶偏移，带说明时图标与首行文字对齐；两行都做单行省略号，长插件名不会把面板撑破。
- **样式**：与 `CheckboxSelect` 完全一致的外观（`--td-component-stroke` 外框、`:focus-within` 换 `--td-brand-color`、列表 `max-height: 220px` 滚动、`--td-bg-color-container-hover` 悬停、`--td-text-color-disabled` 禁用文字），颜色全部走 TDesign Token；搜索框用 `:deep(.t-input.t-input)` 双类选择器去掉自带 `box-shadow`。
- 搜索框前缀图标用 `tdesign-icons-vue-next` 的 `SearchIcon`（不手写 SVG）。

## 使用方

- `src/renderer/src/windows/main/pages/media/detail/modals/TranslateDialogContent.vue`：`options` = 全部翻译插件（`PluginSummary[]`）映射出的 `{ label: plugin.name, value: plugin.id, disabled: !isPluginUsable(plugin), description: translatePluginHint(plugin) }`，不可用的项置灰并显示「未启用」/「需要先补全插件设置」/「插件加载失败」；初始选中第一个可用插件（与设置里 `pluginId` 留空的「自动选择」同口径）。接入说明见 [plugin/10-translate-integration.md](../plugin/10-translate-integration.md)。

## 注意事项

- 组件只做展示与选值，**不校验「必须选一个」**：调用方自己用 `modelValue.length > 0` 之类的判定去禁用提交按钮。
- 新增使用方时不要给 `options` 里塞重复 `value`：`v-for` 以 `value` 作 `key`。
