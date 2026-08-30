# Hermes Studio 壁纸引擎（Wallpaper Engine for Hermes Studio）

基于 [dsh-wallpaper-engine](https://github.com/TianYa-DAO/dsh-wallpaper-engine) 的设计思路，
为 Hermes Studio（hermes-web-ui）实现的 **多壁纸库 + 轮播 + 分区玻璃调校** 功能。

## 功能
- 多壁纸库：上传多张图片/视频（50MB），卡片网格管理
- 轮播播放列表：顺序/随机轮换，可配间隔
- 分区玻璃调校：主面板/侧栏/聊天区/输入框 独立透明度+模糊
- 背景压暗 scrim、fill 三模式（cover/contain/fill）
- 刷新即时恢复（localStorage + 服务端双持久化）

## 分支说明
- `wallpaper-engine` 分支：在 upstream main (v0.7.1) 基础上开发
- 构建方式与上游一致：`npm run build`
