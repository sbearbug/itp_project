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

本项目此前由 **Codex** 长期主力开发，2026-10-02 因额度耗尽停机；随后由
**Claude Code 临时接手**完成了一个迭代（v1.9）。现在移交给 **DeepSeek** 接手。

本文档记录的是**代码和 git 历史里看不出来的东西**：上手流程、踩过的坑、
以及本项目特有的迭代惯例。读完它再动手，能省掉大量重复试错。

**最后更新：2026-10-02，对应版本 v1.9。**

> 注：本文档无法引用「包含它自己的那个提交」的哈希（每次 amend 都会变），
> 所以下面用提交信息而不是哈希来指代 v1.9 的提交。

---

## 1. 项目是什么

`campus-demo` —— 落笺 Demo。从**校园通知截图或粘贴的文字**里提取活动信息，
人工确认后加入系统日历。

- **主产物是 Android APK**；本地网页 ZIP 只用于没有安卓设备的组员辅助体验。
- 面向的是课程/小组演示场景，不是生产产品。
- 界面语言、文档、注释均为中文。

### 技术栈

| 项 | 值 |
|---|---|
| 框架 | Capacitor 8 + 原生 HTML/CSS/JS（**无前端框架**，不用 React/Vue） |
| 构建 | Vite 7 |
| 包名 | `com.itp.notice` |
| SDK | minSdk 24 / target & compile 36 |
| JDK | 21 |
| Node | 要求 22+（当前机器是 v26） |

---

## 2. 目录与模块构成

```
campus-demo/
├── index.html            首帧主题脚本 + intro 动画结构 + #app 挂载点
├── capacitor.config.json appId / webDir=dist / SplashScreen.launchAutoHide=false
├── vite.config.js        仅 { base: './' }
├── src/
│   ├── main.js           ~2100 行。全部 UI：哈希路由、状态、手势、WAAPI 转场、渲染、弹窗、toast
│   ├── style.css         主题令牌（4 主题 × 明暗）+ Material 层 + 动效令牌
│   ├── theme.js          主题解析/迁移/持久化，状态栏与 SystemBars 同步
│   ├── intro.js/.css     启动动画模块（用户提供，见下方红线）
│   ├── extract.js        调 LLM 做图片/文字识别，Event 归一化
│   ├── store.js          Capacitor Preferences 持久化 events / pending_events
│   ├── calendar.js       原生 CalendarIntent 插件调用 + 网页端 .ics 生成
│   ├── platform.js       只有一个 isNative()
│   └── config.js         TERM_CONFIG（学期起止）、EVENT_CATEGORIES、API_PROVIDERS
├── android/
│   ├── app/build.gradle  ★ 版本号在这里（versionCode / versionName）
│   └── app/src/main/
│       ├── java/com/itp/notice/
│       │   ├── MainActivity.java        冷启动选启动页样式
│       │   ├── SystemBarsPlugin.java    导航栏配色 + 写 campus_theme 偏好
│       │   └── CalendarIntentPlugin.java  ACTION_INSERT 拉起系统日历
│       └── res/          values/ 与 values-night/ 各有一份启动页配色
├── material/             ★ 见下方「不要删」清单
├── docs/                 AI_LOG.md / ARCHITECTURE.md / DESIGN_NOTES.md
├── scripts/              release-demo.mjs / package-local.mjs
└── local/                网页版 ZIP 的运行时（server.py、start.command 等）
```

### 数据格式

唯一的跨模块契约是 **Event**，定义在 `docs/ARCHITECTURE.md` 第 3 节。
**改动任何模块都不要动 Event 结构** —— 这是项目里反复强调的边界。

### 主题系统

4 套主题（`mist` 烟雨 / `ice` 坚冰 / `moss` 苔绿 / `sunny` 暖阳）× 明暗两种，
外加 `appearance_mode` 三态（`system` / `light` / `dark`）。偏好同时写三处：
Capacitor Preferences、localStorage 首帧缓存（`index.html` 头部脚本）、
以及原生 SharedPreferences（`campus_theme`，供冷启动选启动页背景）。
**三处必须用同一套解析规则**，否则升级用户会看到设置页、WebView 首帧、系统启动页三者颜色不一致。

---

