import type { Context } from 'koa'
import {
  listUserWallpapers,
  getWallpaperById,
  updateWallpaperFillMode,
  deleteWallpaperRecord,
  getUserCarousel,
  saveUserCarousel,
  WallpaperValidationError,
} from '../repositories/user-wallpaper-store'
import {
  applyWallpaperAsCurrent,
  saveWallpaperFile,
  removeWallpaperFile,
  wallpaperFilePath,
  readLibraryWallpaperFile,
  MAX_WALLPAPER_BYTES,
} from '../services/theme/user-wallpaper'
import {
  MultipartParseError,
  parseMultipartBoundary,
  parseMultipartFilename,
  splitMultipart,
} from '../http/multipart'
import { createReadStream, existsSync, statSync } from 'fs'

const MAX_MULTIPART_BYTES = MAX_WALLPAPER_BYTES + 256 * 1024

function userId(ctx: Context): number | null {
  return ctx.state.user?.id || null
}

function unauthorized(ctx: Context): void {
  ctx.status = 401
  ctx.body = { error: 'Unauthorized' }
}

function fail(ctx: Context, error: unknown): void {
  if (error instanceof WallpaperValidationError) {
    const withStatus = error as unknown as { status?: number }
    ctx.status = withStatus.status ?? 400
    ctx.body = { error: error.message }
    return
  }
  if (error instanceof MultipartParseError) {
    ctx.status = 400
    ctx.body = { error: error.message }
    return
  }
  throw error
}

function toPayload(record: {
  id: number
  filename: string
  originalName: string
  mime: string
  isCurrent: boolean
  fillMode: string
  createdAt: number
}) {
  return {
    id: record.id,
    filename: record.filename,
    name: record.originalName,
    mime: record.mime,
    isCurrent: record.isCurrent,
    fillMode: record.fillMode,
    url: `/api/theme/wallpapers/${record.id}/file?v=${record.createdAt}`,
    createdAt: record.createdAt,
  }
}

export async function listWallpapers(ctx: Context) {
  const id = userId(ctx)
  if (!id) return unauthorized(ctx)
  const wallpapers = listUserWallpapers(id).map(toPayload)
  const carousel = getUserCarousel(id)
  ctx.body = { wallpapers, carousel }
}

export async function uploadWallpaper(ctx: Context) {
  const id = userId(ctx)
  if (!id) return unauthorized(ctx)

  const contentType = ctx.get('content-type') || ''
  if (!contentType.startsWith('multipart/form-data')) {
    ctx.status = 400
    ctx.body = { error: 'Expected multipart/form-data' }
    return
  }
  const boundary = parseMultipartBoundary(contentType)
  if (!boundary) {
    ctx.status = 400
    ctx.body = { error: 'Missing boundary' }
    return
  }

  const chunks: Buffer[] = []
  let totalSize = 0
  for await (const chunk of ctx.req) {
    totalSize += chunk.length
    if (totalSize > MAX_MULTIPART_BYTES) {
      ctx.status = 413
      ctx.body = { error: 'Wallpaper file exceeds the 50 MB limit' }
      return
    }
    chunks.push(chunk)
  }

  for (const part of splitMultipart(Buffer.concat(chunks), boundary)) {
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd === -1) continue
    const header = part.subarray(0, headerEnd).toString('utf-8')
    let filename: string | null
    try {
      filename = parseMultipartFilename(header)
    } catch (error) {
      return fail(ctx, error)
    }
    if (!filename) continue

    try {
      const data = part.subarray(headerEnd + 4, part.length - 2)
      const record = await saveWallpaperFile(id, filename, data)
      ctx.status = 201
      ctx.body = toPayload(record)
      return
    } catch (error) {
      return fail(ctx, error)
    }
  }

  ctx.status = 400
  ctx.body = { error: 'Missing wallpaper file' }
}

export async function setCurrent(ctx: Context) {
  const id = userId(ctx)
  if (!id) return unauthorized(ctx)
  try {
    const wallpaperId = Number(ctx.params.wallpaperId)
    const { wallpaper } = await applyWallpaperAsCurrent(id, wallpaperId)
    ctx.body = toPayload(wallpaper)
  } catch (error) {
    fail(ctx, error)
  }
}

