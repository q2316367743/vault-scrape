# 通用多选控件 CheckboxSelect

## 实现思路

资料库表单的「刮削器」原来是 `t-transfer` 穿梭框：左右两栏 + 中间按钮，占地方、层级重，和 Fluent 风格的表单行也不协调。改成一个**单栏多选控件**——外框里上面是搜索框、下面是可滚动的 checkbox 列表，点行即勾选 / 取消。

控件是通用表单控件（不依赖任何业务类型），所以按组件存放规则放在 `src/renderer/src/components/CheckboxSelect.vue`，调用方用文件路径显式 import。

```vue
<checkbox-select v-model="scrapers" :options="scraperSelectOptions" placeholder="搜索刮削器" />
```

## 数据结构与契约

| 名字 | 类型 | 说明 |
| --- | --- | --- |
| `modelValue` | `string[]` | 已选值（`v-model`），只增删元素，不重排 |
| `options` | `{ label: string; value: string; disabled?: boolean }[]` | 候选项，与 `t-select` 的选项结构一致，`value` 收窄为 `string`（`v-model` 是字符串数组） |
| `placeholder` | `string` | 搜索框占位，默认「搜索」 |
| `disabled` | `boolean` | 整体禁用，默认 `false` |
| `update:modelValue` | `string[]` | 勾选变化后的新数组 |
| `change` | `string[]` | 与 `update:modelValue` 同值，供只需监听变化的调用方 |

行为约定：

- **不在 `options` 里的值会被保留**。调用方常需要展示「配置里有、当前不可用」的历史值（例如失效插件 id），搜索过滤或点击都不能把它们静默丢掉，所以 `toggle` 是在 `modelValue` 的副本上做增删，不按 `options` 重建数组。这些历史值要出现在界面上，仍须由调用方自己拼进 `options`。
- 搜索**只过滤展示**，不过滤已选值；匹配 `label`（忽略大小写、去首尾空格）。搜索框带 `clearable`。
- `disabled` 的选项和整体 `disabled` 都不可勾选（`.checkbox-select-option-disabled` + `t-checkbox` 的 `disabled`）。
- 空列表文案随搜索态区分：「没有匹配的选项」/「暂无可选项」。

## 关键实现点

- **点击只 toggle 一次**：整行 `@click="toggle(item)"`，`t-checkbox` 上再挂 `@click.stop="toggle(item)"`——点 checkbox 时事件被吞掉不再冒泡到行，避免一次点击触发两次（勾选又取消）。`t-checkbox` 只绑 `:checked`，不绑 `@change`，保证状态来源唯一。
- **样式**：外框 `1px solid var(--td-component-stroke)` + `var(--td-radius-medium)`，聚焦时 `:focus-within` 把边框换成 `var(--td-brand-color)`；搜索框用 `:deep(.t-input.t-input)` 双类选择器去掉自带 `box-shadow`（避免框里还有框），故意加倍类名是为了压过组件库自身的单类规则；列表 `max-height: 220px` 滚动；悬停底色 `--td-bg-color-container-hover`，禁用文字 `--td-text-color-disabled`。颜色全部走 TDesign Token。
- 搜索框前缀图标用 `tdesign-icons-vue-next` 的 `SearchIcon`（不手写 SVG）。

## 使用方

- `src/renderer/src/windows/main/pages/media/library/components/LibraryFormContent.vue` 的「刮削器」字段：`v-model` 直接绑 `useLibraryForm` 的 `scrapers`（`Ref<string[]>`）。候选项 `scraperSelectOptions` = `useScraperOptions` 的可用插件 + `staleScrapers` 计算的失效 id（失效项 label 追加「（已失效）」，取消勾选即从配置里丢弃），逻辑与原来一致，只换了控件。
- 随 `t-transfer` 下线，`src/renderer/components.d.ts` 与 `src/renderer/src/renderer/components.d.ts` 里手工补的 `TTransfer` 声明一并删除。

## 注意事项

- 组件不提供「全选 / 清空」，也没有已选数量徽标：当前只有资料库刮削器一个使用方，需要时再加。
- 新增使用方时不要给 `options` 里塞重复 `value`：`v-for` 以 `value` 作 `key`。
