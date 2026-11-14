# BM Free Music

> 多平台聚合网络音乐播放器 · Google Material 3 设计语言 · 亮/暗双主题 · 歌单一键迁移 · 可安装 APK

一次搜索同时打九个来源的曲库，主音源放不了的会员曲目会自动降级到第三方聚合站拿完整音频。桌面端跑本地 Node 服务，安卓端是一个装好就能用的 APK。

---

---

## v1.1.0 的新东西

| 项 | 说明 |
|---|---|
| 图标 | 换成 BM Free—music 正式标识 |
| 动画 | 页面淡入、列表错峰、磁贴浮现、切歌封面弹入；`prefers-reduced-motion` 下自动关闭 |
| 搜索 | 渐进式：网易云 + QQ 先回先显示，其余六源结果到了自动合并 |
| 自动播放 | 被拦截后记住状态，任意一次点击/按键自动续播 |
| 歌手简介 | 维基百科优先，中文无词条试英文；国内网络不可达时退到百度百科，带结构化字段 |
| 下载 | 曲目菜单「下载到本地」，APK 走系统 DownloadManager 存到 Music 目录 |
| 音源设置 | 九源按钮改横向滚动，不再折行 |
| 文案 | 去掉一批解释性说明 |

---

## 两种形态

### 1. 网页版（开发 / 桌面）

```bash
cd BMFreeMusic
node server/index.js
```

浏览器自动打开 `http://127.0.0.1:5173`。零依赖、零构建。Windows 下直接双击 **`start.bat`**。

### 2. 安卓 APK（成品在项目根目录）

```
BMFreeMusic.apk      ← 直接装
```

**安装**：传到手机 → 点击安装 → 允许「安装未知来源应用」。包名 `com.bmfreemusic.app`，minSdk 23（Android 6.0+），targetSdk 34，1.4 MB。

APK 内置了一个用 Java 重写的迷你 HTTP 服务器（`android/java/.../LocalServer.java`），把桌面版 Node 服务的所有能力搬了过去：静态资源托管、`/api/raw` 反代、音频流 Range 转发、图片代理、聚合站适配。所以 **前端代码在 APK 里一行没改**，UI、逻辑、数据完全同一套。

---

## 九个音源

| 音源 | 搜索 | 歌单 | 播放 | 歌词 | 说明 |
|---|---|---|---|---|---|
| 网易云音乐 | ✔ | ✔ | ✔ 免费曲 | ✔ | 主音源，接口最稳 |
| QQ 音乐 | ✔ | ✔ | ✔ 免费曲 | ✔ | vkey 接口，GET 形式 |
| 酷狗音乐 | ✔ | ✔ | ✔ 免费曲 | ✔ | 移动端接口免 Cookie |
| 酷我音乐 | ✔ | ✔ | ✔ | ✔ | 免费曲直链最稳 |
| 咪咕音乐 | ✔ | ✔ | 走兜底 | — | 仅搜索补全 |
| 哔哩哔哩 | ✔ | — | ✔ | — | 走 dash 音频流 |
| **歌曲宝** | ✔ | — | ✔ | — | 聚合站，转存完整版 |
| **下歌宝** | ✔ | — | ✔ | — | 聚合站，与歌曲宝同源 |
| **歌曲海** | ✔ | — | ✔ | — | 聚合站 |

### 付费歌曲自动切换

播放失败时按三级降级，全自动，界面只弹一句「已自动换源」：

```
主音源解析失败
   ↓
① 聚合站（歌曲宝 → 下歌宝 → 歌曲海）
   按「歌名 ×0.65 + 歌手 ×0.35」算相似度，≥0.62 才采用
   这类站把各平台音频转存过一遍，会员曲往往能拿到完整直链
   ↓
② 其它常规音源（网易云 / QQ / 酷狗 / 酷我 / B站）
   同一音源最多试 2 个候选，总共最多 6 个
   ↓
③ 全部失败才报错，并说明具体原因
```

