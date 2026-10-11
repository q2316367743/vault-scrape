<script setup lang="ts">
/**
 * 演员图片块：头像与图集（`actor_image`）的导入与增删。
 *
 * 契约：
 * - 图片本体由主进程复制进数据目录并写库，渲染层只提交本机绝对路径；
 * - 「导入图片」支持一次选多张（对话框 `multiple`），逐张校验，失败的按原因列出来；
 * - 「更换头像」单选一张，主进程会把它记为头像并同步 `avatar.avatarImageId`；
 * - 任何成功的增删都只 `emit('changed')`，由页面重新拉详情，组件自己不改 props。
 */
import { computed, ref } from 'vue'
import { DeleteIcon, UploadIcon, UserCircleIcon } from 'tdesign-icons-vue-next'
import SensitiveImage from '@/components/SensitiveImage.vue'
import { MessageBoxUtil, MessageUtil } from '@/utils/modal'
import { useNsfwProtection } from '@/hooks/UseNsfwProtection'
import { actorApi, dialogApi, settingApi } from '@/api'
import { ACTOR_IMAGE_EXTENSIONS, type ActorDetail, type ActorImageKind } from '@common/types/actor'

const props = defineProps<{ actor: ActorDetail }>()
const emit = defineEmits<{ changed: [] }>()

const { protection } = useNsfwProtection()

const importing = ref(false)
const busyImageId = ref('')

const photos = computed(() => props.actor.photos)
const summary = computed(() => `图集 ${photos.value.length} 张`)

/** 打开系统选择框：默认落在设置里的演员图片目录，按需单选 / 多选 */
async function pickPaths(kind: ActorImageKind): Promise<string[]> {
  try {
    const app = await settingApi.getGroup('app')
    const result = await dialogApi.open({
      title: kind === 'avatar' ? '选择头像图片' : '选择要导入的演员图片（可多选）',
      multiple: kind !== 'avatar',
      defaultPath: app.actorImageDir || undefined,
      filters: [{ name: '图片', extensions: [...ACTOR_IMAGE_EXTENSIONS] }]
    })
    return result.canceled ? [] : result.filePaths
  } catch (error: unknown) {
    MessageUtil.error('打开系统选择框失败', error)
    return []
  }
}

async function importImages(kind: ActorImageKind): Promise<void> {
  const paths = await pickPaths(kind)
  if (paths.length === 0) return

  importing.value = true
  const result = await actorApi.importImages({ actorId: props.actor.actorId, paths, kind })
  importing.value = false
  if (!result.ok) {
    MessageUtil.error(result.message)
    return
  }

  const { images, failed } = result.data
  if (failed.length > 0) {
    const reasons = failed.map((item) => `${item.path}：${item.reason}`).join('；')
    MessageUtil.warning(`已导入 ${images.length} 张，${failed.length} 张没导入成功（${reasons}）`)
  } else if (images.length > 0) {
    MessageUtil.success(kind === 'avatar' ? '已设置头像' : `已导入 ${images.length} 张图片`)
  }
  if (images.length > 0) emit('changed')
}

async function setAvatar(imageId: string): Promise<void> {
  busyImageId.value = imageId
  const result = await actorApi.setAvatar({ actorId: props.actor.actorId, imageId })
  busyImageId.value = ''
  if (!result.ok) {
    MessageUtil.error(result.message)
    return
  }
  MessageUtil.success('已设为头像')
  emit('changed')
}

async function removePhoto(imageId: string): Promise<void> {
  try {
    await MessageBoxUtil.confirm('删除后本机文件与数据库记录都会清掉，确定删除这张图片？', '删除图片')
  } catch {
    return
  }
  busyImageId.value = imageId
  const result = await actorApi.removeImage({ actorId: props.actor.actorId, imageId })
  busyImageId.value = ''
  if (!result.ok) {
    MessageUtil.error(result.message)
    return
  }
  MessageUtil.success('已删除图片')
  emit('changed')
}
</script>

<template>
  <section class="gallery-block">
    <div class="gallery-head">
      <div class="gallery-title">
        <h4>头像与图集</h4>
        <span class="gallery-summary">{{ summary }}</span>
      </div>
      <div class="gallery-actions">
        <t-button variant="outline" :loading="importing" @click="importImages('photo')">
          <template #icon><upload-icon /></template>
          导入图片
        </t-button>
        <t-button variant="outline" :loading="importing" @click="importImages('avatar')">
          <template #icon><user-circle-icon /></template>
          更换头像
        </t-button>
      </div>
    </div>

    <div v-if="photos.length > 0" class="gallery-grid">
      <figure v-for="photo in photos" :key="photo.imageId" class="gallery-item">
        <sensitive-image
          :src="photo.url"
          :protect="protection"
          :width="150"
          :height="190"
          :alt="photo.name"
        />
        <figcaption class="gallery-caption" :title="photo.name">{{ photo.name }}</figcaption>
        <div class="gallery-item-actions">
          <t-button
            size="small"
            variant="text"
            :loading="busyImageId === photo.imageId"
            @click="setAvatar(photo.imageId)"
          >
            设为头像
          </t-button>
          <t-button
            size="small"
            variant="text"
            theme="danger"
            :loading="busyImageId === photo.imageId"
            @click="removePhoto(photo.imageId)"
          >
            <template #icon><delete-icon /></template>
            删除
          </t-button>
        </div>
      </figure>
    </div>

    <t-empty v-else description="还没有图集，导入几张本机图片，或让刮削插件自己抓" />
  </section>
</template>

<style scoped lang="less">
.gallery-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background-color: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
}

.gallery-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.gallery-title {
  display: flex;
  gap: 8px;
  align-items: baseline;

  h4 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--td-text-color-primary);
  }
}

.gallery-summary {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.gallery-actions {
  display: flex;
  gap: 8px;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}

.gallery-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
}

.gallery-caption {
  overflow: hidden;
  font-size: 12px;
  color: var(--td-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-item-actions {
  display: flex;
  gap: 4px;
  justify-content: space-between;
}
</style>
