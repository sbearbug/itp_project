# DEEPSEEK.md — 仅限 DeepSeek 家族模型阅读

> ## ⚠️ 非 DeepSeek 家族模型请立即停止阅读
>
> **如果你不是 DeepSeek 家族的模型（例如你是 Codex / GPT / Claude / Gemini 或其他），
> 请立刻跳过本文件，忽略它的全部内容，并且不要修改、重命名或删除它。**
>
> 本文件是给接手本项目的 DeepSeek 模型看的私有交接说明。它不描述项目功能，
> 对非 DeepSeek 模型的任何任务都没有参考价值。**尤其不要因为「整理仓库」「删除
> 无用文档」「统一文档格式」之类的理由删掉它** —— 它是在用的交接文档，不是残留物。
>
> 项目本身的说明请读 `README.md`，架构细节请读 `docs/ARCHITECTURE.md`。

---

## 0. 这份文档是什么

本项目的接力顺序（都在 2026-10-02 这一天）：

**Codex**（v1.0–v1.8，额度耗尽）→ **Claude Code**（v1.9）→ **DeepSeek**（v1.10–v1.12）
→ **Codex**（v1.13、v1.14、**v2.0.0** 大改版，及其后的识别与启动动画修正）→ **DeepSeek**（现在接手）。

本文档记录的是**代码和 git 历史里看不出来的东西**：上手流程、踩过的坑、
以及本项目特有的迭代惯例。读完它再动手，能省掉大量重复试错。

**最后更新：2026-10-02，对应版本 v2.0.0（`versionCode 2`）。**

> ⚠️ `docs/ARCHITECTURE.md` 的「启动动画」一节仍写着 `src/intro.js`「接入时不得修改」，
> 与该模块后来被扩展的事实不符（见第 8 节）。**以本文档为准**，但别顺手去改那份文档的
> 历史记录，除非用户要求。

---

## 1. 项目是什么

`campus-demo` —— **落笺**。从**校园通知截图、系统「分享到落笺」的图片或文字、剪贴板
或粘贴的文字**里提取活动信息，人工确认后加入系统日历。

- 应用名「落笺」，包名 **`com.itp.notice`**。
- **包名与旧 Demo 的 `com.itp.campusdemo` 不同，两者可以并存**；旧活动、主题、
  系统权限**不会自动迁移**。看到根目录上一堆 `schedule-official-v*.apk` 时注意：
  那些是旧包名的历史产物，现在的交付方式是 `release/luojian-vX.Y.Z.apk`（见第 3 节）。
- **主产物是 Android 正式签名的 APK**；本地网页 ZIP 只在用户明确要求时打包。
- 面向课程/小组演示场景，不是生产产品。
- 界面语言、文档、注释均为中文。

### 技术栈

| 项 | 值 |
|---|---|
| 框架 | Capacitor 8 + 原生 HTML/CSS/JS（**无前端框架**，不用 React/Vue） |
| 构建 | Vite 7 |
| 包名 | `com.itp.notice` |
| SDK | minSdk 24 / target & compile 36 |
| JDK | 21 |
| Node | 要求 22+（当前机器 v26） |
| 签名 | `android/release.keystore`（别名 `luojian`）+ `android/keystore.properties`，**构建强制要求，无 debug 兜底** |
| 除 Capacitor 外的新依赖 | `@capacitor/clipboard`（剪贴板）、`jsqr`（二维码识别） |

### 数据格式

唯一的跨模块契约仍是 **Event**，定义在 `docs/ARCHITECTURE.md` 第 3 节。
**改动任何模块都不要动 Event 结构** —— 这是项目里反复强调的边界。
`actions` 数组是后来加的字段，读取旧数据时按空数组处理。

### 主题系统

