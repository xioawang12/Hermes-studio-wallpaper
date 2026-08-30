<script setup lang="ts">
/**
 * Wallpaper Library — multi-wallpaper management + carousel + glass tuning.
 * Data source: /api/theme/wallpapers (server) + /api/theme/carousel settings.
 * Applies the current wallpaper through the theme system's
 * --app-background-image mechanism; videos mount a fixed #hermes-bg-video layer.
 */
import { computed, onMounted, ref } from 'vue'
import { NButton, NInputNumber, NSelect, NSwitch, useMessage } from 'naive-ui'
import { request, getApiKey } from '@/api/client'

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
  mainOpacity: number
  mainBlur: number
  sidebarOpacity: number
  sidebarBlur: number
  updatedAt: number
}

const message = useMessage()

const wallpapers = ref<WallpaperItem[]>([])
const busy = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const carousel = ref<CarouselSettings>({
  enabled: false,
  orderMode: 'sequence',
  intervalSeconds: 300,
  wallpaperIds: [],
  scrimStrength: 0.25,
  mainOpacity: 0.92,
  mainBlur: 4,
  sidebarOpacity: 0.85,
  sidebarBlur: 6,
  updatedAt: 0,
})

const fillOptions = [
  { label: 'Cover（铺满裁切）', value: 'cover' },
  { label: 'Contain（完整显示）', value: 'contain' },
  { label: 'Fill（拉伸）', value: 'fill' },
]
const orderOptions = [
  { label: '顺序轮播', value: 'sequence' },
  { label: '随机轮播', value: 'random' },
]

const current = computed(() => wallpapers.value.find(w => w.isCurrent) ?? null)
const carouselIds = computed(() => new Set(carousel.value.wallpaperIds))

/** Fetch binary wallpaper file via raw fetch (request() parses JSON) with auth header. */
async function fetchWallpaperBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getApiKey()}` } })
  if (!res.ok) throw new Error(String(res.status))
  return res.blob()
}

async function loadLibrary() {
  busy.value = true
  try {
    const data = await request<{ wallpapers: WallpaperItem[]; carousel: Partial<CarouselSettings> }>('/api/theme/wallpapers')
    wallpapers.value = data.wallpapers ?? []
    if (data.carousel) carousel.value = { ...carousel.value, ...data.carousel }
    applyBackground()
    applyTuning()
  } catch {
    message.error('加载壁纸库失败')
  } finally {
    busy.value = false
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
    message.error(`上传失败：${error instanceof Error && error.message !== 'Unauthorized' ? error.message : '未授权或未知错误'}`)
  } finally {
    busy.value = false
    input.value = ''
  }
}

async function setCurrent(item: WallpaperItem) {
  busy.value = true
  try {
    await request(`/api/theme/wallpapers/${item.id}/current`, { method: 'PUT' })
    await loadLibrary()
    message.success('已设为当前壁纸')
  } catch {
    message.error('设置失败')
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
    applyBackground()
  } catch {
    message.error('更新填充模式失败')
  }
}

async function deleteWallpaper(item: WallpaperItem) {
  busy.value = true
  try {
    await request(`/api/theme/wallpapers/${item.id}`, { method: 'DELETE' })
    carousel.value.wallpaperIds = carousel.value.wallpaperIds.filter(id => id !== item.id)
    await saveCarousel()
    message.success('已删除')
    await loadLibrary()
  } catch {
    message.error('删除失败')
  } finally {
    busy.value = false
  }
}

// ---- Carousel settings persistence ----
async function saveCarousel() {
  try {
    const saved = await request<CarouselSettings>('/api/theme/carousel', {
      method: 'PUT',
      body: JSON.stringify(carousel.value),
    })
    carousel.value = { ...carousel.value, ...saved }
  } catch {
    message.error('保存轮播设置失败')
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

// ---- Background application (video-aware) ----
let backgroundObjectUrl: string | null = null
let carouselTimer: number | null = null

function revokeBackground(): void {
  if (backgroundObjectUrl) {
    URL.revokeObjectURL(backgroundObjectUrl)
    backgroundObjectUrl = null
  }
  document.getElementById('hermes-bg-video')?.remove()
  document.documentElement.style.removeProperty('--app-background-image')
}

function applyBackground(): void {
  revokeBackground()
  const item = current.value
  if (!item) return
  fetchWallpaperBlob(item.url)
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob)
      backgroundObjectUrl = objectUrl
      const isVideo = blob.type.startsWith('video') || item.mime.startsWith('video')
      if (isVideo) {
        let video = document.getElementById('hermes-bg-video') as HTMLVideoElement | null
        if (!video) {
          video = document.createElement('video')
          video.id = 'hermes-bg-video'
          video.autoplay = true
          video.loop = true
          video.muted = true
          video.playsInline = true
          video.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:cover;z-index:-1;pointer-events:none'
          document.body.appendChild(video)
        }
        video.src = objectUrl
        void video.play().catch(() => {})
        document.documentElement.style.removeProperty('--app-background-image')
      } else {
        document.getElementById('hermes-bg-video')?.remove()
        document.documentElement.style.setProperty('--app-background-image', `url("${objectUrl}")`)
      }
    })
    .catch(() => message.error('加载壁纸失败'))
}

// ---- Glass tuning (inject CSS variables + scrim layer) ----
const TUNING_STYLE_ID = 'hermes-wallpaper-tuning'

function applyTuning(): void {
  let style = document.getElementById(TUNING_STYLE_ID)
  if (style) style.remove()
  const c = carousel.value
  style = document.createElement('style')
  style.id = TUNING_STYLE_ID
  style.textContent = `
