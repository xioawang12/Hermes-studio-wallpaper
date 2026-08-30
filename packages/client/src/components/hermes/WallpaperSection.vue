<script setup lang="ts">
/**
 * ThemeView 内嵌的「壁纸库与轮播」区块。
 * 数据：/api/theme/wallpapers CRUD + /api/theme/carousel
 * 背景应用：设为当前 → 服务端镜像进 user_themes → useTheme.refreshBackground()
 *          （原生 --app-background-image 机制，含缓存键变更强制刷新）
 * 调校：覆盖原生 app-shell--custom-background 的 0.72/8px 硬编码为滑杆值。
 */
import { computed, onMounted, ref } from 'vue'
import { NButton, NInputNumber, NSelect, NSwitch, useMessage } from 'naive-ui'
import { request } from '@/api/client'
import { useTheme } from '@/composables/useTheme'

interface WallpaperItem {
  id: number
  filename: string
  name: string
  mime: string
  isCurrent: boolean
  fillMode: 'cover' | 'contain' | 'fill'
  url: string
  createdAt: number
}

interface CarouselSettings {
  userId?: number
  enabled: boolean
  orderMode: 'sequence' | 'random'
  intervalSeconds: number
  wallpaperIds: number[]
  scrimStrength: number
  mainAlpha: number
  mainBlur: number
  sidebarAlpha: number
  sidebarBlur: number
  updatedAt: number
}

const message = useMessage()
const { refreshBackground } = useTheme()

const wallpapers = ref<WallpaperItem[]>([])
const busy = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const loaded = ref(false)

const carousel = ref<CarouselSettings>({
  enabled: false,
  orderMode: 'sequence',
  intervalSeconds: 300,
  wallpaperIds: [],
  scrimStrength: 0.25,
  mainAlpha: 0.72,
  mainBlur: 8,
  sidebarAlpha: 0.72,
  sidebarBlur: 8,
  updatedAt: 0,
})

const current = computed(() => wallpapers.value.find(w => w.isCurrent) ?? null)
const carouselIds = computed(() => new Set(carousel.value.wallpaperIds))

const fillOptions = [
  { label: '铺满裁切', value: 'cover' },
  { label: '完整显示', value: 'contain' },
  { label: '拉伸', value: 'fill' },
]
const orderOptions = [
  { label: '顺序轮播', value: 'sequence' },
  { label: '随机轮播', value: 'random' },
]

async function loadLibrary() {
  busy.value = true
  try {
    const data = await request<{ wallpapers: WallpaperItem[]; carousel: Partial<CarouselSettings> }>('/api/theme/wallpapers')
    wallpapers.value = data.wallpapers ?? []
    if (data.carousel) carousel.value = { ...carousel.value, ...data.carousel }
  } catch {
    message.error('加载壁纸库失败')
  } finally {
    busy.value = false
    loaded.value = true
  }
}