相似度阈值 0.62 是防串歌的底线——低于这个分数宁可不播，也不给你放一首同名不同曲的东西。

---

## 目录结构

```
BMFreeMusic/
├── BMFreeMusic.apk            ★ 安卓成品
├── index.html                 网页外壳
├── start.bat                  Windows 一键启动
├── server/
│   ├── index.js               静态服务 + 反代 + 流代理
│   └── aggregator.js          歌曲宝 / 下歌宝 / 歌曲海 适配
├── scripts/
│   └── check-sources.mjs      音源自检
├── android/                   安卓工程（不用 Gradle）
│   ├── build-apk.sh           一条命令出 APK
│   ├── AndroidManifest.xml
│   ├── java/com/bmfreemusic/app/
│   │   ├── MainActivity.java   WebView 外壳
│   │   ├── LocalServer.java    内置 HTTP 服务器
│   │   ├── Proxy.java          上游转发 + SSRF 防护
│   │   ├── Aggregator.java     聚合站 Java 实现
│   │   └── Json.java           极简 JSON
│   └── res/                    图标与字符串
├── assets/                    图标、赞助收款码
└── src/
    ├── css/                   设计令牌 + 布局 + 组件 + 视图
    └── js/
        ├── app.js             入口：路由、播放条、快捷键
        ├── core/              store / theme / player / playfail / util
        ├── api/               gateway / sources
        ├── ui/                icons / toast / components
        └── views/             七个页面 + 全屏播放
```

---

## 重新构建 APK

```bash
bash android/build-apk.sh
```

脚本用 `aapt2 → javac → d8 → 打包 → zipalign → apksigner` 全手工链路，不需要 Gradle，也不需要 Android Studio。

依赖（首次会用到 `.buildenv/` 里的 JDK 17）：

| 组件 | 位置 |
|---|---|
| JDK 17 | `.buildenv/jdk-17.0.21+9`（305 MB，可删，重建时重新下载） |
| Android SDK build-tools | `%LOCALAPPDATA%\Android\Sdk\build-tools\34.0.0` |
| platforms/android-34 | `%LOCALAPPDATA%\Android\Sdk\platforms\android-34` |
| Python | 只用来往 APK 里注入 `classes.dex` |

签名密钥 `android/bmfm.keystore`（密码 `bmfm123456`，别名 `bmfm`），首次构建自动生成。覆盖安装必须用同一个密钥，**别删**。

---

## 移动端适配

手机上不是把桌面布局缩小，而是重新排了一遍：

| 问题 | 处理 |
|---|---|
| 5 列网格把标题压成一两个字 | ≤760px 改成 3 列（序号 / 封面+标题 / 操作），专辑列隐藏、专辑名并进歌手行 |
| 封面被挤成竖条 | 封面固定 `40~44px` + `flex-basis` 锁死 + `min-width` 兜底 |
| 底部播放条互相重叠 | 收起随机/循环/音量/全屏，只留上一首、播放、下一首、队列；宽度用 grid 分配 |
| 导航栏与播放条之间漏出内容 | 导航栏 `bottom` 对齐播放条高度，去掉缝隙 |
| 播不了的歌没有提示 | 解析失败即时在行尾打「无法播放」红色标记，恢复可播后自动消失 |
| 分不清哪个音源没结果 | 搜索页音源按钮上显示命中数量，0 条的自动置灰 |
| 全屏播放页被内容撑开滚动 | 锁定一屏：`overflow:hidden` + grid 三段分配（封面 auto / 信息+歌词 1fr / 控制 auto） |
| 界面能捏合缩放、元素忽大忽小 | 见下方「尺寸锁定」 |
| B 站标题带 `&quot;` 转义 | 统一走 `stripHTML()` 解码实体 |
| 歌词一直停在「…」 | 歌词接口失败时也 emit 空结果；打开播放页先渲染已有歌词 |

### 尺寸锁定（APK 侧）

整个应用（不只是播放页）都不会被放大缩小：

