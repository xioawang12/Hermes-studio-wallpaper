import { getDb } from '../infrastructure/database'
import { USER_WALLPAPERS_TABLE } from '../infrastructure/database/schemas'

export interface UserWallpaperRecord {
  id: number
  userId: number
  filename: string
  originalName: string
  mime: string
  isCurrent: boolean
  sortOrder: number
  fillMode: 'cover' | 'contain' | 'fill'
  createdAt: number
}

export type WallpaperFillMode = 'cover' | 'contain' | 'fill'

interface StoredUserWallpaperRow {
  id: number
  user_id: number
  filename: string
  original_name: string
  mime: string
  is_current: number
  sort_order: number
  fill_mode: string
  created_at: number
}

export class WallpaperValidationError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message)
  }
}

function requireDb() {
  const db = getDb()
  if (!db) throw new Error('Wallpaper storage unavailable')
  return db
}

function normalizeUserId(value: unknown): number {
  const userId = Number(value)
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new WallpaperValidationError('Invalid user')
  }
  return userId
}

function mapRow(row: StoredUserWallpaperRow): UserWallpaperRecord {
  return {
    id: row.id,
    userId: row.user_id,
    filename: row.filename,
    originalName: row.original_name,
    mime: row.mime,
    isCurrent: row.is_current === 1,
    sortOrder: row.sort_order,
    fillMode: (['cover', 'contain', 'fill'] as const).includes(row.fill_mode as WallpaperFillMode)
      ? (row.fill_mode as WallpaperFillMode)
      : 'cover',
    createdAt: row.created_at,
  }
}

export function normalizeFillMode(value: unknown): WallpaperFillMode {
  return value === 'contain' || value === 'fill' ? value : 'cover'
}

export function listUserWallpapers(userIdValue: unknown): UserWallpaperRecord[] {
  const userId = normalizeUserId(userIdValue)
  const rows = requireDb().prepare(
    `SELECT * FROM ${USER_WALLPAPERS_TABLE} WHERE user_id = ? ORDER BY sort_order ASC, id ASC`,
  ).all(userId) as StoredUserWallpaperRow[]
  return rows.map(mapRow)
}

export function getWallpaperById(userIdValue: unknown, wallpaperId: unknown): UserWallpaperRecord | null {
  const userId = normalizeUserId(userIdValue)
  const wallpaperIdNum = Number(wallpaperId)
  if (!Number.isInteger(wallpaperIdNum) || wallpaperIdNum <= 0) {
    throw new WallpaperValidationError('Invalid wallpaper id')
  }
  const row = requireDb().prepare(
    `SELECT * FROM ${USER_WALLPAPERS_TABLE} WHERE id = ? AND user_id = ?`,
  ).get(wallpaperIdNum, userId) as StoredUserWallpaperRow | undefined
  return row ? mapRow(row) : null
}

