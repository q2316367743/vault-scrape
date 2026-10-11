<template>
  <plugin-manager-view kind="movie">
    <template #detail-extra>
      <offline-pack-panel v-if="isBuiltinActive" />
    </template>
  </plugin-manager-view>
</template>

<script setup lang="ts">
/** 影片信息插件页：管理视图 + 内置插件的离线数据包面板 */
import { computed } from 'vue'
import { usePluginManager } from '../composables/usePluginManager'
import PluginManagerView from '../components/PluginManagerView.vue'
import OfflinePackPanel from './components/OfflinePackPanel.vue'

const { active } = usePluginManager('movie')

/** 离线数据包只有内置的影片插件才有 */
const isBuiltinActive = computed(() => active.value?.source === 'builtin')
</script>
