import { randomBytes } from 'crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { config } from '../../public/config'
import {
  addWallpaperRecord,
  deleteWallpaperRecord,
  WallpaperValidationError,
  type UserWallpaperRecord,
} from '../../repositories/user-wallpaper-store'

export const MAX_WALLPAPER_BYTES = 50 * 1024 * 1024

const WALLPAPER_ASSET_ROOT = join(config.appHome, 'wallpaper-library')

const MEDIA_TYPES = {
  jpeg: { mime: 'image/jpeg', extension: '.jpg' },
  png: { mime: 'image/png', extension: '.png' },
  webp: { mime: 'image/webp', extension: '.webp' },
  gif: { mime: 'image/gif', extension: '.gif' },
  mp4: { mime: 'video/mp4', extension: '.mp4' },
  webm: { mime: 'video/webm', extension: '.webm' },
  mov: { mime: 'video/quicktime', extension: '.mov' },
} as const

export { WallpaperValidationError }

function normalizeUserId(value: unknown): number {
  const userId = Number(value)
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new WallpaperValidationError('Invalid user')
  }
  return userId
}

/** Magic-number sniffing: images and videos (mp4/mov via ftyp, webm via EBML). */
function detectMediaType(data: Buffer): typeof MEDIA_TYPES[keyof typeof MEDIA_TYPES] | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return MEDIA_TYPES.png
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return MEDIA_TYPES.jpeg
  }
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return MEDIA_TYPES.webp
  }
  if (data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))) {
    return MEDIA_TYPES.gif
  }
  // MP4/MOV: bytes 4-8 = 'ftyp', brand at 8-12
  if (data.length >= 12 && data.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = data.subarray(8, 12).toString('ascii')
    if (brand.startsWith('qt')) return MEDIA_TYPES.mov
    if (['isom', 'iso5', 'iso6', 'mp42', 'mp41', 'avc1', 'M4V '].includes(brand)) return MEDIA_TYPES.mp4
  }
  // WebM/Matroska: EBML magic 0x1A45DFA3
  if (data.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    return MEDIA_TYPES.webm
  }
  return null
}

function wallpaperDirectory(userId: number): string {
  return join(WALLPAPER_ASSET_ROOT, String(userId))
}

function storedWallpaperPath(userId: number, filename: string): string {
  if (!/^[a-f0-9]{32}\.(?:jpg|png|webp|gif|mp4|webm|mov)$/.test(filename)) {
    throw new Error('Invalid stored wallpaper filename')
  }
  return join(wallpaperDirectory(userId), filename)
}

export function sanitizeWallpaperName(value: string): string {
  const name = basename(value.replaceAll('\\', '/')).trim()
  return (name || 'wallpaper').slice(0, 255)
}

export async function saveWallpaperFile(
  userIdValue: unknown,
  originalName: string,
  data: Buffer,
): Promise<UserWallpaperRecord> {
  const userId = normalizeUserId(userIdValue)
  if (!data.length) throw new WallpaperValidationError('Wallpaper file is empty')
  if (data.length > MAX_WALLPAPER_BYTES) {
    throw new WallpaperValidationError('Wallpaper file exceeds the 50 MB limit', 413)
  }
  const mediaType = detectMediaType(data)
  if (!mediaType) {
    throw new WallpaperValidationError('Use a PNG, JPEG, WebP, GIF, MP4, WebM, or MOV file', 415)
  }

  const directory = wallpaperDirectory(userId)
  const filename = `${randomBytes(16).toString('hex')}${mediaType.extension}`
  const finalPath = storedWallpaperPath(userId, filename)
  const temporaryPath = join(directory, `.${filename}.tmp`)
  await mkdir(directory, { recursive: true })
  await writeFile(temporaryPath, data, { mode: 0o600 })
  await rename(temporaryPath, finalPath)

  try {
    return addWallpaperRecord({
      userId,
      filename,
      originalName: sanitizeWallpaperName(originalName),
      mime: mediaType.mime,
    })
  } catch (error) {
    await unlink(finalPath).catch(() => undefined)
    throw error
  }
}

export async function readWallpaperFile(
  userIdValue: unknown,
  filename: unknown,
): Promise<{ data: Buffer; mime: string } | null> {
  const userId = normalizeUserId(userIdValue)
  if (typeof filename !== 'string') return null
  try {
    return {
      data: await readFile(storedWallpaperPath(userId, filename)),
      mime: 'application/octet-stream',
    }
  } catch {
    return null
  }
}

export async function removeWallpaperFile(
  userIdValue: unknown,
  filename: unknown,
): Promise<void> {
  const userId = normalizeUserId(userIdValue)
  if (typeof filename !== 'string') return
  await unlink(storedWallpaperPath(userId, filename)).catch(() => undefined)
}

export function wallpaperFilePath(userIdValue: unknown, filename: unknown): string {
  const userId = normalizeUserId(userIdValue)
  if (typeof filename !== 'string') throw new WallpaperValidationError('Invalid filename')
  return storedWallpaperPath(userId, filename)
}