```java
s.setSupportZoom(false);              // 禁双指缩放
s.setBuiltInZoomControls(false);
s.setDisplayZoomControls(false);
s.setTextZoom(100);                   // 忽略系统「字体大小」设置
s.setUseWideViewPort(false);          // 按 device-width 渲染，1 CSS px = 1 dp
s.setLoadWithOverviewMode(false);     // 关键：否则 WebView 会把整页缩小进屏幕
web.setOverScrollMode(OVER_SCROLL_NEVER);
```

页面侧再补三道：

```css
html { touch-action: manipulation; }        /* 禁双击缩放 */
html { -webkit-text-size-adjust: 100%; }    /* 禁字体自动放大 */
body { overscroll-behavior: none; }         /* 禁下拉刷新 / 边缘回弹 */
```

`viewport` 带 `user-scalable=no, maximum-scale=1, minimum-scale=1`。

前两条最容易被忽略：默认的 `setLoadWithOverviewMode(true)` 会让 WebView 为了「一屏显示全页」整体缩小，表现就是**所有元素都变小一圈、留白特别多**；而 `textZoom` 不锁定的话，用户在系统设置里调大字体，整个界面会被撑变形。

### 自适应屏幕

全屏播放页按视口分配，不写死像素：

| 元素 | 规则 |
|---|---|
| 封面 | `min(78vw, 36vh, 380px)`，长边受限、永远正方形 |
| 信息区 | 撑满剩余，歌词独立滚动并带上下渐隐 |
| 控制区 | 贴底，含 `env(safe-area-inset-bottom)` |
| 矮屏（<700px） | 封面降到 `min(52vw, 30vh, 240px)`，歌词 13px |
| 大屏手机（≥520px） | 封面放宽到 `min(58vw, 40vh, 400px)` |

截图见 `screenshots/`（390×844 与 430×932 两个视口实测）。

---

### 播放器细节

**歌词两态**

| 形态 | 表现 |
|---|---|
| 窗口态（默认） | 只显示「上一行 / 当前行 / 下一行」，当前行大字号高亮并居中，固定三个槽位所以不会上下跳动 |
| 展开态（点歌词） | 隐藏封面，铺满整屏显示全部歌词，当前行居中自动滚动；再点一次或按返回键收起 |

**后台任务**

歌单迁移和可用性体检都跑在 `jobs` 里，切页面不中断：

- 顶栏出现脉冲圆点 + 进度提示
- 点它打开任务面板，能看到每个任务的分项进度、实时日志
- 迁移中可随时取消（下一首边界生效）
- 迁移目标歌单的写入是原子的：全部处理完才落库

迁移速度也顺手提了：从「每首歌查 9 个音源」改成「聚合站优先、最多查 4 个，命中 0.9 分就提前收工」，并发 4。

**歌单体检**

本地歌单页有「检查可用性」按钮，逐首做真实探测：

```
解析播放地址 → 实际拉 2 个字节 → 看 Content-Type 是不是 audio/*
```

不是光有 URL 就算过。不可播的会在行尾打红色「无法播放」标记，顶部出现横幅支持「一键移除」。

**换源结果也要验**

原来只要拿到 URL 就开播，现在每一级兜底的结果都过一遍 `quickAudioCheck`，地址存在但返回 HTML 错误页的直接跳过，继续试下一个候选。

---

## 快捷键

| 键 | 作用 |
|---|---|
| `空格` | 播放 / 暂停 |
| `←` `→` | 快退 / 快进 5 秒 |
| `↑` `↓` | 音量 ±5% |
| `M` | 静音 |
| `S` | 随机播放 |
| `R` | 循环模式 |
| `Q` | 播放队列 |
| `F` | 全屏正在播放 |
| `Ctrl/⌘ + K` | 聚焦搜索 |
| `Esc` | 关闭浮层 / 收起全屏歌词 |

安卓端物理返回键：有浮层先关浮层 → 在子页面回上一级 → 已在首页则双击退出。