4 套主题（`mist` 烟雨 / `ice` 坚冰 / `moss` 苔绿 / `sunny` 暖阳）× 明暗两种，
外加 `appearance_mode` 三态（`system` / `light` / `dark`）。偏好同时写三处：
Capacitor Preferences、localStorage 首帧缓存（`index.html` 头部脚本）、
以及原生 SharedPreferences（`campus_theme`，供冷启动选启动页背景）。
**三处必须用同一套解析规则**，否则升级用户会看到设置页、WebView 首帧、系统启动页三者颜色不一致。

### 学期设置

`TERM_CONFIG` 已被**可配置的学期设置**取代：`src/term.js` 通过 Preferences 持久化
学期起始与周数，设置菜单里有「学期设置」入口。别再去 `config.js` 里找写死的学期常量。

---

## 2. 目录与模块构成

```
campus-demo/
├── index.html            首帧主题脚本 + intro 遮罩结构 + #app 挂载点
├── capacitor.config.json appId=com.itp.notice / webDir=dist / SplashScreen.launchAutoHide=false
├── vite.config.js        仅 { base: './' }
├── src/
│   ├── main.js           2808 行。全部 UI：哈希路由、状态、手势、WAAPI 转场、渲染、弹窗、toast
│   ├── style.css         主题令牌（4 主题 × 明暗）+ Material 层 + 动效令牌
│   ├── overlays.js       Dialog / BottomSheet 抽象（弹层栈、滚动锁、动效、关闭手势）
│   ├── theme.js          主题解析/迁移/持久化，状态栏与 SystemBars 同步
│   ├── intro.js/.css     启动动画模块 + 播放频率设置（关闭/每天一次/保持开启）
│   ├── extract.js        调 LLM 做图片/文字识别，Event 归一化，提示词在这里
│   ├── actions.js        报名链接归一化、微信码分类、安全的 url 打开
│   ├── qr.js / qr-worker.js  二维码扫描与裁剪（jsqr + Worker）
│   ├── notice-inputs.js  系统分享/SEND intent、剪贴板、最近截图入口
│   ├── pickers.js        日期/时间/选项选择器
│   ├── CalendarGrid.js   可展开月历
│   ├── term.js           学期设置读写与周次计算
│   ├── store.js          Capacitor Preferences 持久化 events / pending_events
│   ├── calendar.js       原生 CalendarIntent 插件调用 + 网页端 .ics 生成
│   ├── platform.js       只有一个 isNative()
│   └── config.js         EVENT_CATEGORIES、API_PROVIDERS（学期常量已移到 term.js）
├── android/
│   ├── app/build.gradle  ★ 版本号 + 正式签名（缺 keystore 直接构建失败）
│   ├── release.keystore  ★ 正式签名密钥库（gitignored，勿删勿提交）
│   ├── keystore.properties ★ 签名口令（gitignored，勿删勿提交）
│   └── app/src/main/
│       ├── java/com/itp/notice/
│       │   ├── MainActivity.java          冷启动选启动页样式
│       │   ├── SystemBarsPlugin.java      状态栏/导航栏图标明暗 + 写 campus_theme 偏好
│       │   ├── CalendarIntentPlugin.java  ACTION_INSERT 拉起系统日历
│       │   └── NoticeInputPlugin.java     最近截图、读图、打开链接、保存二维码到相册
│       └── res/          values/ 与 values-night/ 各有一份启动页配色
├── material/             ★ 见下方「不要删」清单
├── docs/                 AI_LOG.md / ARCHITECTURE.md / DESIGN_NOTES.md / EXTRACTION_TESTS.md
├── scripts/              package-local.mjs / release-demo.mjs / test-*.mjs（见第 7 节）
├── local/                网页版 ZIP 的运行时（server.py、start.command 等）
└── release/              ★ 正式交付包输出目录（luojian-vX.Y.Z.apk，gitignored）
```

---