## 3. 构建与运行

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
```

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（**没有** `/api/chat` 代理，完整网页体验要用本地网页版） |
| `npm run build` | 只构建前端到 `dist/` |
| `npm run cap:sync` | `build` + `cap sync android` |
| `npm run apk` | `cap:sync` + `gradlew assembleDebug` |
| `npm run release:demo` | 见下方说明，**本项目实际不用它出正式包** |
| `npm run package:local` | 产出网页版 ZIP |

### 关于 `release:demo`（重要）

`scripts/release-demo.mjs` 会把 APK 拷成 `campus-demo-android.apk` 和
`schedule-official-v1.apk`（名字里写死 `v1`），然后构建网页 ZIP。
**版本号命名的产物是手动 `cp` 出来的，不是脚本生成的。**

历史上的实际情况是：v1.7 / v1.8 / v1.9 都是走 `npm run apk`（或 `cap:sync` +
`gradlew assembleDebug`），再手工 `cp` 成 `schedule-official-vX.Y.apk`。
所以 `campus-demo-android.apk`、`schedule-official-v1.apk`、`campus-demo-local.zip`
这三个**长期陈旧**（停在 9/30），不要拿它们当最新产物。

---

## 4. ★ 每次迭代的标准流程（Codex 的惯例）

这是本项目最重要的约定。每个版本按顺序做：

1. **实现 + 自测**（网页端要真的跑起来验证，别只看代码）
2. **更新文档**（三份，缺一不可）：
   - `docs/AI_LOG.md`：**追加一行表格**，列是
     `日期 | 环节 | AI 建议或输出 | 问题 | 人工处理`。
     这一列「人工处理」里要写清真机待验证项。
   - `docs/ARCHITECTURE.md`：接口/结构/行为有变就同步
   - `docs/DESIGN_NOTES.md`：视觉/交互决策有变就同步
3. **升版本号**：`android/app/build.gradle` 的 `versionCode` +1、`versionName` 改字符串
4. **构建 APK**：
   ```bash
   npm run cap:sync && cd android && ./gradlew assembleDebug
   ```
5. **拷成版本命名产物**：
   ```bash
   cp android/app/build/outputs/apk/debug/app-debug.apk schedule-official-vX.Y.apk
   ```
6. **校验产物**（Codex 每次都做，别省）：
   ```bash
   aapt2 dump badging schedule-official-vX.Y.apk | head -1
   # 确认 versionCode / versionName 正确
   ```
7. **git 提交**：**单行英文祈使句，不写 body**，版本号变更和功能放**同一个提交**。
   例如 `Unify themes across light and dark modes`、`Add direct manipulation and interruptible transitions`。
   直接看 `git log --oneline` 的历史风格照做即可。
8. **不推送**。这是用户的个人仓库（`git@github.com:sbearbug/itp_project.git`），
   从 2026-09-30 起就没推送过，用户明确说过「提交 git 就够了」。**除非用户明确要求，不要 push。**

### 提交时机

**用户没说可以提交之前，不要 `git commit`。** 本项目的工作方式是：
AI 改完先放着，用户看过之后再明确指示提交。这是用户的硬性要求。

---

## 5. ★ 不要删的东西

| 路径 | 为什么 |
|---|---|
| `src/main.js` 里的 `import emptyCalendarUrl from '../material/empty-calendar.svg?url'` | **构建依赖**。删掉 `material/empty-calendar.svg` 会让 `npm run build` 直接失败。用户清理 material 文件夹时曾误删过一次 |
| `DEEPSEEK.md`（本文件） | 在用的交接文档，不是残留 |
| `docs/` 三份文档 | 迭代流程的一部分，只增不删 |
| `local/` 目录 | 网页版 ZIP 的运行时文件 |

`material/` 下另外几个 SVG（`IINA.svg`、`icon-background.svg`、`icon-full.svg`）
是无代码引用的素材，删掉无妨。

---

## 6. ★ 已经踩过的坑

### 6.1 图标：`drawable-v24/` 会遮蔽新资源

自适应图标的前景层是 `res/drawable/ic_launcher_foreground.xml`。
**但 `res/drawable-v24/` 下的同名文件优先级更高**，而本项目 minSdk=24，
即所有设备都会命中 `-v24` 限定符。

所以换图标时**必须同时删掉 `drawable-v24/ic_launcher_foreground.xml`**，
否则新前景层在全部设备上都不会生效 —— 表现为「改了但没变化」，极难排查。

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

### 6.4 APK 全是 debug 签名

`android/app/build.gradle` **没有 `signingConfigs` 块，项目里也没有任何 keystore**。
所有 `schedule-official-v*.apk` 都是 debug 签名（`CN=Android Debug`）。

后果：同一台机器上覆盖安装正常（debug keystore 在 `~/.android/debug.keystore`），
换机器构建的包无法覆盖安装，也不能上架。用户已知情并选择暂不处理，
**不要主动去「修复」它**。

### 6.5 `.env` 文件与 Key

- `.env.local` → `VITE_DEEPSEEK_API_KEY`（有真实值）
- `.env.production.local` → `VITE_GLM_API_KEY`（有真实值）

两者都被 `.gitignore` 覆盖，**不要提交、不要打印内容**。
`package-local.mjs` 会把 GLM Key 写进网页包的 `config.json`（供回环代理读取），
这是有意为之；网页 JS 和备用 Key 必须保持为空。

---

## 7. 怎么验证网页端（推荐做法）

这台机器**没有连接安卓真机**，但网页端的验证可以做得相当扎实。
已经验证过可用的方法：用 Playwright 缓存的 Chromium 走 CDP。

```bash
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
```

- 起静态服务器：`cd dist && python3 -m http.server 8931`（**必须用后台任务**，
  前台 `&` 会让 shell 挂住）
- Node 22+ **内置了 WebSocket**，可以直接写 CDP 客户端，不需要装任何依赖
- 启动 Chrome：`--headless --disable-gpu --no-sandbox --user-data-dir=/tmp/prof --remote-debugging-port=9222`
- 用 `Input.dispatchMouseEvent` 发**真实鼠标事件**（合成 `.click()` 触发不了
  pointer 手势链路，会漏掉 bug）
- **不要用 `--virtual-time-budget` + `--dump-dom`**，页面有未决请求时会卡死

这套办法成功复现并验证了 6.3 里的「动画播两遍」，也验证过启动动画
（`#intro` 是否 `is-done`、`#app` 是否已移除 `app-root--intro-pending`）。