> 实现方式：前端每 400ms 把 `canGoBack` 同步给 `BMFMAndroid.setCanGoBack()`，`onKeyDown` 据此决定调 `__bmfmBack()` 还是触发双击退出。WebView 的 `evaluateJavascript` 是异步的，没法在按键回调里实时拿到返回值，所以改成状态同步。

---

## 音源自检

```bash
node scripts/check-sources.mjs           # 默认关键词「周杰伦」
node scripts/check-sources.mjs 五月天
```

逐个源输出搜索 / 歌单 / 播放地址 / 歌词状态。上游接口随时会变，这份体检就是为此准备的。

聚合站也可以单独验：

```bash
curl "http://127.0.0.1:5173/api/aggr/search?site=gequbao&kw=周杰伦&limit=3"
curl "http://127.0.0.1:5173/api/aggr/play?site=gequbao&id=4190"
```

---

## 账号绑定

### APK：应用内网页登录（推荐）

「平台账号」页每个平台都有一个 **网页登录** 按钮：

1. 点它 → 应用内弹出该平台官网的登录页
2. 正常输入账号密码 / 扫码，跟用浏览器一模一样
3. 登录成功的一瞬间，WebView 的 `CookieManager` 抓到关键凭证，弹窗自动关闭
4. 凭证写入本机，紧接着跑一次用户信息校验，昵称头像一起带回来

判据是「关键 Cookie 是否出现」，所以不用管用户用什么方式登录（密码、短信、扫码都行）：

| 平台 | 登录页 | 判据 Cookie |
|---|---|---|
| 网易云 | music.163.com/#/login | `MUSIC_U` |
| QQ 音乐 | y.qq.com | `qm_keyst` / `qqmusic_key` |
| 酷狗 | kugou.com | `KuGoo` / `kg_mid_ss` |
| 酷我 | kuwo.cn | `kw_token` |
| 咪咕 | music.migu.cn/v3 | `uid` / `token` |
| 哔哩哔哩 | passport.bilibili.com/login | `SESSDATA` |

轮询间隔 1.2 秒，5 分钟没登录成功就自动放弃，不会一直挂着。

### 网页版：粘贴 Cookie

浏览器登录对应平台 → `F12` → Application → Cookies → 拼成 `key=value; key2=value2` → 粘进「平台账号 → 粘贴 Cookie」。

| 平台 | 需要的 Cookie |
|---|---|
| 网易云 | `MUSIC_U`、`__csrf` |
| QQ 音乐 | `uin`、`qm_keyst` |
| 酷狗 | `KuGoo`、`token` |
| 酷我 | `kw_token`、`Hm_lvt` |
| 咪咕 | `uid`、`token` |
| 哔哩哔哩 | `SESSDATA` |

两种方式最终都只写进本机（APK 里是 WebView 的 localStorage，网页版是浏览器 localStorage），经本地代理转发，不上传任何第三方。

---

## 歌单一键迁移

支持粘贴：

- `https://music.163.com/#/playlist?id=3778678`（含 hash 路由）
- `https://y.qq.com/n/ryqq/playlist/7382651`
- `https://www.kugou.com/yy/special/single/xxxxx.html`
- `https://www.kuwo.cn/playlist_detail/xxxxx`
- `https://www.bilibili.com/audio/am12345`
- 简写：`netease:3778678`、`qq:7382651`
- 光秃秃的歌单 ID
- **整段分享文案**，例如 `分享周杰伦的单曲《稻香》: https://music.163.com/song?id=185809 (来自@网易云音乐)`

最后这条靠 `extractUrl()` 做：先用正则从文本里抠出 `http(s)` 链接，再逐字符剪掉末尾粘上来的中文和标点，直到能被 `URL` 解析为止。中文路径、URL 里带中文参数、`#/playlist?id=` 这类参数藏在 hash 里的情况都能正确处理。

解析器实测覆盖：

