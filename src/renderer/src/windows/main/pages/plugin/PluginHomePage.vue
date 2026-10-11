<template>
  <div class="plugin-home">
    <t-tabs :value="activeKind" class="plugin-tabs" theme="normal" @change="onChange">
      <t-tab-panel
        v-for="kind in PLUGIN_KINDS"
        :key="kind"
        :value="kind"
        :label="PLUGIN_KIND_LABELS[kind]"
      />
    </t-tabs>
    <plugin-legacy-alert />
    <div class="plugin-home-body">
      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 插件页外壳：只负责「一个入口 + 三个类别 tab + 旧版残留提示」。
 *
 * 契约：当前 tab 由路由参数决定（`/plugin/<kind>`），切换 tab 就是切换子路由，
 * 每个类别子页自带完整页头与按钮，所以这里不再套 page-layout，避免双层页头。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PLUGIN_KINDS,
  PLUGIN_KIND_LABELS,
  isPluginKind,
  type PluginKind
} from '@common/types/plugin'
import PluginLegacyAlert from './components/PluginLegacyAlert.vue'

/** 类别 → 子路由名（与 router.ts 里 /plugin 的三个子页一一对应） */
const ROUTE_NAMES: Readonly<Record<PluginKind, string>> = {
  movie: '影片信息插件',
  actor: '演员信息插件',
  translate: '翻译插件'
}

const route = useRoute()
const router = useRouter()

const activeKind = computed<PluginKind>(() => {
  const kind = route.params.kind
  return typeof kind === 'string' && isPluginKind(kind) ? kind : 'movie'
})

function onChange(value: string | number): void {
  if (typeof value !== 'string' || !isPluginKind(value) || value === activeKind.value) return
  void router.push({ name: ROUTE_NAMES[value] })
}
</script>

<style scoped lang="less">
.plugin-home {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.plugin-tabs {
  flex-shrink: 0;
  padding: 8px 20px 0;
  border-bottom: 1px solid var(--td-component-stroke);
}

.plugin-tabs :deep(.t-tabs__content) {
  display: none;
}

.plugin-home-body {
  flex: 1;
  min-height: 0;
}
</style>
