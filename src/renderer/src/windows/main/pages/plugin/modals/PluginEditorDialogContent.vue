<script setup lang="ts">
/**
 * 插件源码编辑器内容（外壳见同目录 PluginEditorDialog.tsx）：编辑纯 JS 脚本，保存时由主进程先编译校验再落盘。
 *
 * 契约：只允许纯 JS（无 import / require / TS），可用能力以沙箱白名单为准。
 * 取消 / 保存按钮在外壳 footer，这里用 `defineExpose` 把动作与状态交出去（见 `@/utils/modal/ModalContent`）。
 */
import { computed, onMounted, ref } from 'vue'

const props = defineProps<{
  /** 插件 ID，仅用于提示文案 */
  id: string
  load: () => Promise<string | null>
  save: (code: string) => Promise<boolean>
}>()

const emit = defineEmits<{ close: [] }>()

const SAMPLE_HINT =
  '契约：顶层必须有 definePlugin({...})，meta 与 search / detail / covers / extras 四个方法缺一不可；\n' +
  '环境变量：写 env: [{ key, label, type }] 声明，安装与保存时宿主会在沙箱里执行脚本读取它；\n' +
  '方法签名：(keyword|movieId, env, ctx)，env 是已填写的环境变量值，敏感项已解密；\n' +
  '可用能力：ctx.request(options)、ctx.log(level, message)、$ = cheerio.load(html)；\n' +
  '不可用：import、require、process、fetch、定时器之外的 Node API。保存时会先编译校验，失败则不落盘。'

const content = ref('')
const loading = ref(false)
const saving = ref(false)
/** 加载完成前不允许保存，避免用空源码覆盖原插件 */
const canSubmit = computed(() => !loading.value)

onMounted(async () => {
  loading.value = true
  const text = await props.load()
  loading.value = false
  if (text === null) {
    emit('close')
    return
  }
  content.value = text
})

async function onSave(): Promise<void> {
  saving.value = true
  const ok = await props.save(content.value)
  saving.value = false
  if (ok) emit('close')
}

/** 交给外壳 footer 的取消 / 保存按钮 */
defineExpose({ submit: onSave, saving, canSubmit })
</script>

<template>
  <div class="plugin-editor">
    <pre class="editor-hint">{{ SAMPLE_HINT }}</pre>
    <t-textarea
      v-model="content"
      class="editor-input"
      :autosize="{ minRows: 20, maxRows: 32 }"
      :placeholder="`插件「${id}」的源码`"
    />
  </div>
</template>

<style scoped lang="less">
.editor-hint {
  margin: 0 0 10px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  color: var(--td-text-color-secondary);
  background: var(--td-bg-color-container-hover);
  border-radius: var(--td-radius-small);
}

.editor-input {
  width: 100%;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
}
</style>
