<template>
  <div v-if="visible" class="plugin-legacy">
    <t-alert theme="warning" :close="true" @close="visible = false">
      <template #title>检测到旧版插件文件，已不再加载</template>
      <div class="plugin-legacy-body">
        <p>
          插件已按「影片信息 / 演员信息 / 翻译」拆分，类别由插件源码里的
          <code>meta.kind</code> 声明。下面这些 .js 没有声明类别，请把它们重新导入到对应类别的
          tab 里，或直接删除。
        </p>
        <ul class="plugin-legacy-list">
          <li v-for="file in files" :key="file">{{ file }}</li>
        </ul>
        <p class="plugin-legacy-dir">所在目录：{{ dir }}</p>
      </div>
    </t-alert>
  </div>
</template>

<script setup lang="ts">
/** 旧版平铺插件目录（~/.vault-scrape/plugin/）里若还有残留 .js，就在插件页顶部提示一次 */
import { onMounted, ref } from 'vue'
import { pluginApi } from '@/api/plugin'

const visible = ref(false)
const dir = ref('')
const files = ref<string[]>([])

onMounted(async () => {
  const result = await pluginApi.legacy()
  if (!result.ok || result.data.files.length === 0) return
  dir.value = result.data.dir
  files.value = result.data.files
  visible.value = true
})
</script>

<style scoped lang="less">
.plugin-legacy {
  flex-shrink: 0;
  padding: 12px 20px 0;
}

.plugin-legacy-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.plugin-legacy-list {
  margin: 0;
  padding-left: 18px;
}

.plugin-legacy-dir,
.plugin-legacy-body code {
  color: var(--td-text-color-secondary);
}
</style>