async function uploadWallpaper(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  busy.value = true
  try {
    const form = new FormData()
    form.append('wallpaper', file)
    await request('/api/theme/wallpapers', { method: 'POST', body: form })
    message.success('壁纸已上传')
    await loadLibrary()
  } catch (error) {
    message.error(`上传失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    busy.value = false
    input.value = ''
  }
}

async function setCurrent(item: WallpaperItem) {
  if (item.isCurrent) return
  busy.value = true
  try {
    await request(`/api/theme/wallpapers/${item.id}/current`, { method: 'PUT' })
    await loadLibrary()
    await refreshBackground(true)
    message.success('已应用为当前壁纸')
  } catch {
    message.error('应用失败')
  } finally {
    busy.value = false
  }
}

async function setFillMode(item: WallpaperItem, mode: string) {
  try {
    await request(`/api/theme/wallpapers/${item.id}/fill`, {
      method: 'PUT',
      body: JSON.stringify({ fillMode: mode }),
    })
    item.fillMode = mode as WallpaperItem['fillMode']
  } catch {
    message.error('更新填充模式失败')
  }
}

async function deleteWallpaper(item: WallpaperItem) {
  busy.value = true
  try {
    await request(`/api/theme/wallpapers/${item.id}`, { method: 'DELETE' })
    if (carousel.value.wallpaperIds.includes(item.id)) {
      carousel.value.wallpaperIds = carousel.value.wallpaperIds.filter(id => id !== item.id)
      await saveCarousel()
    }
    message.success('已删除')
    await loadLibrary()
    await refreshBackground(true)
  } catch {
    message.error('删除失败')
  } finally {
    busy.value = false
  }
}

async function saveCarousel() {
  try {
    const saved = await request<CarouselSettings>('/api/theme/carousel', {
      method: 'PUT',
      body: JSON.stringify(carousel.value),
    })
    carousel.value = { ...carousel.value, ...saved }
  } catch {
    message.error('保存设置失败')
  }
  resetTimer()
  applyTuning()
}

function toggleInPlaylist(item: WallpaperItem) {
  if (carouselIds.value.has(item.id)) {
    carousel.value.wallpaperIds = carousel.value.wallpaperIds.filter(id => id !== item.id)
  } else {
    carousel.value.wallpaperIds = [...carousel.value.wallpaperIds, item.id]
  }
  void saveCarousel()
}

// ---- tuning: override native 0.72/8px via CSS vars on html element ----
const TUNING_STYLE_ID = 'hermes-wallpaper-tuning'
let scrimEl: HTMLDivElement | null = null

function applyTuning(): void {
  const c = carousel.value
  let style = document.getElementById(TUNING_STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = TUNING_STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = `
html.theme-has-custom-background .app-main--card {
  background-color: rgba(var(--bg-main-surface-rgb), var(--wp-main-alpha, 0.72)) !important;
  -webkit-backdrop-filter: blur(var(--wp-main-blur, 8px)) saturate(110%) !important;
  backdrop-filter: blur(var(--wp-main-blur, 8px)) saturate(110%) !important;
}
html.theme-has-custom-background .sidebar[data-v-app-sidebar],
html.theme-has-custom-background aside.sidebar {
  background-color: rgba(var(--bg-sidebar-surface-rgb), var(--wp-sidebar-alpha, 0.72)) !important;
  -webkit-backdrop-filter: blur(var(--wp-sidebar-blur, 8px)) saturate(110%) !important;
  backdrop-filter: blur(var(--wp-sidebar-blur, 8px)) saturate(110%) !important;
}`
  document.documentElement.style.setProperty('--wp-main-alpha', String(c.mainAlpha))
  document.documentElement.style.setProperty('--wp-main-blur', `${c.mainBlur}px`)
  document.documentElement.style.setProperty('--wp-sidebar-alpha', String(c.sidebarAlpha))
  document.documentElement.style.setProperty('--wp-sidebar-blur', `${c.sidebarBlur}px`)

  if (!scrimEl) {
    scrimEl = document.createElement('div')
    scrimEl.id = 'hermes-wallpaper-scrim'
    scrimEl.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none'
    document.body.appendChild(scrimEl)
  }
  scrimEl.style.background = `rgba(0,0,0,${c.scrimStrength})`
}

// ---- carousel timer ----
let carouselTimer: number | null = null

function resetTimer(): void {
  if (carouselTimer !== null) {
    window.clearInterval(carouselTimer)
    carouselTimer = null
  }
  const c = carousel.value
  if (!c.enabled || c.wallpaperIds.length <= 1) return
  carouselTimer = window.setInterval(async () => {
    const pool = wallpapers.value.filter(w => carouselIds.value.has(w.id))
    if (pool.length <= 1) return
    let next = pool[0]
    if (c.orderMode === 'random') {
      const others = pool.filter(w => !w.isCurrent)
      next = others.length ? others[Math.floor(Math.random() * others.length)] : pool[0]
    } else {
      const idx = pool.findIndex(w => w.isCurrent)
      next = pool[(idx + 1) % pool.length]
    }
    if (!next.isCurrent) await setCurrent(next)
  }, c.intervalSeconds * 1000)
}

function thumbStyle(item: WallpaperItem) {
  // card thumbnails in the grid (native bg layer handles the full-screen one)
  return item.mime.startsWith('video') ? undefined : { backgroundImage: `url("${item.url}")` }
}

onMounted(async () => {
  await loadLibrary()
  applyTuning()
  resetTimer()
})
</script>

<template>
  <section class="theme-card wallpaper-section">
    <div class="section-heading">
      <div>
        <h3>壁纸库与轮播</h3>
        <p>多张壁纸随时切换，支持视频与自动轮播</p>
      </div>
      <div class="wallpaper-actions">
        <input
          ref="fileInput"
          class="file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
          @change="uploadWallpaper"
        >
        <NButton size="small" :loading="busy" @click="fileInput?.click()">
          上传壁纸
        </NButton>
      </div>
    </div>

    <p class="wallpaper-hint">
      ⚠️ iPhone 实况图请导出 <b>.mov</b> 视频文件上传，「储存为图片」只包含静态画面
    </p>

    <!-- 当前壁纸 -->
    <div v-if="current" class="current-wallpaper">
      <video v-if="current.mime.startsWith('video')" :src="current.url" muted loop autoplay playsinline />
      <img v-else :src="current.url" :alt="current.name">
      <div class="current-info">
        <span class="current-badge">当前</span>
        <span class="current-name">{{ current.name }}</span>
      </div>
    </div>

    <!-- 轮播 -->
    <div class="carousel-row">
      <div class="carousel-item">
        <label>轮播</label>
        <NSwitch v-model:value="carousel.enabled" @update:value="saveCarousel" />
      </div>
      <div class="carousel-item">
        <label>顺序</label>
        <NSelect
          :value="carousel.orderMode"
          :options="orderOptions"
          size="small"
          class="order-select"
          :disabled="!carousel.enabled"
          @update:value="(v: string) => { carousel.orderMode = v as 'sequence'|'random'; saveCarousel() }"
        />
      </div>
      <div class="carousel-item">
        <label>间隔</label>
        <NInputNumber
          :value="carousel.intervalSeconds"
          :min="10"
          :max="3600"
          :step="10"
          size="small"
          :disabled="!carousel.enabled"
          @update:value="(v: number|null) => { carousel.intervalSeconds = v ?? 300 }"
        >
          <template #suffix>秒</template>
        </NInputNumber>
        <NButton size="small" secondary :disabled="!carousel.enabled" @click="saveCarousel">
          应用
        </NButton>
      </div>
    </div>

    <!-- 调校 -->
    <div class="tuning-grid">
      <label>背景压暗 <input v-model.number="carousel.scrimStrength" type="range" min="0" max="0.8" step="0.05" @change="saveCarousel"></label>
      <label>面板透明 <input v-model.number="carousel.mainAlpha" type="range" min="0" max="1" step="0.05" @change="saveCarousel"></label>
      <label>面板模糊 <input v-model.number="carousel.mainBlur" type="range" min="0" max="24" step="1" @change="saveCarousel"></label>
      <label>侧栏透明 <input v-model.number="carousel.sidebarAlpha" type="range" min="0" max="1" step="0.05" @change="saveCarousel"></label>
      <label>侧栏模糊 <input v-model.number="carousel.sidebarBlur" type="range" min="0" max="24" step="1" @change="saveCarousel"></label>
    </div>

    <!-- 库 -->
    <div v-if="loaded && wallpapers.length === 0" class="empty-hint">
      库里还没有壁纸，点右上角「上传壁纸」添加第一张
    </div>
    <div v-else-if="!loaded" class="empty-hint">
      加载中…
    </div>
    <div v-else class="wallpaper-grid">
      <div
        v-for="item in wallpapers"
        :key="item.id"
        class="wallpaper-card-item"
        :class="{ current: item.isCurrent }"
        @click="setCurrent(item)"
      >
        <div class="thumb" :style="thumbStyle(item)">
          <video v-if="item.mime.startsWith('video')" :src="item.url" muted loop autoplay playsinline />
        </div>
        <div class="item-name">
          <span class="name-text">{{ item.name }}</span>
          <label class="carousel-check" title="加入轮播" @click.stop>
            <input
              type="checkbox"
              :checked="carouselIds.has(item.id)"
              @change="toggleInPlaylist(item)"
            > 轮播
          </label>
        </div>
        <div class="item-actions" @click.stop>
          <NSelect
            :value="item.fillMode"
            :options="fillOptions"
            size="tiny"
            class="fill-select"
            @update:value="(v: string) => setFillMode(item, v)"
          />
          <NButton size="tiny" type="error" secondary @click="deleteWallpaper(item)">
            删除
          </NButton>
        </div>
        <span v-if="item.isCurrent" class="current-badge">当前</span>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.wallpaper-section {
  .wallpaper-actions {
    display: flex;
    gap: 8px;
  }
}

.file-input { display: none; }

.wallpaper-hint {
  margin: 0 0 14px;
  font-size: 12px;
  opacity: 0.55;

  b { color: $text-primary; }
}

.current-wallpaper {
  position: relative;
  aspect-ratio: 21 / 9;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 14px;
  background: rgba(128, 128, 128, 0.1);

  img, video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .current-info {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
    color: #fff;
    font-size: 13px;
  }

  .current-badge {
    background: #1a73e8;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
  }
}

.carousel-row {
  display: flex;
  gap: 20px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 14px;

  .carousel-item {
    display: flex;
    align-items: center;
    gap: 8px;

    label { font-size: 13px; opacity: 0.8; }
    .order-select { min-width: 130px; }
    .interval-input { display: flex; gap: 6px; align-items: center; }
  }
}

.tuning-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px 20px;
  padding: 12px;
  border: 1px dashed var(--border-color, rgba(128, 128, 128, 0.3));
  border-radius: 10px;
  margin-bottom: 16px;

  label {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    opacity: 0.85;

    input[type='range'] { flex: 1; }
  }
}

.empty-hint {
  padding: 28px;
  text-align: center;
  font-size: 13px;
  opacity: 0.5;
}

.wallpaper-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.wallpaper-card-item {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  background: rgba(128, 128, 128, 0.08);
  transition: border-color 0.15s;

  &:hover { border-color: rgba(128, 128, 128, 0.5); }
  &.current { border-color: #1a73e8; }

  .thumb {
    position: absolute;
    inset: 0;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
  }

  .item-name {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 5px 9px;
    font-size: 12px;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
    color: #fff;

    .name-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 55%;
    }

    .carousel-check {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      user-select: none;
    }
  }

  .item-actions {
    position: absolute;
    top: 6px; left: 6px; right: 6px;
    display: none;
    justify-content: space-between;
    align-items: center;
    gap: 6px;

    .fill-select { min-width: 104px; }
  }

  &:hover .item-actions { display: flex; }

  .current-badge {
    position: absolute;
    top: 6px; right: 6px;
    font-size: 11px;
    background: #1a73e8;
    color: #fff;
    padding: 2px 8px;
    border-radius: 10px;
  }

  &:hover .current-badge { display: none; }
}
</style>
