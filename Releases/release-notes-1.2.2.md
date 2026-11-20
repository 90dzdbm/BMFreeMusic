# BM Free Music v1.2.2

> 多平台聚合网络音乐播放器 · 免费 · 开源
> 仓库：https://github.com/90dzdbm/BMFreeMusic

## 本次更新

### 桌面歌词
- **不再遮挡下层应用的点击**：歌词悬浮窗默认加 `FLAG_NOT_TOUCHABLE`，完全不接收触摸事件，盖在别的应用上也不会吃掉人家点的按钮。
- **可拖动改成独立开关**：Android 上「可拖动」和「可触摸」是同一件事，窗口要接收手指才能被拖走。所以拆成开关——默认关闭（位置固定、绝不挡点击），打开后切可触摸模式，此时会挡下层点击，设置项描述里会写清楚。
- **颜色可调**：设置 → 外观 → 歌词颜色，取色器任选（支持 `#RGB` / `#RRGGBB` / `#AARRGGBB`）。
- **透明度可调**：10%–100% 滑块，原生层同时作用于 `setAlpha` 与文字色 alpha。
- 只显示当前这一句歌词，无背景，只用阴影保证浅色壁纸可读。
- 软件在前台时自动隐藏，拖动位置会记住（下次启动恢复原位）。

### 检查更新
- 扩充 GitHub 加速代理到 9 条前缀代理 + 3 个直连型镜像。
- 先探测代理连通性（HEAD），不通立刻换下一个，通了才去取 `latest.json`。
- 任务条实时显示当前正在试哪个代理。

### 修复
- **歌单解析 `list is not iterable`**：各平台 `playlist()` 返回的是歌单对象而不是数组，去重逻辑写错导致歌单解析、首页榜单、歌单一键迁移三条路同时中断。已兼容两种返回形式。

### 其它
- 顶部任务进度条改为 `.app` 的第一个 flex 子项，不再用 `position: fixed` 压住搜索栏。
- 桌面歌词偶发崩溃修复：去掉 `FLAG_LAYOUT_NO_LIMITS`、窗口操作全部回主线程、attach/detach 加锁、窗口回收后不再 updateViewLayout。
- 构建脚本加固：javac 逐个源文件校验 class 是否生成，避免编译失败却拿旧 dex 打包。

## 安装

- `BMFreeMusic-1.2.2.apk` — 直接安装，可覆盖旧版本（签名证书一致，versionCode 161）。
- `BMFreeMusic-1.2.2-source.zip` — 完整源码。

## 校验

```
f23024979425c7b8740f515a057b2258dcec34405ab5c5df18b595b67f01787e  BMFreeMusic-1.2.2.apk
ee566c26d7bea7a0b69d01aee4a2f7b3a45cb7f75bb5a3f451880873e8fc887d  BMFreeMusic-1.2.2-source.zip
```

## 许可

本项目开源免费使用，源码托管在 GitHub，欢迎 Star 与 PR。