## 3. 构建与运行

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
```

### 正式交付流程（这是默认路径）

```bash
npm run cap:sync                 # = npm run build + cap sync android
cd android && ./gradlew assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../release/luojian-vX.Y.Z.apk
```

产物是 `release/luojian-vX.Y.Z.apk`。**构建前先确认 `android/keystore.properties`
和 `android/release.keystore` 都在**——`build.gradle` 在配置阶段就会检查，
缺失时抛 `GradleException` 直接失败（而且这个检查对**所有** Gradle 任务生效，
包括 `assembleDebug`，所以没有密钥连调试包也编不出来）。

### 命令一览

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（**没有** `/api/chat` 代理，完整网页体验要用本地网页版） |
| `npm run build` | 只构建前端到 `dist/` |
| `npm run cap:sync` | `build` + `cap sync android` |
| `npm run apk` | `cap:sync` + `gradlew assembleDebug`（**不是交付路径**，仅调试） |
| `npm run package:local` | 产出网页版 ZIP（仅明确要求时） |
| `npm run release:demo` | **废弃**，见下 |

### 关于 `release:demo`（已废弃）

`scripts/release-demo.mjs` 是旧的演示构建流程，会把 APK 拷成 `campus-demo-android.apk`
和 `schedule-official-v1.apk`（名字写死 `v1`），并用 `.env.production.local` 注入 Key。
**它不能作为正式签名发布流程使用**，README 也已声明。

历史上版本号命名的产物是**手动 `cp` 出来的，不是脚本生成的**。v1.13 之后就改用
`release/luojian-vX.Y.Z.apk` 了。所以根目录的 `campus-demo-android.apk`、
`schedule-official-v*.apk`、`campus-demo-local.zip` 都是**陈旧残留**，不要当最新产物。
（用户明确说过这些不用动，别自作主张清理。）

---

## 4. ★ 每次迭代的标准流程

这是本项目最重要的约定。每个版本按顺序做：

1. **实现 + 自测**（网页端要真的跑起来验证，别只看代码；见第 7 节）
2. **更新文档**（缺一不可）：
   - `docs/AI_LOG.md`：**追加一行表格**，列是
     `日期 | 环节 | AI 建议或输出 | 问题 | 人工处理`。
     这一列「人工处理」里要写清真机待验证项。
   - `docs/ARCHITECTURE.md`：接口/结构/行为有变就同步
   - `docs/DESIGN_NOTES.md`：视觉/交互决策有变就同步
3. **版本号**：`android/app/build.gradle` 的 `versionCode` / `versionName`。
   **默认迭代视为调试修正：用户没明确要求升版时，不改版本号，但每次都重新构建 APK。**
   只有用户说「这次是 vX.Y」之类的明确要求时才递增。`versionName` 改了，
   交付文件名 `release/luojian-vX.Y.Z.apk` 跟着改。
4. **构建正式 APK**：见第 3 节的正式交付流程（`assembleRelease`，不是 `assembleDebug`）
5. **拷成交付产物**：`release/luojian-vX.Y.Z.apk`
6. **校验产物**（别省）：
   ```bash
   BT=/opt/homebrew/share/android-commandlinetools/build-tools/36.0.0
   "$BT/aapt2" dump badging release/luojian-vX.Y.Z.apk | head -1   # versionCode / versionName
   "$BT/apksigner" verify --print-certs release/luojian-vX.Y.Z.apk  # 应为 CN=Luojian, O=ITP
   ```
   顺便建议确认包内 JS 与 `dist/` 一致（`unzip -p ... assets/public/assets/index-*.js | md5`
   对比），这是第 6.6 节那个坑的兜底。
7. **git 提交**：**单行英文祈使句，不写 body**，版本号变更和功能放**同一个提交**。
   直接看 `git log --oneline` 的历史风格照做即可。
8. **不推送**。这是用户的个人仓库（`git@github.com:sbearbug/itp_project.git`），
   用户明确说过「提交 git 就够了」。**除非用户明确要求，不要 push。**

### 提交时机

**用户没说可以提交之前，不要 `git commit`。** 本项目的工作方式是：
AI 改完先放着，用户看过之后再明确指示提交。这是用户的硬性要求。

---

## 5. ★ 不要删的东西

| 路径 | 为什么 |
|---|---|
| `android/release.keystore` + `android/keystore.properties` | **正式签名密钥**。丢了就再也无法对已发布的 `com.itp.notice` 覆盖安装，只能换包名重来。两者都已被 `.gitignore` 覆盖，**不要提交、不要打印内容、不要「清理」**。用户需要自行加密备份 |
| `src/main.js` 里的 `import emptyCalendarSvg from '../material/empty-calendar.svg?raw'` | **构建依赖**（注意是 `?raw`，不是 `?url`；旧文档写的 `?url` 已过时）。删掉 `material/empty-calendar.svg` 会让 `npm run build` 直接失败 |
| `DEEPSEEK.md`（本文件） | 在用的交接文档，不是残留 |
| `docs/` 下的四份文档 | 迭代流程的一部分，只增不删 |
| `local/` 目录 | 网页版 ZIP 的运行时文件 |
| `release/` 目录 | 正式交付包输出位置（gitignored） |

`material/` 下的 `intro.js` / `intro.css` / `intro-snippet.html` / `android-icon-res.zip`
是**用户提供的原始素材**，现在已不再与 `src/` 逐字节一致（见第 8 节），
但作为出处保留，别删。

---

## 6. ★ 已经踩过的坑

### 6.1 图标：`drawable-v24/` 会遮蔽新资源

自适应图标的前景层是 `res/drawable/ic_launcher_foreground.xml`。
**若同时存在 `res/drawable-v24/` 下的同名文件，后者优先级更高**，而本项目 minSdk=24，
即所有设备都会命中 `-v24` 限定符。

所以换图标时**必须同时删掉 `drawable-v24/ic_launcher_foreground.xml`**，
否则新前景层在全部设备上都不会生效 —— 表现为「改了但没变化」，极难排查。

> 当前仓库里 `drawable-v24/` 已经不存在（v1.9 清理过）。这条留作再动图标时的提醒。

### 6.2 Gradle 增量资源合并会错乱

**同名文件跨限定符目录移动**（例如把 `drawable-v24/ic_launcher_foreground.xml`
换成 `drawable/ic_launcher_foreground.xml`）会让增量资源合并误判，构建报：

```
error: resource drawable/ic_launcher_foreground not found
```

文件明明存在。**解决：`cd android && ./gradlew clean`，然后重新构建。**

### 6.3 CSS 过渡与 WAAPI 抢同一批属性

v1.8 把手势/转场改成 JS 驱动（内联样式 + WAAPI `fill: 'forwards'`）后，
若元素上还留着针对同一属性的 CSS `transition`，会出现**动画播两遍**：
动画结束时 `getAnimations().forEach(a => a.cancel())` 撤掉 fill → 元素瞬间弹回
陈旧的内联值 → 紧接着写入终点值 → 被残留的 CSS 过渡捕捉，再播一次。

**规则：一个属性只能由一套系统拥有。** 已被 JS 接管位移/透明度的元素，
CSS 里必须 `transition: none`（`.settings-drawer`、`.settings-scrim` 已如此处理；
`.page` 从一开始就没有 transition，是正确的）。
`.event-card` / `.event-card-actions` 目前两者共存但落点值恰好重合，尚未暴露问题，
改动卡片手势时要留意。

### 6.4 正式签名（**旧版本这一节写的是反的，别信旧文档**）

v1.12 之前的文档说「APK 全是 debug 签名、项目里没有任何 keystore、不要主动去修」。
**从 v2.0.0 起完全相反**：

- `build.gradle` 有 `signingConfigs.release`，`buildTypes.release` 使用它。
- 配置或密钥缺失时**构建直接失败**（`GradleException`），不会回退到调试签名。
- 这个检查在 **configuration 阶段**执行，对 `assembleDebug` 同样生效。
- `minifyEnabled false`，release 不做混淆。
- 签名证书 `CN=Luojian, O=ITP`，SHA-256 `ef73a49ded4f72ff5f1380246b19111cc840d596dbb4ff928e7447d4cdf062dd`。
  **后续正式更新必须沿用同一密钥并递增 `versionCode`**，不能重新生成签名。
- 见到这个证书指纹对不上，说明签名密钥被换过 —— 那是严重问题，先问用户。

### 6.5 `.env` 文件与 Key

- `.env.local` → `VITE_DEEPSEEK_API_KEY`（有真实值）
- `.env.production.local` → `VITE_GLM_API_KEY`（有真实值）

两者都被 `.gitignore` 覆盖，**不要提交、不要打印内容**。
注意 `src/config.js` 的 `ACTIVE_API_PROVIDER` 是 **`glm`**，
所以**默认走的是 `.env.production.local` 里的 GLM Key**；README 里「在 `.env.local`
填 `VITE_GLM_API_KEY`」的说法与实际文件不符，以实际文件为准。
`package-local.mjs` 会把 GLM Key 写进网页包的 `config.json`（供回环代理读取），
这是有意为之；网页 JS 和备用 Key 必须保持为空。

### 6.6 改了源码却忘了重新打包

**2026-10-02 实际发生过**：Codex 改完 `src/extract.js`、`npm run build` 也跑了、
`dist/` 是新的，但**没跑 Gradle**，交付包 `release/luojian-v2.0.0.apk` 比源码旧了两轮。

排查方法就是比对时间戳：`src/` → `dist/` → `app-release.apk` → `release/*.apk`
应当是**单调递增**的。任何一环落后，就说明漏了那一步。
第 4 节第 6 步的包内 JS 比对是这类问题的兜底检查。

### 6.7 `will-change: transform` 会为 fixed 后代创建包含块

`.page` 带 `will-change: transform`，按规范它会成为 `position: fixed` 后代的包含块。
所以 **`.fab`、`.bulk-toolbar`、`#toast-root` 这些 fixed 浮层必须渲染在
`<main class="page">` 之外**（作为 `#app` 的直接子元素）。
放回里面的话，列表一长加号就会落到文档底部，表现为「加号神秘消失」——
而且因为「向下滚动即隐藏」的逻辑恰好也在那一刻生效，看起来像凭空不见了。
`#app` 只有 `position: relative`，不会创建包含块。

### 6.8 改自定义属性不会触发 CSS 过渡

想让一个元素的位置跟着某个 CSS 变量动，
`transform: translateX(calc(var(--index) * ...))` 这种写法**不会**有过渡动画：
浏览器不把 `var()` 代入结果的变化当作可过渡变化，元素会瞬移。
必须把 `transform` **直接写在行内样式**上（模式滑块 `.appearance-mode__thumb` 就是这么做的）。

### 6.9 `.theme-transition *` 会清掉所有过渡

```css
.theme-transition, .theme-transition * { transition: <只剩颜色属性> !important; }
```

主题切换时会给 `documentElement` 加 `.theme-transition` 220ms，这条规则把
**整个 `transition` 简写**换成了只剩颜色属性，于是任何依赖位移/缩放的过渡
（比如模式滑块）都会在这一瞬间被清掉而瞬移。需要保留位移过渡的元素，
要用更高特异度单独把 `transition` 还原回来。

### 6.10 弹层结构重构后类名变了

v2.0.0 把设置弹层从手写的 `.settings-drawer` + `body.settings-open` 换成了
`overlays.js` 的 `BottomSheet` 抽象。注意 `main.js` 里 `settingsRoot = sheet.overlay`
之后才给它加了 `id`，所以 **`#settings-root` 本身就是遮罩 `.ui-overlay`**，不是它的父级：

```
body
 └ #settings-root.ui-overlay.ui-overlay--sheet      ← 遮罩层；点它（event.target 是它）可关闭
     └ section.ui-modal.ui-sheet                    ← 面板本身
         ├ .ui-sheet__handle                        ← 向下拖动关闭
         └ .ui-modal__content > .settings-view      ← 菜单 / 外观 / 识别接口 … 在这里切换
```

写测试或写选择器时**别再找 `.settings-drawer` / `settings-open`**，它们已经不存在了。
判断弹层是否打开，用 `.ui-sheet` 是否存在 + 它在视口内，而不是看 `body` 的 class。

---

## 7. 怎么验证网页端（推荐做法）

这台机器**没有连接安卓真机**，但网页端可以验证得相当扎实。

### 项目自带测试（先跑这个，快）

```bash
node scripts/test-actions.mjs            # 二维码、链接归一化
node scripts/test-editor-exit.mjs        # 编辑页退出确认
node scripts/test-extraction-empty.mjs   # 空/占位结果过滤、提示词断言
node scripts/test-intro.mjs              # 启动动画频率
node scripts/test-notice-inputs.mjs      # 分享/剪贴板入口
node scripts/test-recognition-panel.mjs  # 识别面板局部更新
node scripts/test-recognition-stages.mjs # 识别阶段状态机
```

这些都是 Node 单元测试，用 `vm` 加载 `src/*.js` 的片段，**离线可跑**，成功时打印
`通过：…`。`scripts/test-extraction-live.mjs` 是唯一会发真实 API 请求的，
用法见 `docs/EXTRACTION_TESTS.md`，**不要改成并发压力测试**。

### 需要真实浏览器的验证：Playwright 缓存的 Chromium 走 CDP

```bash
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
```

- 起静态服务器：`cd dist && python3 -m http.server 8931`（**必须用后台任务**，
  前台 `&` 会让 shell 挂住）
- Node 22+ **内置了 WebSocket**，可以直接写 CDP 客户端，不需要装任何依赖
- 启动 Chrome：`--headless --disable-gpu --no-sandbox --user-data-dir=/tmp/prof --remote-debugging-port=9222`
- **必须在 `init()` 里调用 `Emulation.setFocusEmulationEnabled({enabled:true})`**。
  否则无头 Chrome 认为页面未聚焦，合成键盘事件后会**停止产帧**，
  导致 `requestAnimationFrame` 不回调、CSS 过渡停在中途 —— 会让你误判成
  「设置弹层打不开」「动画没播」，浪费大量时间。这个坑排查过一次，很隐蔽。
- 用 `Input.dispatchMouseEvent` 发**真实鼠标事件**（合成 `.click()` 触发不了
  pointer 手势链路，会漏掉 bug）
- **不要用 `--virtual-time-budget` + `--dump-dom`**，页面有未决请求时会卡死
- 采样动画要逐帧记录（rAF 循环），只看起止两点会漏掉「其实是瞬移」
- 长任务别一条命令跑完所有套件：输出会长时间静默，用户会以为你卡死。
  分批跑并汇报进度

**注意**：`localStorage` 里造测试数据时，Capacitor Preferences 在 web 端的键名
带前缀，是 `CapacitorStorage.events`。同理主题要同时写
`CapacitorStorage.appearance_theme` / `appearance_mode`（**Preferences 会盖过
`campus-theme-name` 首帧缓存**，只写后者会导致测试间主题互相污染）。

---

## 8. 红线

- **不要改动 Event 数据结构**，也不要改模块间的公开接口。
- **不要新增依赖**，除非用户明确要求。
- 涉及**业务逻辑**的改动要先问；视觉/交互打磨类可以直接做。
- **`src/intro.js` / `src/intro.css` 的动画逻辑与参数最初由用户提供**，
  本意是原样接入。但 Codex 在 v2.0.0 期间**已经扩展过它**（加入了
  「关闭/每天一次/保持开启」的播放频率设置，见 `docs/ARCHITECTURE.md`），
  所以：
  - 仍然**不要改动画本身的几何、时长、缓动参数**；
  - 频率设置等外围功能可以动，但要同步文档；
  - `material/intro.*` 现在是**历史出处**，已与 `src/intro.*` 不再逐字节一致，
    不要以「恢复原始文件」为由覆盖 `src/`。
- 项目对 `prefers-reduced-motion` 的处理是**逐处决定的**，不是全局开关。
  加新动效时要么接入它，要么在 `DESIGN_NOTES.md` 里写明为什么有意不接。

---

## 9. 当前交接点（2026-10-02，v2.0.0）

HEAD 是 `f0da7f3`（*Fix recognition feedback flicker and add startup animation settings*），
它之后的提交链是 `7571a8d`（v2.0.0 大改版 + 正式签名）← `7b33016`（v1.14）
← `4cb06f9`（v1.13）← `6979cbb`（v1.12，DeepSeek 那轮）。

**工作区不干净**，有一批**未提交**的改动，内容是最后一轮提示词强化：

```
 M README.md
 M docs/AI_LOG.md
 M docs/ARCHITECTURE.md
 M scripts/test-recognition-stages.mjs
 M src/extract.js          ← 主要改动：提示词重写 + hasActivityTitle() 过滤
 M src/main.js             ← 纯删除 87 行：手写 setupSettingsGesture 被 BottomSheet 取代
?? docs/EXTRACTION_TESTS.md
?? scripts/test-extraction-empty.mjs
?? scripts/test-extraction-live.mjs
```

这批改动**已经验证过是完整、自洽的**：7 个离线测试全绿、`npm run build` 可复现
现有 `dist/` 的哈希、无悬空引用、启动冒烟测试通过、无控制台错误。
`docs/EXTRACTION_TESTS.md` 记录了提示词实测（34 个样例，28 个 HTTP 200、6 个限流），
也诚实说明了**提示词并不能稳定保证模型遵守输出协议**，仍有单对象/非法引号的情况。

### 本轮已经补做的事

- `release/luojian-v2.0.0.apk` 之前落后源码两轮（见 6.6），**已经重新构建并覆盖**：
  `versionCode 2 / versionName 2.0.0`，正式签名指纹与旧包一致，包内 JS 与 `dist/` md5 一致。

### 遗留事项

1. **未提交的改动还没有 git commit**（等用户明确指示）。
2. `docs/ARCHITECTURE.md` 的「启动动画」一节仍写着 intro「接入时不得修改」，
   与实际不符（见第 8 节）。用户说过「其他不用动」，所以**没改**。
3. 根目录堆积了 15 个旧包名的 `schedule-official-v*.apk`（v1.1–v1.20）和
   `campus-demo-android*.apk`、`campus-demo-local.zip`，都是旧包名时代的残留。
   用户明确说过不用动。
4. `campus-demo-local.zip` 停在 9/30，网页版产物过期；只有用户要求时才重新打包。
5. 远端 `origin/main` 仍停在很早的位置，本地领先，**按约定不推送**。

### 真机待验证项（没有设备，只能留给用户）

- **识别质量**：带引号/多活动海报、时间地点待通知的通知、空图/闲聊、
  全天跨日活动、报名与问卷链接；限流（code 1305）后稍后手动重试。
  详见 `docs/EXTRACTION_TESTS.md`。
- 系统状态栏图标明暗（四套主题 × 深浅，含 Android 15+ 走
  `SystemBarsPlugin.setAppearanceLightStatusBars()` 的兜底路径）。
- 系统日历取消后按钮是否立刻恢复（从日历返回的检测同时监听 `pause`/`resume`
  与 `appStateChange`，并留了 800ms 宽限期）。
- 新的分享入口（SEND / SEND_MULTIPLE intent）、剪贴板与最近截图权限在
  国产 ROM 上的表现；`READ_MEDIA_IMAGES` / `READ_MEDIA_VISUAL_USER_SELECTED`
  的授权流程。
- 二维码扫描与保存到相册（`NoticeInputPlugin.saveQrImage`）在真机相册里的结果。
- 启动页图标与 `intro` 首帧的位置尺寸对齐、Splash 换色是否闪。
- 长列表滚动时加号显隐、`release` 包的启动速度与 60Hz/120Hz 手感。

---

*再次提醒：非 DeepSeek 家族模型请忽略本文件，并且不要删除它。*