export async function getWallpaperFile(ctx: Context) {
  const id = userId(ctx)
  if (!id) return unauthorized(ctx)
  try {
    const wallpaperId = Number(ctx.params.wallpaperId)
    const record = getWallpaperById(id, wallpaperId)
    if (!record) {
      ctx.status = 404
      ctx.body = { error: 'Wallpaper not found' }
      return
    }
    const filePath = wallpaperFilePath(id, record.filename)
    if (!existsSync(filePath)) {
      ctx.status = 404
      ctx.body = { error: 'Wallpaper file missing' }
      return
    }
    ctx.type = record.mime
    ctx.set('Cache-Control', 'private, max-age=3600')
    ctx.set('ETag', `"wallpaper-${record.id}-${record.createdAt}"`)
    ctx.length = statSync(filePath).size
    ctx.body = createReadStream(filePath)
  } catch (error) {
    fail(ctx, error)
  }
}

export async function serveCurrentWallpaperFile(ctx: Context) {
  const id = userId(ctx)
  if (!id) return unauthorized(ctx)
  try {
    const wallpapers = listUserWallpapers(id)
    const current = wallpapers.find(w => w.isCurrent)
    if (!current) {
      ctx.status = 404
      ctx.body = { error: 'No current wallpaper' }
      return
    }
    const filePath = wallpaperFilePath(id, current.filename)
    if (!existsSync(filePath)) {
      ctx.status = 404
      ctx.body = { error: 'Wallpaper file missing' }
      return
    }
    ctx.type = current.mime
    ctx.set('Cache-Control', 'private, max-age=60')
    ctx.set('ETag', `"wallpaper-current-${current.id}-${current.createdAt}"`)
    ctx.length = statSync(filePath).size
    ctx.body = createReadStream(filePath)
  } catch (error) {
    fail(ctx, error)
  }
}

export async function updateFillMode(ctx: Context) {
  const id = userId(ctx)
  if (!id) return unauthorized(ctx)
  try {
    const wallpaperId = Number(ctx.params.wallpaperId)
    const body = ctx.request.body as Record<string, unknown> | undefined
    const record = updateWallpaperFillMode(id, wallpaperId, body?.fillMode)
    ctx.body = toPayload(record)
  } catch (error) {
    fail(ctx, error)
  }
}

export async function deleteWallpaper(ctx: Context) {
  const id = userId(ctx)
  if (!id) return unauthorized(ctx)
  try {
    const wallpaperId = Number(ctx.params.wallpaperId)
    // Full cleanup: library row + library file + mirrored hard-link in theme-backgrounds.
    // If the deleted one was current, fall back to another wallpaper or clear the theme.
    const wasCurrent = getWallpaperById(id, wallpaperId)?.isCurrent === true
    const remaining = listUserWallpapers(id).filter(w => w.id !== wallpaperId)
    await import('../services/theme/user-wallpaper').then(m => m.deleteWallpaperEverywhere(id, wallpaperId))
    if (wasCurrent && remaining.length > 0) {
      await import('../services/theme/user-wallpaper').then(m => m.applyWallpaperAsCurrent(id, remaining[0].id))
    } else if (wasCurrent) {
      ctx.body = { ok: true, cleared: true }
      return
    }
    ctx.body = { ok: true }
  } catch (error) {
    fail(ctx, error)
  }
}

export async function getCarousel(ctx: Context) {
  const id = userId(ctx)
  if (!id) return unauthorized(ctx)
  ctx.body = getUserCarousel(id)
}

export async function updateCarousel(ctx: Context) {
  const id = userId(ctx)
  if (!id) return unauthorized(ctx)
  try {
    const body = ctx.request.body as Record<string, unknown> | undefined
    ctx.body = saveUserCarousel(id, body || {})
  } catch (error) {
    fail(ctx, error)
  }
}

// re-export for delete handler's dynamic import typing
export { readLibraryWallpaperFile }