export function addWallpaperRecord(input: {
  userId: unknown
  filename: string
  originalName: string
  mime: string
}): UserWallpaperRecord {
  const userId = normalizeUserId(input.userId)
  const now = Date.now()
  const db = requireDb()
  const maxOrder = db.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM ${USER_WALLPAPERS_TABLE} WHERE user_id = ?`,
  ).get(userId) as { m: number }
  const result = db.prepare(
    `INSERT INTO ${USER_WALLPAPERS_TABLE} (user_id, filename, original_name, mime, is_current, sort_order, fill_mode, created_at)
     VALUES (?, ?, ?, ?, 0, ?, 'cover', ?)`,
  ).run(userId, input.filename, input.originalName, input.mime, maxOrder.m + 1, now)
  const row = db.prepare(
    `SELECT * FROM ${USER_WALLPAPERS_TABLE} WHERE id = ?`,
  ).get(result.lastInsertRowid) as StoredUserWallpaperRow
  return mapRow(row)
}

/** Set exactly one wallpaper as current for the user; clears the previous one. */
export function setCurrentWallpaper(userIdValue: unknown, wallpaperId: unknown): UserWallpaperRecord {
  const userId = normalizeUserId(userIdValue)
  const db = requireDb()
  const wallpaperIdNum = Number(wallpaperId)
  if (!Number.isInteger(wallpaperIdNum) || wallpaperIdNum <= 0) {
    throw new WallpaperValidationError('Invalid wallpaper id')
  }
  const target = db.prepare(
    `SELECT id FROM ${USER_WALLPAPERS_TABLE} WHERE id = ? AND user_id = ?`,
  ).get(wallpaperIdNum, userId)
  if (!target) throw new WallpaperValidationError('Wallpaper not found', 404)
  db.exec('BEGIN')
  try {
    db.prepare(`UPDATE ${USER_WALLPAPERS_TABLE} SET is_current = 0 WHERE user_id = ?`).run(userId)
    db.prepare(`UPDATE ${USER_WALLPAPERS_TABLE} SET is_current = 1 WHERE id = ? AND user_id = ?`).run(wallpaperIdNum, userId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  const row = db.prepare(
    `SELECT * FROM ${USER_WALLPAPERS_TABLE} WHERE id = ?`,
  ).get(wallpaperIdNum) as StoredUserWallpaperRow
  return mapRow(row)
}

export function updateWallpaperFillMode(
  userIdValue: unknown,
  wallpaperId: unknown,
  fillMode: unknown,
): UserWallpaperRecord {
  const userId = normalizeUserId(userIdValue)
  const wallpaperIdNum = Number(wallpaperId)
  if (!Number.isInteger(wallpaperIdNum) || wallpaperIdNum <= 0) {
    throw new WallpaperValidationError('Invalid wallpaper id')
  }
  const mode = normalizeFillMode(fillMode)
  const db = requireDb()
  const result = db.prepare(
    `UPDATE ${USER_WALLPAPERS_TABLE} SET fill_mode = ? WHERE id = ? AND user_id = ?`,
  ).run(mode, wallpaperIdNum, userId)
  if (result.changes === 0) throw new WallpaperValidationError('Wallpaper not found', 404)
  const row = db.prepare(
    `SELECT * FROM ${USER_WALLPAPERS_TABLE} WHERE id = ?`,
  ).get(wallpaperIdNum) as StoredUserWallpaperRow
  return mapRow(row)
}

export function deleteWallpaperRecord(userIdValue: unknown, wallpaperId: unknown): UserWallpaperRecord {
  const userId = normalizeUserId(userIdValue)
  const wallpaperIdNum = Number(wallpaperId)
  if (!Number.isInteger(wallpaperIdNum) || wallpaperIdNum <= 0) {
    throw new WallpaperValidationError('Invalid wallpaper id')
  }
  const db = requireDb()
  const row = db.prepare(
    `SELECT * FROM ${USER_WALLPAPERS_TABLE} WHERE id = ? AND user_id = ?`,
  ).get(wallpaperIdNum, userId) as StoredUserWallpaperRow | undefined
  if (!row) throw new WallpaperValidationError('Wallpaper not found', 404)
  db.prepare(`DELETE FROM ${USER_WALLPAPERS_TABLE} WHERE id = ? AND user_id = ?`).run(wallpaperIdNum, userId)
  return mapRow(row)
}

// ---------------------------------------------------------------------------
// Carousel settings
// ---------------------------------------------------------------------------

export interface UserCarouselRecord {
  userId: number
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

interface StoredUserCarouselRow {
  user_id: number
  enabled: number
  order_mode: string
  interval_seconds: number
  wallpaper_ids: string | null
  scrim_strength: number
  main_opacity: number
  main_blur: number
  sidebar_opacity: number
  sidebar_blur: number
  updated_at: number
}

export const CAROUSEL_LIMITS = {
  minInterval: 10,
  maxInterval: 3600,
  maxPlaylistLength: 100,
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function mapCarouselRow(row: StoredUserCarouselRow): UserCarouselRecord {
  let ids: number[] = []
  try {
    const parsed = JSON.parse(row.wallpaper_ids ?? '[]')
    if (Array.isArray(parsed)) ids = parsed.filter((n) => Number.isInteger(n)).slice(0, CAROUSEL_LIMITS.maxPlaylistLength)
  } catch { ids = [] }
  return {
    userId: row.user_id,
    enabled: row.enabled === 1,
    orderMode: row.order_mode === 'random' ? 'random' : 'sequence',
    intervalSeconds: row.interval_seconds,
    wallpaperIds: ids,
    scrimStrength: row.scrim_strength,
    mainOpacity: row.main_opacity,
    mainBlur: row.main_blur,
    sidebarOpacity: row.sidebar_opacity,
    sidebarBlur: row.sidebar_blur,
    updatedAt: row.updated_at,
  }
}

function defaultCarousel(userId: number): UserCarouselRecord {
  return {
    userId,
    enabled: false,
    orderMode: 'sequence',
    intervalSeconds: 300,
    wallpaperIds: [],
    scrimStrength: 0,
    mainOpacity: 1,
    mainBlur: 0,
    sidebarOpacity: 1,
    sidebarBlur: 0,
    updatedAt: 0,
  }
}

export function getUserCarousel(userIdValue: unknown): UserCarouselRecord {
  const userId = normalizeUserId(userIdValue)
  const db = getDb()
  if (!db) return defaultCarousel(userId)
  const row = db.prepare(
    `SELECT * FROM ${USER_CAROUSEL_TABLE} WHERE user_id = ?`,
  ).get(userId) as StoredUserCarouselRow | undefined
  return row ? mapCarouselRow(row) : defaultCarousel(userId)
}

export interface UserCarouselPatch {
  enabled?: unknown
  orderMode?: unknown
  intervalSeconds?: unknown
  wallpaperIds?: unknown
  scrimStrength?: unknown
  mainOpacity?: unknown
  mainBlur?: unknown
  sidebarOpacity?: unknown
  sidebarBlur?: unknown
}

export function saveUserCarousel(userIdValue: unknown, patch: UserCarouselPatch): UserCarouselRecord {
  const userId = normalizeUserId(userIdValue)
  const current = getUserCarousel(userId)
  const db = requireDb()

  let enabled = current.enabled
  if (patch.enabled !== undefined) enabled = patch.enabled === true || patch.enabled === 'true' || patch.enabled === 1

  let orderMode = current.orderMode
  if (patch.orderMode !== undefined) orderMode = patch.orderMode === 'random' ? 'random' : 'sequence'

  let intervalSeconds = current.intervalSeconds
  if (patch.intervalSeconds !== undefined) {
    intervalSeconds = Math.round(clamp(patch.intervalSeconds, CAROUSEL_LIMITS.minInterval, CAROUSEL_LIMITS.maxInterval, current.intervalSeconds))
  }

  let wallpaperIds = current.wallpaperIds
  if (patch.wallpaperIds !== undefined) {
    if (!Array.isArray(patch.wallpaperIds)) throw new WallpaperValidationError('wallpaperIds must be an array')
    wallpaperIds = patch.wallpaperIds
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, CAROUSEL_LIMITS.maxPlaylistLength)
  }

  const scrimStrength = patch.scrimStrength !== undefined ? clamp(patch.scrimStrength, 0, 1, current.scrimStrength) : current.scrimStrength
  const mainOpacity = patch.mainOpacity !== undefined ? clamp(patch.mainOpacity, 0, 1, current.mainOpacity) : current.mainOpacity
  const mainBlur = patch.mainBlur !== undefined ? clamp(patch.mainBlur, 0, 40, current.mainBlur) : current.mainBlur
  const sidebarOpacity = patch.sidebarOpacity !== undefined ? clamp(patch.sidebarOpacity, 0, 1, current.sidebarOpacity) : current.sidebarOpacity
  const sidebarBlur = patch.sidebarBlur !== undefined ? clamp(patch.sidebarBlur, 0, 40, current.sidebarBlur) : current.sidebarBlur

  const now = Date.now()
  db.prepare(
    `INSERT INTO ${USER_CAROUSEL_TABLE} (user_id, enabled, order_mode, interval_seconds, wallpaper_ids, scrim_strength, main_opacity, main_blur, sidebar_opacity, sidebar_blur, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       enabled=excluded.enabled, order_mode=excluded.order_mode, interval_seconds=excluded.interval_seconds,
       wallpaper_ids=excluded.wallpaper_ids, scrim_strength=excluded.scrim_strength,
       main_opacity=excluded.main_opacity, main_blur=excluded.main_blur,
       sidebar_opacity=excluded.sidebar_opacity, sidebar_blur=excluded.sidebar_blur,
       updated_at=excluded.updated_at`,
  ).run(
    userId,
    enabled ? 1 : 0,
    orderMode,
    intervalSeconds,
    JSON.stringify(wallpaperIds),
    scrimStrength,
    mainOpacity,
    mainBlur,
    sidebarOpacity,
    sidebarBlur,
    now,
  )
  return getUserCarousel(userId)
}