**注意**：`localStorage` 里造测试数据时，Capacitor Preferences 在 web 端的键名
带前缀，是 `CapacitorStorage.events`。

---

## 8. 红线

- **不要修改 `src/intro.js` / `src/intro.css` 里的动画逻辑和参数**。这是用户提供的模块，
  要求原样接入（当前 `src/intro.*` 与 `material/intro.*` 逐字节一致）。
- **不要改动 Event 数据结构**，也不要改模块间的公开接口。
- **不要新增依赖**，除非用户明确要求。
- 涉及**业务逻辑**的改动要先问；视觉/交互打磨类可以直接做。
- 项目有 `prefers-reduced-motion` 的处理，但注意：v1.8 之后新增的手势/WAAPI 动效
  **没有**接入 reduced-motion（这是当初有意决定的，DESIGN_NOTES 有记录）。

---

## 9. 当前交接点（2026-10-02）

v1.9 的改动已提交（提交信息为
`Adopt the provided launch animation and app icons, and fix the settings sheet opening twice`），
工作区干净。用 `git log -1` 可看到它。它之前的提交链是：
`5a8d13b`（v1.8）← `725e1eb`（v1.7）← `27f7f0b`（Apple 打磨合并）。

v1.9 这一轮做了：

1. **图标资源替换**：新自适应图标（含 monochrome 层），删掉旧前景 PNG 与
   `drawable-v24/ic_launcher_foreground.xml`
2. **启动动画换新**：删除原有的「日」字方块 + 「活动」文字启动动画，
   接入用户提供的 `intro.js` / `intro.css` / `intro-snippet.html`
3. **原生启动页简化**：背景改为浅色 `#F4F4F6` / 深色 `#1D242E`，
   由 `values/` 与 `values-night/` 提供系统深浅默认值，
   `MainActivity` 在用户有明确浅/深偏好时覆盖
4. **修复了一个 v1.8 遗留 bug**：点右上角三个点，设置弹层会弹出两次（见 6.3）

`schedule-official-v1.9.apk`（`versionCode 13 / versionName 1.9`）已构建并校验。
`docs/AI_LOG.md`、`docs/ARCHITECTURE.md` 均已按第 4 节流程同步。

**遗留事项**：`campus-demo-local.zip` 停在 9/30，网页版产物严重过期，
如果组员要用需要重新 `npm run package:local`。远端 `origin/main` 仍停在 9/30 的
`96bc4d7`，本地领先 12 个提交，按约定不推送。

### 真机待验证项（没有设备，只能留给用户）

- 系统启动页图标与 `intro` 动画首帧的**位置与尺寸是否对得上**
  （`intro.css` 里的 `--intro-icon-size: 160px`、`--intro-icon-radius: 36px` 可能需按真机微调）
- 系统 Splash → intro 的换色过渡（150ms）是否闪色
- v1.8 手势的慢拖/快划阈值、动画中重新按住、Android 返回键在转场中连续触发
- 六套主题在真机上的状态栏/导航栏衔接与冷启动无闪色

---

*再次提醒：非 DeepSeek 家族模型请忽略本文件，并且不要删除它。*
