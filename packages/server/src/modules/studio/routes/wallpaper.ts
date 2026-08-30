import Router from '@koa/router'
import * as wallpaperCtrl from '../controllers/wallpaper'

export const wallpaperRoutes = new Router()

wallpaperRoutes.get('/api/theme/wallpapers', wallpaperCtrl.listWallpapers)
wallpaperRoutes.post('/api/theme/wallpapers', wallpaperCtrl.uploadWallpaper)
wallpaperRoutes.get('/api/theme/wallpapers/current/file', wallpaperCtrl.serveCurrentWallpaperFile)
wallpaperRoutes.get('/api/theme/wallpapers/:wallpaperId/file', wallpaperCtrl.getWallpaperFile)
wallpaperRoutes.put('/api/theme/wallpapers/:wallpaperId/current', wallpaperCtrl.setCurrent)
wallpaperRoutes.put('/api/theme/wallpapers/:wallpaperId/fill', wallpaperCtrl.updateFillMode)
wallpaperRoutes.delete('/api/theme/wallpapers/:wallpaperId', wallpaperCtrl.deleteWallpaper)
wallpaperRoutes.get('/api/theme/carousel', wallpaperCtrl.getCarousel)
wallpaperRoutes.put('/api/theme/carousel', wallpaperCtrl.updateCarousel)