#app .app-shell { backdrop-filter: blur(${c.mainBlur}px); -webkit-backdrop-filter: blur(${c.mainBlur}px); }
#app .app-shell > * { background-color: rgba(15, 17, 21, ${c.mainOpacity}) !important; }
#app .sidebar, #app aside { background-color: rgba(15, 17, 21, ${c.sidebarOpacity}) !important; backdrop-filter: blur(${c.sidebarBlur}px) !important; }
`
  document.head.appendChild(style)
  let scrim = document.getElementById('hermes-wallpaper-scrim')
  if (!scrim) {
    scrim = document.createElement('div')
    scrim.id = 'hermes-wallpaper-scrim'
    scrim.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none'
    document.body.appendChild(scrim)
  }
  scrim.style.background = `rgba(0,0,0,${c.scrimStrength})`
}

// ---- Carousel timer ----
function resetTimer(): void {
  if (carouselTimer !== null) {
    window.clearInterval(carouselTimer)
    carouselTimer = null
  }
  const c = carousel.value
  if (!c.enabled || c.wallpaperIds.length <= 1) return
  carouselTimer = window.setInterval(() => {
    const pool = wallpapers.value.filter(w => carouselIds.value.has(w.id))
    if (pool.length <= 1) return
    let next = pool[0]
    if (c.orderMode === 'random') {
      const others = pool.filter(w => !w.isCurrent)
      next = others.length ? others[Math.floor(Math.random() * others.length)] : pool[0]
    } else {
      const currentIdx = pool.findIndex(w => w.isCurrent)
      next = pool[(currentIdx + 1) % pool.length]
    }
    if (!next.isCurrent) void setCurrent(next)
  }, c.intervalSeconds * 1000)
}

onMounted(() => {
  void loadLibrary().then(resetTimer)
})
</script>

<template>
  <div class="wallpaper-library">
    <header class="page-header">
      <div>
        <h2 class="header-title">壁纸库</h2>
        <p class="header-hint">上传图片/视频，支持轮播与玻璃调校</p>
      </div>
      <div class="header-actions">
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
    </header>

    <div class="library-content">
      <section class="wallpaper-card">
        <div class="section-heading">
          <div>
            <h3>轮播设置</h3>
            <p>多张壁纸自动轮换（勾选加入轮播的壁纸）</p>
          </div>
          <NSwitch v-model:value="carousel.enabled" @update:value="saveCarousel" />
        </div>
        <div class="carousel-row">
          <NSelect
            :value="carousel.orderMode"
            :options="orderOptions"
            size="small"
            class="carousel-select"
            @update:value="(v: string) => { carousel.orderMode = v as 'sequence'|'random'; saveCarousel() }"
          />
          <div class="interval-input">
            <NInputNumber
              :value="carousel.intervalSeconds"
              :min="10"
              :max="3600"
              :step="10"
              size="small"
              @update:value="(v: number|null) => { carousel.intervalSeconds = v ?? 300 }"
            >
              <template #suffix>秒</template>
            </NInputNumber>
            <NButton size="small" secondary @click="saveCarousel">
              应用
            </NButton>
          </div>
        </div>

        <div class="tuning-grid">
          <label>背景压暗 <input v-model.number="carousel.scrimStrength" type="range" min="0" max="0.8" step="0.05" @change="saveCarousel"></label>
          <label>面板透明 <input v-model.number="carousel.mainOpacity" type="range" min="0" max="1" step="0.05" @change="saveCarousel"></label>
          <label>面板模糊 <input v-model.number="carousel.mainBlur" type="range" min="0" max="20" step="1" @change="saveCarousel"></label>
          <label>侧栏透明 <input v-model.number="carousel.sidebarOpacity" type="range" min="0" max="1" step="0.05" @change="saveCarousel"></label>
          <label>侧栏模糊 <input v-model.number="carousel.sidebarBlur" type="range" min="0" max="20" step="1" @change="saveCarousel"></label>
        </div>
      </section>

      <section class="wallpaper-card">
        <div class="section-heading">
          <div>
            <h3>已上传（{{ wallpapers.length }}）</h3>
            <p>点击卡片设为当前壁纸，勾选加入轮播</p>
          </div>
        </div>
        <div v-if="wallpapers.length === 0" class="empty-hint">
          还没有壁纸，点击右上角「上传壁纸」添加
        </div>
        <div class="wallpaper-grid">
          <div
            v-for="item in wallpapers"
            :key="item.id"
            class="wallpaper-card-item"
            :class="{ current: item.isCurrent }"
            @click="setCurrent(item)"
          >
            <video v-if="item.mime.startsWith('video')" :src="item.url" muted loop autoplay playsinline />
            <img v-else :src="item.url" :alt="item.name">
            <div class="item-name">
              <span class="name-text">{{ item.name }}</span>
              <label class="carousel-check" @click.stop>
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
    </div>
  </div>
</template>

<style scoped lang="scss">
.wallpaper-library {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 16px 20px 0;

  .header-title { margin: 0; font-size: 18px; }
  .header-hint { margin: 2px 0 0; font-size: 12px; opacity: 0.6; }
  .header-actions { display: flex; gap: 8px; }
}

.file-input { display: none; }

.library-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 20px;
  display: grid;
  gap: 16px;
  align-content: start;
}

.wallpaper-card {
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.25));
  border-radius: 12px;
  padding: 16px;
  background: rgba(128, 128, 128, 0.06);
}

.section-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;

  h3 { margin: 0 0 2px; font-size: 15px; }
  p { margin: 0; font-size: 12px; opacity: 0.6; }
}

.carousel-row {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 14px;

  .carousel-select { min-width: 150px; }
  .interval-input { display: flex; gap: 8px; align-items: center; }
}

.tuning-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px 20px;

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
  padding: 32px;
  text-align: center;
  font-size: 13px;
  opacity: 0.5;
}

.wallpaper-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}

.wallpaper-card-item {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  background: rgba(128, 128, 128, 0.1);
  transition: border-color 0.15s;

  &:hover { border-color: rgba(128, 128, 128, 0.5); }
  &.current { border-color: #1a73e8; }

  img, video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .item-name {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    font-size: 12px;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
    color: #fff;

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

    .fill-select { min-width: 110px; }
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
