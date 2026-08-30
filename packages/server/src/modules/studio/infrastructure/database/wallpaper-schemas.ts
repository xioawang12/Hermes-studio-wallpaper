// ============================================================================
// Wallpaper Library (multi-wallpaper carousel support)
// ============================================================================
// Extends the single-background theme system with a library of wallpapers
// per user: upload/list/delete, set-current, and carousel playlists.

export const USER_WALLPAPERS_TABLE = 'user_wallpapers'

export const USER_WALLPAPERS_SCHEMA: Record<string, string> = {
  id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  user_id: 'INTEGER NOT NULL',
  filename: 'TEXT NOT NULL',
  original_name: 'TEXT NOT NULL',
  mime: 'TEXT NOT NULL',
  is_current: 'INTEGER NOT NULL DEFAULT 0',
  sort_order: 'INTEGER NOT NULL DEFAULT 0',
  fill_mode: "TEXT NOT NULL DEFAULT 'cover'",
  created_at: 'INTEGER NOT NULL',
}

export const USER_WALLPAPERS_INDEXES: Record<string, string> = {
  idx_user_wallpapers_uid: 'CREATE INDEX IF NOT EXISTS idx_user_wallpapers_uid ON user_wallpapers(user_id)',
}

export const USER_CAROUSEL_TABLE = 'user_carousel'

export const USER_CAROUSEL_SCHEMA: Record<string, string> = {
  user_id: 'INTEGER PRIMARY KEY',
  enabled: 'INTEGER NOT NULL DEFAULT 0',
  order_mode: "TEXT NOT NULL DEFAULT 'sequence'",
  interval_seconds: 'INTEGER NOT NULL DEFAULT 300',
  wallpaper_ids: 'TEXT',
  scrim_strength: 'REAL NOT NULL DEFAULT 0',
  main_opacity: 'REAL NOT NULL DEFAULT 1',
  main_blur: 'REAL NOT NULL DEFAULT 0',
  sidebar_opacity: 'REAL NOT NULL DEFAULT 1',
  sidebar_blur: 'REAL NOT NULL DEFAULT 0',
  updated_at: 'INTEGER NOT NULL',
}