| 输入 | 结果 |
|---|---|
| `https://music.163.com/#/playlist?id=3778678` | netease / 3778678 |
| `分享周杰伦的单曲《稻香》: https://music.163.com/song?id=185809 (来自@网易云音乐)` | netease / 185809（并提示这是单曲） |
| `https://www.kugou.com/yy/special/single/1234567.html 快来听` | kugou / 1234567 |
| `歌单 3778678 很好听` | netease / 3778678 |
| `https://y.qq.com/n/ryqq/playlist/中文测试` | qq / 中文测试 |

两种处理方式：**智能换源**（每首重新匹配，保证能播）和 **原样保留**（不动音源信息）。迁移在后台跑，有逐行日志和「成功换源 / 未匹配 / 原样保留」统计。

---

## 数据持久化

三条通道，互为兜底：

| 通道 | 位置 | 作用 |
|---|---|---|
| localStorage | WebView 数据目录 | 网页版与 APK 通用 |
| SharedPreferences | APK 私有目录 `bmfm_store` | APK 专用，origin 变了也能恢复 |
| 导出文件 | 用户自选 | 换设备用 |

**端口必须固定**是这里的关键：WebView 的 localStorage 按 `http://127.0.0.1:端口` 隔离，如果每次启动随机端口，等于每次都是一个新站点，之前存的东西全部读不到——表现就是「重启后账号和歌单都没了」。所以本地服务器固定监听 `18321`，被占用才递增，递增后靠 SharedPreferences 那把兜底恢复。

写入时机也收紧了：账号绑定、歌单增删、设置变更都走 `flush()` 立即落盘，不再等 220ms 防抖；切后台时 `onPause` 会主动触发一次 `store.flush()`。

启动时两份数据比 `_savedAt` 时间戳，谁新用谁；如果 WebView 那边空了（清数据、换 origin），自动从 SharedPreferences 补读。

设置页可以导出完整备份（喜欢、歌单、设置、账号凭证）为 JSON，换机器时导入即可。

---

## 通知栏控制

播放时通知栏常驻一条媒体通知：封面、歌名、歌手，三个按钮（上一首 / 播放暂停 / 下一首）。锁屏和耳机线控的媒体键也一起接管了。

实现走系统原生 `android.media.session.MediaSession` + `Notification.MediaStyle`，不依赖 androidx（这个项目不跑 Gradle，只有 `android.jar`）：

```
WebView player 状态变化
   ↓ BMFMAndroid.updatePlayback(json)
PlaybackService.updateFromJson() → MediaSession.setMetadata + Notification
   ↑
通知栏按钮 → PendingIntent → Service → bridge.onCommand() → web.evaluateJavascript("__bmfmCommand('next')")
```

几个容易踩的点：

- `startForegroundService` 要求 5 秒内必须 `startForeground`，否则 ANR。所以服务启动时先挂一个「准备播放」的占位通知，10 秒后仍然没歌就自己退场。
- 通知小图标必须是纯白剪影（`res/drawable/ic_stat_music.png`），直接拿应用图标会被渲染成一个白方块。
- 封面图是异步下载的，下载期间先发不带封面的通知，图到了再重发一次。
- Android 13+ 需要运行时申请 `POST_NOTIFICATIONS`。

---

## 赞助

首页 hero 下方有一条入口，点「赞助支持」进入独立赞助页（`#/sponsor`）：

![首页入口](<screenshots/home-sponsor.png>)

![赞助页](<screenshots/sponsor-page.png>)

设置页也保留了一个入口。二维码支持点击放大。

**无论你是否赞助，本播放器永远免费使用，开源万岁。**

---

## 已知边界

- 上游接口都是非公开的，随时可能变更；自检脚本就是为这种情况准备的。
- 咪咕只做搜索补全，音频地址需额外鉴权，播放会自动降级。
- 聚合站依赖 HTML 解析，页面结构改动会导致失效——改 `server/aggregator.js` 里的正则即可。
- APK 是 WebView 壳，首次启动到出现界面约 1 秒（要等内置服务器起来）。
- 音乐版权归各平台所有，本项目只做聚合与播放，不存储任何音频文件。
