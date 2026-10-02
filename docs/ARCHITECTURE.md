# 校园信息行动助手 · 最简 Demo 架构

## 0. 目标与边界

- **目标**：用最小成本跑通"截图 → 识别 → 确认 → 写入系统日历"，并与手机厂商自带功能（荣耀 YOYO 等）做同题对比。
- **不是正式产品**：只装在组内手机上测试，不对外分发。
- **不做**：用户账号、服务器、数据库、推送服务、iOS、微信分享入口。
- **平台**：Android App 是主要产物；另提供仅监听本机的本地网页辅助体验包。

## 1. 技术栈

| 部分 | 选择 |
|---|---|
| 前端 | 原生 HTML / CSS / JS，用 Vite vanilla 模板打包 |
| 封装 | Capacitor → Android APK |
| 识别 | 默认调用智谱 OpenAI 兼容接口（`https://open.bigmodel.cn/api/paas/v4/chat/completions`，模型 `glm-4.6v-flash`）；配置中保留 DeepSeek 备用项 |
| 存储 | `@capacitor/preferences`，活动列表存为一个 JSON 字符串 |
| 写日历 | 自写一个极小的 Capacitor 原生插件，调起系统日历"新建日程"界面 |
| 选图 | `<input type="file" accept="image/*">`（Capacitor WebView 原生支持） |

初始化：

```bash
npm create vite@latest campus-demo -- --template vanilla
cd campus-demo && npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/preferences
npx cap init "落笺" com.itp.notice --web-dir dist
npx cap add android
# 之后每次改完前端：npm run build && npx cap sync android
```

## 2. 目录结构

```
campus-demo/
├── index.html
├── src/
│   ├── main.js        # 页面切换、事件绑定、渲染
│   ├── extract.js     # 调用大模型 API，返回结构化活动
│   ├── store.js       # 本地读写活动列表
│   ├── calendar.js    # 调用原生插件写入系统日历
│   ├── platform.js    # 集中判断 Capacitor 原生/网页平台
│   ├── theme.js       # 主题解析、持久化与原生系统栏同步
│   ├── config.js      # API 地址、模型名、混淆后的 key
│   └── style.css
├── local/                 # 标准库本地服务器、配置和双击启动文件
├── scripts/package-local.mjs # 构建并生成本地网页版 ZIP
├── android/app/src/main/java/com/itp/notice/
│   ├── MainActivity.java          # 注册插件
│   ├── CalendarIntentPlugin.java  # 写日历原生插件
│   └── SystemBarsPlugin.java      # 同步导航栏与冷启动主题
└── docs/
    ├── ARCHITECTURE.md  # 本文件
    └── AI_LOG.md        # AI 协作问题记录（第4题③素材）
```

## 3. 数据格式：Event

所有模块只通过这个结构交换数据。

```json
{
  "id": "uuid 字符串",
  "title": "活动名称",
  "start": "2026-10-05T19:00 或 null",
  "end": "2026-10-05T21:00 或 null",
  "allDay": "boolean，只有日期时为 true",
  "location": "地点 或 null",
  "deadline": "报名截止时间 或 null",
  "signup": "报名方式/链接/二维码说明 或 null",
  "description": "按模板生成的日历描述 或 null",
  "category": "可选；讲座 | 竞赛 | 志愿 | 社团 | 招聘 | 其他",
  "actions": [{ "type": "url", "label": "去报名", "value": "https://example.com/signup" }],
  "uncertain": ["模型不确定的字段名，如 start、location"],
  "status": "interested | registered | skipped",
  "createdAt": "ISO 时间字符串"
}
```

时间统一为本地时间 `YYYY-MM-DDTHH:mm`，不带时区。
`category` 是新增的可选展示字段；读取旧数据或收到未知值时统一按“其他”处理，
因此不会破坏已有 Event 或模块接口。
`actions` 是可选的去办入口数组，缺失时按空数组处理；每项仅含
`type: url | wechat_qr`、`label`、`value`。网址动作的 value 为 http/https 链接；
微信二维码动作优先保存本地裁剪图的 PNG/JPEG data URL，只有文字来源时也可保存
微信专属链接（无原图则无法保存图片，需用户补充）。其余已有字段和模块接口不变。

识别结果先保存到独立的 `pending_events` 待确认队列。用户确认后才进入正式
`events` 列表；中途返回时保留待确认项，并在首页标黄。

## 4. 模块接口

### extract.js

```js
/**
 * @param {string} imageDataUrl  形如 "data:image/jpeg;base64,..."
 * @param {Date}   now           当前时间，用于推算"今晚""下周三"等相对日期
 * @returns {Promise<Event[]>}   可能包含多个活动；不含 id/status/createdAt，由 main.js 补全
 * @throws {Error}               网络失败或返回无法解析时抛出，message 为中文说明
 */
export async function extractEvents(imageDataUrl, now)

/** 从粘贴的通知文字提取，返回值与图片提取完全一致 */
export async function extractEventsFromText(text, now)
```

实现要点：
- 使用 OpenAI 兼容的 `/chat/completions`，默认模型 `glm-4.6v-flash`。system 消息只放纯文本提示词，图片和文字只放在 user 消息中。GLM 请求会移除图片 Data URL 的 `data:image/...;base64,` 前缀，令 `image_url.url` 只包含纯 base64，并显式发送 `thinking: { type: "disabled" }`。DeepSeek 备用配置仍保留原 Data URL 格式。
- 系统提示词要求：只输出 JSON 数组；把当前日期和星期告诉模型，用来推算相对日期；拿不准的字段填 `null` 并写进 `uncertain`；一张图有多个活动时拆成多条。
- 每条识别结果额外输出 `category`，且只能为“讲座、竞赛、志愿、社团、招聘、其他”；
  无法判断时输出“其他”并将 `category` 加入 `uncertain`。
- 解析时容错：去掉 ```json 包裹，找到第一个 `[` 到最后一个 `]` 再 `JSON.parse`。
- 发送前把图片压缩到长边不超过 1600px，节省费用和时间。
- 文字入口复用同一套 system prompt、请求、容错解析和 Event 归一化；
  user 消息改为纯文字，不附带 `image_url`。
- HTTP 429 统一转换为“当前使用人数较多，请稍后重试”，识别错误卡片保留已选图片或文字并提供重试。

### store.js

```js
export async function loadEvents()            // → Promise<Event[]>
export async function addEvents(events)        // 追加并保存 → Promise<void>
export async function updateEvent(id, patch)   // 合并字段并保存 → Promise<void>
export async function deleteEvent(id)          // → Promise<void>
```

全部基于 `Preferences.get/set({ key: "events" })`，值为 `JSON.stringify(Event[])`。

### calendar.js

```js
/** 调起系统日历的新建日程界面，字段已预填，由用户点保存 */
export async function addToCalendar(event)     // → Promise<void>
export async function addDeadlineToCalendar(event) // → Promise<void>
```

- 通过 `registerPlugin("CalendarIntent")` 调用原生方法 `insert({ title, beginMs, endMs, location, description })`。
- `end` 为空时默认 `start + 1 小时`；`start` 为空时不允许调用，界面提示用户先补全时间。
- 全天活动的 `end` 为空时默认使用次日零点。
- “加入日历”先保存当前表单。活动参与时间和报名截止时间必须作为两个独立日程处理：
  活动日程的描述移除“报名截止”行；存在合法 `deadline` 时，用户从活动日历返回后再
  打开标题为“【报名截止】活动名”的截止日程。两步完成后状态更新为 `registered`。

### CalendarIntentPlugin.java（原生，约 30 行）

- `@CapacitorPlugin(name = "CalendarIntent")`，方法 `@PluginMethod insert(PluginCall call)`。
- 构造 `new Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)`，填入 `CalendarContract.EXTRA_EVENT_BEGIN_TIME`、`EXTRA_EVENT_END_TIME`、`Events.TITLE`、`Events.EVENT_LOCATION`、`Events.DESCRIPTION`，`startActivity` 后 `call.resolve()`。
- 在 `MainActivity.onCreate` 中、`super.onCreate` 之前 `registerPlugin(CalendarIntentPlugin.class)`。
- 不需要任何日历读写权限：保存动作由系统日历完成。

### config.js

- 保留导出 `API_BASE`、`MODEL`、`getApiKey()`；`API_PROVIDERS` 集中保存 GLM 与
  DeepSeek 的 endpoint、模型、Key、图片编码和额外请求参数。`ACTIVE_API_PROVIDER`
  默认是 `glm`，改为 `deepseek` 即可切回原接口，不删除原实现。`getApiConfig()` 每次
  请求前读取设备自定义配置，存在完整配置时优先使用，否则使用 `.env.local` 注入的
  `VITE_GLM_API_KEY`（DeepSeek 备用项使用 `VITE_DEEPSEEK_API_KEY`）。
- **混淆不等于安全**：此 key 必须是 demo 专用、低余额、设消费上限，demo 结束即作废。
- `TERM_CONFIG` 集中配置学期名称、开学月日和教学周数。当前秋学期从 9 月 14 日
  开始，共 16 周；列表页教学周只由该配置计算，不写死在界面中。

## 5. 界面与路由

### 启动动画

- 启动动画是独立模块 `src/intro.js` + `src/intro.css`，遮罩结构 `#intro` 写在
  `index.html` 的 `<body>` 最前（源自 `material/intro-snippet.html`）。
  **模块内的动画逻辑与参数由用户提供，接入时不得修改。**
- 遮罩内用 SVG 复刻桌面图标（108 画布中央 72 的可见区域），与系统启动页图标几何一致；
  `--intro-icon-size` 与 `--intro-icon-radius` 需与真机上系统启动页图标的
  实际显示尺寸和遮罩形状对齐，按实测微调。
- 主界面根元素 `#app` 初始带 `app-root--intro-pending`（`opacity: 0`），
  遮罩结束、主界面露出后由 `intro.js` 移除。
- 启动顺序：`initializeTheme()` → `getIntroMode()` → 隐藏系统启动页 →
  `Promise.all([playIntro({ mode, app, themeBg }), 数据加载])` → 渲染列表页。
  即动画与数据加载并行，两者都完成后才渲染。
- `themeBg` 取当前主题 `--bg` 的计算值；若与系统启动页背景不同，遮罩在开头 150ms 内过渡过去。
  系统启动页背景为浅色 `#F4F4F6` / 深色 `#1D242E`，与遮罩默认背景一致。
- `getIntroMode()` 用 `localStorage` 键 `intro:lastFullDate` 记录日期：
  每天首次启动返回 `full`（撕页 → 穿过 → 露出），当天再次启动返回 `quick`（仅淡入淡出）。
  点击遮罩任意位置可立即结束动画。
- `prefers-reduced-motion` 开启时退化为 200ms 淡入淡出。

### Hash 路由与页面

`main.js` 统一管理页面状态并实现以下路由：

1. `#/list`：默认列表页。
2. `#/add`：添加页，承载选图、识别和逐条确认。
3. `#/edit/:id`：编辑已保存活动。

进入添加或编辑页时页面从右侧滑入（约 380ms）；返回时当前页先向右滑出（约 340ms），
下一页再淡入（约 300ms），使用无明显弹跳的 CSS `linear()` 弹簧曲线。转场由 Web
Animations API 驱动：若用户在进入动画尚未完成时返回，会先读取页面当前可见位置，
再从该位置反向退出，不会跳回动画起点；列表页与二级页共用对称的进退路径。Android
返回键通过 `@capacitor/app` 处理：添加页和编辑页返回列表，
列表页退出 App；识别进行中返回时先确认“放弃本次识别？”。

### 设置底部弹层

- 在列表、添加或编辑页向右滑，或点击列表应用栏右侧的三点菜单，打开 Material 3 风格的
  底部设置弹层；普通活动卡片和表单外框均可起手，只有已展开快捷操作的卡片、弹窗和弹层
  自身不触发。向右滑时手指位移实时映射为弹层上移与遮罩透明度，松手后同时根据当前位置
  和最近约 90ms 的速度决定完成或回退；超出开合边界时使用阻尼，落位动画可被再次按住接管。
  弹层把手或空白表面支持逐像素向下拖动关闭，仍保留点击遮罩、抽屉内向右滑和 Android
  返回键关闭。Pointer Events 配合 `touch-action` 保留纵向滚动，设置内容重绘时不重复注册监听器。
- 设置菜单包含“外观”和“识别接口”两个入口。识别接口提供 OpenAI 兼容 API 的
  基础地址、模型名称和 API Key。保存后无需重启，
  下一次识别直接使用自定义配置；“恢复内置”清除覆盖项并回退到构建配置。
- 自定义配置使用 Capacitor Preferences 保存在当前设备。Key 仅作输入框密码遮罩，
  并非加密存储，因此仍只适合低额度 Demo Key。
- 弹层内的视图切换（菜单 ↔ 外观 / 识别接口）由 `animateSettingsView()` 驱动，目标元素是
  包裹内容的 `.settings-view`，时长与方向和页面路由保持一致：进入从右侧滑入 380ms，
  返回先向右滑出 340ms、再把新视图淡入 300ms。切换时**不能先重绘再补动画**，否则返回
  时已经没有可滑出的旧内容；`renderSettingsDrawer({ transition })` 会先对现有
  `.settings-view` 播完滑出，再重建 DOM 并播入场。模式与主题选择走就地更新
  （`applyModeSelection()` / `applyThemeSelection()`），不重绘内容、也不触发视图动画。
- 弹层先在视口底部完成渲染，再于下一次绘制后向上进入；关闭时向下滑出，进入和退出
  均使用约 250ms 的 CSS `linear()` 轻弹簧曲线，避免首次显示跳帧。已有
  `prefers-reduced-motion` 规则仍保留为淡入淡出。

### 主题层

- `style.css` 中的所有组件只引用 `--bg`、`--surface`、`--surface-2`、`--divider`、
  `--text`、`--text-2`、`--accent`、`--on-accent`、`--btn`、`--on-btn`、`--date-bg`、
  `--date-text`、`--today-bg`、`--today-text`、`--highlight`、`--on-highlight`、
  `--urgent-bg` 和 `--urgent-text` 语义变量；具体色值只出现在主题令牌定义中。
- 主题依次提供烟雨、坚冰、苔绿、暖阳、素笺、暮霞六套，每套同时包含浅色和深色版本；模式提供
  “跟随系统、浅色、深色”。当前配色始终由“所选主题 × 当前模式”共同确定，新用户
  默认跟随系统并选择烟雨。系统外观变化或用户切换模式时，仍使用同一主题的对应版本。
- `theme.js` 使用 Preferences 持久化模式和单一主题选择，同时镜像到 `localStorage`。
  旧版“青蓝”会迁移为坚冰；原先选择石墨或坚冰（深色）的用户分别迁移为烟雨或坚冰，
  并保留迁移当时生效的深色模式。
  `index.html` 的头部脚本在业务脚本和 CSS 首次绘制前同步设置 `data-theme`，避免 WebView
  先闪现默认浅色；初始化完成前原生 Splash 保持显示。
- 设置页只显示“模式”和“主题”，每个主题预览同时展示浅色和深色两个小样。主题切换
  即时生效，颜色过渡约 200ms；开启减少动态效果时取消该过渡。
  `prefers-color-scheme` 变化会在“跟随系统”模式下即时重新解析主题。
- 状态栏背景跟随**当前页面背景**：`applyTheme()` 读取 `body` 的计算背景色
  （即 `--surface`，不是 `:root` 的 `--bg`），转成十六进制后同时写入
  `meta[name="theme-color"]`、`StatusBar.setBackgroundColor` 和 `SystemBarsPlugin`。
  图标明暗由主题解析结果决定：浅色主题用深色图标，深色主题用浅色图标；切换主题或
  深浅模式时立即重新应用。
  **Capacitor 的 `Style` 命名与直觉相反**：`Style.Dark` 是“深色背景配浅色图标”，
  `Style.Light` 是“浅色背景配深色图标”，因此深色主题必须传 `Style.Dark`
  （早先传反了，深色主题下图标与背景同色而看不见）。
  Android 15+ 上 `StatusBar.setStyle` 可能不生效，自有 `SystemBarsPlugin` 会用
  `setAppearanceLightStatusBars()` 再兜一次底，与导航栏共用 `darkIcons` 极性。
  `SystemBarsPlugin` 同时同步 Android 导航栏，并把已解析主题、模式和所选主题
  镜像到原生偏好。
  MainActivity 在 `super.onCreate` 前读取 `appearance_mode`：用户明确选择了浅色或深色时，
  切到对应的固定启动页样式（`AppTheme.NoActionBarLaunch.Light` / `.Dark`，背景分别为
  `#F4F4F6` / `#1D242E`）；选择跟随系统或尚无偏好时保持 manifest 的
  `AppTheme.NoActionBarLaunch`，由 `values/` 与 `values-night/` 中的
  `@color/splash_background` 随系统深浅变化。状态栏图标明暗同理由
  `@bool/splash_light_system_bars` 在两个限定符目录下分别给出。
  因此冷启动页、状态栏、导航栏和 WebView 首帧使用同一背景色。
- 外观页的“模式”是三段式选择器，选中态由 `.appearance-mode__thumb` 这一个绝对定位的
  滑块承担，切换模式时平移过去而不是瞬移。位移必须**直接写在滑块的行内 `transform`** 上：
  只改它引用的自定义属性不会触发 CSS 过渡（浏览器不把 `var()` 代入结果的变化当作可过渡
  变化），滑块会瞬移。`.theme-transition *` 会把 `transition` 简写整体换成只剩颜色属性，
  所以该规则旁边单独为滑块还原了位移过渡，否则每次切换深浅模式滑块都会被顺带清掉。
  减少动态效果时滑块不做过渡，直接落位。

### 列表页

- 使用 Material 3 标准顶部应用栏，标题为“活动”，活动总数作为标题后的同排小号次要文字；
  右侧只保留“⋮”菜单按钮，“管理”已移入该菜单。
- 应用栏下方显示撕页台历样式的“今天”卡片：左侧是大号日期数字，右侧一行显示
  “N月 · 星期X”，不再单独重复星期标题；当前日期位于 `TERM_CONFIG` 配置的教学周期内时，
  再显示“秋学期第 N 周”，学期外隐藏该行。
- 未结束活动按开始时间升序排列，并分为“今天、明天、本周、以后”四组；空分组不显示，
  分组标题滚动时吸附在应用栏下方。已结束活动置灰并默认折叠在末尾“已结束”分组。
  归组按“活动的日期区间与今天是否重叠”判断：今天落在区间内的（含只有日期的单日活动
  在当天）归入“今天”，尚未开始的按开始日期归入“明天/本周/以后”。日期取值与比较一律
  走 `localDateKey()`（本地年月日字符串），**禁止使用 `toISOString()` 等 UTC 方法**。
  只有日期没有时间的单日活动，在当天 23:59 之后自然落入“已结束”。
- 活动卡片左侧显示台历式日期块，包含月份、等宽大号日期数字和星期，所有活动统一；
  年份只在不是今年时出现。右侧第一行是标题，第二行是一条合并信息：单日活动为
  “时间 · 地点”，跨天活动为“日期区间 · 地点”。没有地点时只留前半段；没有时间时
  （以及只有日期、没有具体时间的活动）按“时间待定”/“全天”处理；跨年区间的两端都
  带年份，避免“12月30日–1月2日”看不出跨年。
- 卡片状态行里，类型（讲座/竞赛等）是不带底色的小号次要文字；状态保留胶囊：
  已报名用 `--accent` 填充配 `--on-accent` 文字，感兴趣用 `--surface-2` 配 `--text-2`，
  不参加在同样配色上降低不透明度。跨天活动已开始但未结束时，在状态胶囊之前插入
  “进行中 · 还剩N天”；落在最后一天时改为“今天结束”，并使用 `--urgent-bg` /
  `--urgent-text`。
- 普通日期块统一使用浅强调色 `#C3E9EA` 配
  `#1E2D58` 日期文字。
  距离报名截止不足 24 小时时，日期块改为 `#FBE4E1` 配 `#9F2F28`，该暖色只用于
  紧急或破坏性状态，并显示“今天截止”或“明天截止”。
- “今天”卡片与活动日期块的日期数字使用随 App 打包的开源 Oswald Bold 字体并启用
  等宽数字，其他文字仍使用 Android 系统中文字体。字体许可证随资源一同保留。
- “加入日历”成功后，对应日期块播放一次约 400ms 的撕页反馈：上半页向下翻折淡出，
  底层显示勾号；减少动态效果开启时只做透明度切换。
- 活动卡片默认只显示日程内容。横向位移超过约 9px 且方向明确后才锁定左滑，避免和纵向
  列表滚动争抢；松手使用位置与速度投射共同决定展开或收回，快速短划也可直接展开。边界
  带阻尼，操作按钮随拖动进度逐渐显现，落位动画中再次按住可从当前可见位置继续拖动。
  向左滑动卡片后，卡片平移并露出右侧“加入日历”
  和“删除”操作；“加入日历”使用日期块配色（`--date-bg` / `--date-text`），不再使用灰色
  表面；卡片在展开态取消接缝侧圆角，操作区使用连续背景和外侧圆角，不能
  在卡片与“加入日历”之间露出底色缝隙。点击卡片或向右滑动收回，删除前二次确认。
- “⋮”菜单里的“管理活动”进入多选模式（已在多选模式时显示“完成管理”），选中任意数量的
  活动后可通过底部工具条批量删除或批量加入日历；Android 返回键优先退出多选模式。
  由于原生层使用系统日历的 `ACTION_INSERT`，批量加入时按顺序逐个打开日历页，
  用户保存并返回后继续下一条。
- 从系统日历返回的检测（`createAppReturnWaiter()`）不能只依赖 `appStateChange`：
  Capacitor 只在 Activity `onStop` 时才发 `isActive:false`，而系统日历可能以半透明
  Activity 覆盖在本应用之上，此时只有 `onPause`，`leftApp` 会一直为 false，等待永远
  不结束，按钮就卡在“打开中…”直到 5 分钟兜底超时——用户取消日历后看到的就是这个现象。
  现在同时监听会在 `onPause` 触发的 `pause` / `resume`，保留 `appStateChange` 兜底，
  并额外加 800ms 宽限期防止漏事件时彻底卡死。取消或保存成功后按钮都会恢复。
- 管理模式使用底部操作条，进入时从下向上出现，点击完成、取消或按返回键时先向下
  滑出再退出管理状态。已结束分组不使用
  原生 `<details>`，展开时容器像窗帘一样向下展开，活动卡片以 55ms 间隔依次下落排列。
- 删除、放弃、批量日历等确认操作统一使用 App 内 Dialog；点击遮罩不关闭，取消
  按钮、Esc 或 Android 返回键等同取消。
- 空列表使用随项目提供的简笔画空白台历 SVG，并显示“还没有活动，点右下角的加号，
  添加一张通知截图”。应用图标源自同一组台历撕页素材，主色 `#565C78`，不含文字；
  自适应图标由 `res/drawable/ic_launcher_foreground.xml`（前景，108 画布）、
  `@color/ic_launcher_background`（背景）和 `res/drawable/ic_launcher_monochrome.xml`
  （Android 13+ 主题图标）组成，各密度兼容 PNG 同步生成。
  前景层只保留 `drawable/` 一份：**不可存在 `drawable-v24/` 同名文件**，
  该限定符优先级更高，会遮蔽新资源（minSdk 24，所有设备都会命中）。
- 右下角悬浮加号使用 `env(safe-area-inset-bottom)` 避让手势导航区域；列表向下
  滚动时缩小隐藏，向上滚动时恢复。点击进入 `#/add`。
- **`.fab`、`.bulk-toolbar`、`#toast-root` 必须渲染在 `<main class="page">` 之外**
  （作为 `#app` 的直接子元素）。三者都是 `position: fixed`，而 `.page` 带
  `will-change: transform`，会为 fixed 后代创建包含块，使它们相对整页而不是视口定位。
  一旦放回 `.page` 内，列表稍长加号就会落到文档底部，表现为“加号消失”。
  `#app` 本身只有 `position: relative`，不会创建包含块，因此设置抽屉打开时
  `#app` 的位移仍会让这些浮层跟着一起移动（这是预期行为）。

### 可展开月历与学期设置（v1.13）

- 列表顶部台历点击后在原位置向下展开月历，以 `grid-template-rows: 0fr → 1fr` 配合
  专用缓动在约 520ms 内过渡，均匀展开后轻柔落位，不直接动画高度。收起时内容设为 `inert`，避免
  隐藏日期仍可获得键盘焦点。月份标题或上滑收起，台历摘要也可再次点击收起。
- 星期从周一开始，始终显示 6 行、42 个日期；非本月数字降低透明度。今天以 `--accent`
  圆环表示，选择日期以 `--accent`/`--on-accent` 实心状态表示。有活动的日期以圆点表示，
  区间活动覆盖每一天；紧急活动覆盖日期及其截止日期的圆点以 `--urgent-text` 优先表示。
- 箭头与日期网格内左右滑切换月份；起点距屏幕左右边缘不足 24px 时不处理手势。网格手势
  不触发全局设置右滑，也不误触日期点击。离开当前月份后显示“今天”快捷入口。
- 点选日期后月历保持展开，列表显示与所选本地日期重叠的全部已保存活动（包括历史活动），
  按开始时间排序并取消分组，显示“日期 · 清除”标签；没有结果时显示“这天没有活动”。
  清除后恢复原分组；Android 返回键先清除日期筛选，再收起月历，之后恢复原返回行为。
- 日期筛选标签距下方列表 6px，台历距筛选标签 12px。月历内部日期、切月和标题控件
  使用按钮底色反馈；仅台历摘要可缩放，缩放不会传递到整个月历或叠加在展开动画上。
- 新增 `CalendarGrid` 可复用组件：输入 `month`/`today`（本地 Date）、`selected`（本地
  `YYYY-MM-DD` 或 `{start,end}` 日期区间）、`marks`（按日期键索引的 `activity`/`urgent` 标记）
  和 `onSelect` 回调。`markup()` 生成网格，`bind(root)` 输出日期点击；不依赖 Event 或路由。
- 台历教学周标签和三点菜单共用“学期设置”底部菜单，名称与开学日期通过 Preferences 的
  `semester_settings` 独立保存，不修改 Event。未配置时采用 `TERM_CONFIG` 默认学期，
  教学周期长度仍由 `totalWeeks` 控制；按日历日期计算周次，学期外隐藏周标签。
- 列表底部至少保留 104px 加底部安全区的空间，给 56px FAB 和最后一项留足距离；
  “已结束”分组使用 `+`/`−` 表示展开与收起。

### 添加页与编辑页

- 添加页顶部为标准应用栏，左侧返回按钮、标题“添加活动”。返回按钮与 Android 返回键
  共用同一个 `handleBack()`，因此识别中会先弹“放弃本次识别？”确认，行为完全一致。
  空闲态上下显示两个入口：上方选择通知截图，下方可粘贴群消息、公众号正文或邮件文字。
  选图入口用内联 SVG 线框图片图标（不再用“＋”加描边方框）；文字区的“从文字提取”按钮
  在输入为空时置灰不可点（`--surface-2` 底 / `--text-2` 字），有内容后变为实心主按钮。
  文本域 `resize: none`，随内容自动增高，超过 8 行后改为内部滚动
  （上限由 `autoGrowTextarea()` 按行高计算）。底部说明文案见
  `selectInputPanel()`，需与实际的接口调用范围保持一致。
- 选图后在本页完成缩略图、阶段指示条、骨架屏、慢速提示、取消、超时和
  重试流程；文字入口跳过图片压缩，从“整理文字 → 上传 → 识别中 → 完成”
  阶段开始。两者均进入相同的 `pending_events` 待确认流程。
- 识别完成后在添加页逐条显示可编辑活动卡片；保存当前活动后处理下一条，全部保存
  后返回列表页，新条目淡入。
- 识别成功和从列表恢复的待确认活动均显示“放弃”按钮。放弃只移除当前待确认项，
  若队列仍有活动则继续下一条，否则返回列表页。
- 编辑页路由为 `#/edit/:id`，提供保存、加入日历和删除操作。
- 添加页与编辑页必须通过同一个 `eventFormMarkup()` 和 `bindEventForm()` 组件
  生成并绑定活动表单，不复制字段与校验代码。

新活动默认状态为 `interested`；`skipped` 由用户在编辑页手动选择。模型按以下
模板生成可编辑的日历描述：

```text
活动：{title}
时间：{start} 至 {end}
地点：{location}
报名截止：{deadline}
报名方式：{signup}
```

### 加载与过渡交互规范

- 识别状态统一由 `main.js` 管理，只允许
  `idle → compressing → uploading → recognizing → done/error` 六种状态；其他模块
  不直接切换页面 class。
- 选图后立即展示本地缩略图。顶部使用“压缩图片 → 上传 → 识别中 → 完成”四段式
  指示条，当前阶段高亮、完成阶段显示勾号，并用细线连接。上传与识别的切换由
  `XMLHttpRequest.upload.load` 事件驱动，不显示虚构百分比。
- 压缩、上传和识别阶段显示与编辑卡片字段结构相近的骨架屏。骨架高光周期约
  1.2 秒；识别状态文字每 2 秒在“正在读取文字…”“正在识别时间…”“正在整理活动信息…”
  之间切换。
- 识别请求 60 秒超时；整个流程超过 15 秒后提示“识别时间较长”并显示取消按钮。
  取消和失败时显示中文错误卡片，重试复用已选图片。
- 识别成功后骨架屏淡出并显示结果，多个活动显示识别数量；不再使用装饰性的卡片
  错峰入场动画。`uncertain` 字段采用当前主题的次级表面并标注“请核对”，不闪烁。
- 保存和加入日历期间，按钮显示 spinner 并禁用；完成后底部 toast 分别显示
  “已保存”或“已加入日历”，2 秒自动消失。
- 删除操作必须二次确认；删除动画为列表项向左滑出并收起。新增活动从列表顶部
  淡入。空列表显示说明文字和“选择截图”按钮。
- 所有动画仅使用 CSS `transform`、`opacity`、`scale` 与 `keyframes`，常规单次过渡控制在
  60–420ms（页面转场与卡片回弹偏长，状态反馈偏短）。物理反馈使用 CSS `linear()` 定义的
  直接过渡、轻弹簧和按压三种曲线，不引入动画库；已有 `prefers-reduced-motion` 规则继续
  关闭 shimmer 和大幅位移。
- 按下反馈由 `main.js` 的 `setupPressFeedback` 统一驱动，所有可点元素共用同一个
  `.is-pressed` 状态类；Pointer Events（`pointerdown` / `pointermove` / `pointerup` /
  `pointercancel` / `pointerleave`）与键盘（空格、回车，并在 `focusout` 和窗口失焦时清理）
  走同一套状态机。反馈分两套且互斥：卡片类（活动卡片、今日台历卡片、设置页主题色块）
  按下 `scale: .965`（90ms ease-out），松开用 `--motion-press-release` 弹簧曲线 420ms
  回到 1；其余可点元素用 `::after` 铺一层状态色，按下 60ms 淡入、松开 220ms 淡出，
  不缩放也不位移。状态色按元素类型从主题派生：实心按钮
  `color-mix(in srgb, var(--on-btn) 14%, transparent)`、悬浮按钮取 `--on-accent` 14%、
  表面元素（菜单项、列表项、图标按钮、次要按钮）取 `--text` 8%。列表中的活动卡片在按下
  60ms 后才进入按下态，这个窗口内移动超过 8px 或收到 `pointercancel` 就整轮放弃，避免
  滑动列表时卡片闪动。抬 pointerup 时若下压尚未达到 90ms，会先补足这段时长再回弹，
  因此无论点按多快，下压深度都固定为 `0.965`（`PRESS_DEPTH_DURATION` 必须与 CSS 中
  `.is-pressed` 的 scale 过渡时长一致）。按住后移出控件边界会取消按压态，移回边界内则恢复；
  松手或系统取消指针时统一清理。加载中的操作设置 `aria-busy` 并禁止重复触发。
- 卡片按下使用独立的 `scale` 属性而不是 `transform`：活动卡片的 `transform` 已由左滑手势
  占用（`translateX`），两者可叠加，避免同一属性被两套系统争抢。
- 不使用点击水波纹。`::after` 已被复用作状态色层，全局 `-webkit-tap-highlight-color:
  transparent` 去掉 WebView 默认高亮；`prefers-reduced-motion` 下卡片不缩放，按钮的状态色
  变化保留。
- 默认浅色烟雨主题和其他三套主题的颜色只在 `style.css` 的主题令牌中定义。组件不直接
  引用色值；强调填充、主要按钮、日期块、“今天”卡片和紧急状态均通过语义变量适配。
  界面使用系统中文字体，不使用渐变和装饰性阴影；卡片仅用细边框或极轻阴影区分层级。
- 网页首次配置 API Key 的弹窗宽度不超过视口减 32px，高度不超过动态视口；输入框
  字号固定为至少 16px，防止移动浏览器聚焦时自动放大整个页面。

### 统一弹层与选择器（v1.15）

- `overlays.js` 提供 `BottomSheet` 与 `Dialog` 两个基础组件；设置、学期设置、日期、
  时间和选项列表使用前者，确认、提示与网页 API 配置使用后者，不再各自实现弹层。
- BottomSheet 顶部把手支持跟手下拉：位移超过自身高度 30%，或最近 90ms 的向下
  速度超过 0.5px/ms 时关闭，否则弹回；点击遮罩关闭。Dialog 遮罩不关闭。
  Android 返回键与 Esc 只取消最上层，不影响下层菜单、当前筛选或页面。
- 弹层统一由栈管理背景滚动锁定、背景 `inert`、焦点移入、Tab 循环与关闭后焦点恢复。
  嵌套日期选择器关闭后返回学期设置，最后一层关闭后恢复原滚动位置。
- 圆角、内边距、标题字号、按钮高度、间距与圆角通过 `--modal-*` 变量统一。
  次要操作在左、主要操作在右；危险确认采用 `--urgent-text` 实心底色。
  底部表面通过语义变量派生半透明表面并使用 16px 模糊，居中 Dialog 保持实心。
  进出场使用现有弹簧曲线 340ms，减少动态效果时立即切换。
- `pickers.js` 的日期选择器复用 `CalendarGrid`，支持单日与区间。区间第一次选起点、
  第二次选终点，逆序自动交换；端点实心圆、中间浅色条带连接。提供今天、明天、
  本周六快捷入口，取消不写回、确定才写回。
- 时间选择器采用两列 CSS scroll-snap 滚轮，小时 00–23、分钟 00–59，中心横带与
  边缘渐隐。优先使用 scrollend，防抖兜底；确认时读取最终滚动位置，点击行可直达。
  “时间待定”保留日期并清除时间，不恢复旧时间。未选择日期时先选择日期。
- 活动类型、状态使用选项 BottomSheet，当前项显示勾号，点击后立即写回并关闭。
  开始、结束、报名截止与开学日期均不再使用原生日期/时间输入框；表单关闭浏览器
  原生校验提示，继续使用现有应用内校验和中文错误提示。
- Event 字段及存储接口不变，原生图片选择、系统日历新建页、键盘和分享面板保留。
  所有颜色使用既有语义变量，覆盖六个主题的浅色与深色版本，不新增依赖。

### 添加来源与批量识别（v1.17）

- 系统分享：主 Activity 接收 SEND 的 image/*、text/plain，以及 SEND_MULTIPLE 的
  image/*。自建 NoticeInput 插件在 load 处理冷启动、handleOnNewIntent 处理后台唤起，
  将 sharedNotice 事件保留至 WebView 监听就绪。按事件 ID 去重，前端串行接收分享，
  自动打开添加页并识别；显式发起系统分享视为用户选择识别该内容。
- 剪贴板：使用官方 @capacitor/clipboard，仅在原生前台恢复或首次进入添加页读取；
  超过 15 个字符且匹配日期、时间或地点特征时显示“识别 / 忽略”提示，不自动上传。
  忽略内容的 SHA-256 摘要存入 Preferences，不持久保存剪贴板原文；同内容不再提示。
- 最近截图：自建 NoticeInput 插件使用 MediaStore 的 BUCKET_DISPLAY_NAME 匹配
  Screenshots（忽略大小写）、截屏、截图，不写死目录路径。查询最近五分钟的截图，
  按拍摄时间（缺失时使用入库时间）降序最多显示 8 张，缩略图在工作线程本地生成。
  点击后才加载该 URI 的识别图，降采样后通过现有 compressImage / extractEvents 流程。
- 首次进入添加页按版本申请 READ_MEDIA_IMAGES（Android 13+）或
  READ_EXTERNAL_STORAGE（Android 12 及以下）；Android 14+ 同时处理部分照片授权。
  拒绝后隐藏区域并记住已询问状态，不再自动弹权限框；系统设置重新授权后自动恢复。
  部分授权只查询有权访问的图片，无截图时隐藏区域，不影响普通系统选图与分享。
- 选图支持 multiple，分享的多图与普通多选共用顺序队列。显示“第 N / M 张”，
  结果合并到已有 pending_events，全部处理后继续逐条保存或放弃。失败项单独保留
  重试入口；取消停止队列并保留成功草稿，晚到结果不进入新的识别队列。
- 添加页固定补充隐私说明：“读取剪贴板和截图仅在你点击识别后发送至智谱 AI。”
  网页版保持原有选图与文字入口并支持多选；原生专属入口在网页安全跳过。
- Event 数据格式、extractEvents 与存储模块接口不变；新增依赖仅官方 Clipboard，
  不使用第三方分享插件。

### 去办入口与本地二维码（v1.18）

- 识别提示词要求提取通知上明确写出的报名、问卷和详情链接及简短按钮文字。
  输入文字、剪贴板、分享文字共用 http/https 正则兜底；按规范化链接去重。
  同张通知有多个活动时，兜底入口附到各待确认项，表单提示用户核对归属。
- 图片先以原图在本地 jsQR Worker 解码；整图未命中时使用重叠分块再试。
  命中后从原图裁剪二维码及周围留白，已定位的二维码区域在上传识别图中遮除。
  解码值与裁剪图不加入 AI 请求，处理超时停止 Worker，不影响普通识别。
  未定位的二维码仍可能存在于通知图中，但不交给模型解码。
- 普通 http/https 二维码产生“去报名”入口，与模型链接合并去重；微信专属协议或
  域名产生“微信二维码”入口。jsQR 只支持标准二维码，不支持微信专用小程序码；
  表单提供“添加微信二维码”及原图手动圈选，保存裁剪图，不进行云端解码。
- 正式活动卡片最多显示一个去办按钮，其他入口在共用编辑表单中显示；待确认项
  也使用该表单，可添加、修改、删除链接，随现有保存流程持久化。
  按钮点击不触发卡片导航或侧滑；管理模式不显示去办按钮。
- url 在 Android 使用 ACTION_VIEW 交给系统；只允许 http/https，拒绝含登录凭据的
  URL 与其他协议。微信入口使用统一 Dialog：“该二维码需在微信中扫描”，提供
  “关闭 / 保存图片”。MediaStore 写入 Pictures/CampusAction；Android 9 及以下
  仅保存时申请写入权限，新版本无需额外写权限。网页下载图片作为安全降级。
- 本轮唯一新增依赖为 jsQR，Event 仅新增可选 actions 字段，不调整原有接口。

### 去办布局与编辑退出保护（v1.19）

- 列表去办按钮置于卡片底部，相对整卡居中，高度 34px，宽度 65% 且最大 260px；
  链接/二维码添加工具采用同一行网格，文字水平、垂直居中，二维码按钮触发原生选图。
- 正式编辑表单记录规范化保存快照，包含 actions 与原有表单字段；切换全天只更新
  当前草稿，不提前落库。内容恢复原值且没有其他变化时，不弹退出提示。
- 所有路由退出统一检测修改：页面返回、Android 返回键、浏览器 hash 返回均提供
  “继续编辑 / 不保存 / 保存”。返回键关闭 Dialog 相当于继续编辑；保存成功才退出，
  校验或保存失败保留表单。主动保存/加入日历保存后更新快照，删除不重复询问保存。
  既有待确认队列与识别流程不变，不新增 Event 字段或依赖。

## 6. 本地网页版

本地网页版与 Android App 共用 `main.js`、`extract.js`、`store.js`、
`calendar.js` 和全部 UI，不复制业务代码。`platform.js` 只对外导出
`isNative()`，内部使用 `Capacitor.isNativePlatform()` 作为统一的平台分流点。
`Event` 数据格式和第 4 节的模块公开接口保持不变。

### 网页运行时

- `@capacitor/preferences` 在网页平台使用其 Web 实现，数据落到同源
  `localStorage`（键名带 `CapacitorStorage.` 前缀），活动与待确认队列均可持久保存。
  启动动画的每日播放标记由 `intro.js` 直接读写 `localStorage` 的
  `intro:lastFullDate`，不经过 Preferences。
- `@capacitor/app` 的 Android 返回键监听和 `@capacitor/splash-screen` 只在
  `isNative()` 为真时调用，浏览器不触发原生插件。
- `extractEvents(imageDataUrl, now)` 在原生模式直连当前配置的识别服务；网页模式
  只请求同源 `POST /api/chat`，不发送 Authorization 头。本地版构建时
  显式清空 `VITE_GLM_API_KEY` 和 `VITE_DEEPSEEK_API_KEY`，确保浏览器前端产物不包含 Key。
- `addToCalendar(event)` 在网页模式下生成活动 `.ics`；存在截止时间时，
  `addDeadlineToCalendar(event)` 再生成一个独立的“报名截止_活动名.ics”，不把两个
  VEVENT 合在同一文件。文件使用 CRLF，事件时间转为 UTC `Z` 格式，对 iCalendar
  特殊字符转义，两种日程都带有提前 1 小时的 `VALARM`。
- Vite 的 `base` 为 `./`，使静态资源在压缩包目录内使用相对路径。

### 本地服务器与发布包

- `local/server.py` 只使用 Python 3 标准库，只监听 `127.0.0.1`。
  从 8765 端口开始尝试可用端口，提供 `dist/` 静态文件，并在启动后
  自动打开默认浏览器。
- 服务器在未配置 Key 时也会正常启动。网页通过 `GET /api/config/status`
  检查状态；未配置时显示与 App 风格一致且不可跳过的设置弹窗，再通过
  同源 `POST /api/config` 把 Key 交给本地服务器。服务器原子写入同目录
  `config.json`，接口只返回是否已配置，不读回 Key；设置抽屉可随时更新。
- 本地服务器读取前端配置发送的 `X-Campus-Api-Url`，只允许 HTTPS 且主机为
  `open.bigmodel.cn` 或 `api.deepseek.com`、路径以 `/chat/completions` 结尾，随后代理
  `POST /api/chat`。超时、网络错误、429 和非 JSON 上游错误均返回
  `{ "error": { "message": "中文说明" } }`。
- Mac 使用 `start.command`，Windows 使用 `start.bat`；两者先切换到自身
  目录再启动 Python，避免用户从不同工作目录双击时找不到文件。
- `npm run package:local` 会先构建前端，然后生成项目根目录的
  `campus-demo-local.zip`。ZIP 根目录直接包含 `dist/`、`server.py`、
  预置 GLM Demo Key 的 `config.json`、两个启动文件和《使用说明.txt》，并保留 `start.command`
  的 Unix 可执行权限。
- 正式 Demo 产物更新使用 `npm run release:demo`：Android 构建注入 gitignored 的
  `.env.production.local` 中的 GLM Demo Key、强制清空备用 DeepSeek Key，生成
  `schedule-official-v1.apk`；随后网页构建清空前端中的两套 Key，但将同一 GLM Demo Key
  写入 `campus-demo-local.zip` 的本地代理配置。设置界面仍允许用户替换 Key。

## 7. 分工建议

| 负责方 | 任务 |
|---|---|
| Sol | 全部代码：`extract.js`、`store.js`、`calendar.js`、`main.js`、页面与样式、`CalendarIntentPlugin.java` |
| 人工 | 真机测试、识别效果把关、第 7 节对比实验、维护 `docs/AI_LOG.md` |

## 8. 对比实验（demo 的真正目的）

准备 10 条真实校园通知截图（群聊、海报、公众号长文各若干）。每条分别用本 demo 和手机自带助手（YOYO、小艺、小布等，用组员各自的手机）完成"加入日历"，记录：

| 通知编号 | 方式 | 标题/时间/地点/截止 正确数（/4） | 用时（秒） | 操作步数 | 备注 |
|---|---|---|---|---|---|

结论只看数据：若自带功能在准确率和步数上与 demo 相当，说明方案一的核心价值已被系统覆盖。

## 9. Android 正式发布（v2.0.0）

- 应用 ID / namespace / Java package 统一为 `com.itp.notice`；主 Activity 和
  CalendarIntent、SystemBars、NoticeInput 三个原生插件位于 java/com/itp/notice。
  Manifest 主 Activity 使用 `${applicationId}.MainActivity`，FileProvider 继续使用
  `${applicationId}.fileprovider`；分享 intent-filter 和插件功能保持不变。
- versionName 为 2.0.0，versionCode 为 2。package.json 的版本同步为 2.0.0，
  设置菜单新增“关于落笺”，从该文件读取版本号。后续发布同步修改 Android 与网页版本。
- 密钥库 android/release.keystore，别名 luojian，RSA 2048，有效期 10000 天，
  DN 为 CN=Luojian, O=ITP。随机生成 20 位密码，库密码和密钥密码相同；密码只保存在
  android/keystore.properties，文件权限 600，不在仓库或文档中记录密码明文。
- Gradle 必须读取上述配置，缺失配置、必填字段或密钥库时明确报错，不回退到调试签名。
  release 使用 signingConfigs.release，保持 minifyEnabled false。签名文件、密钥库、
  项目根 release/ 均被 Git 忽略，未被跟踪。
- 构建：npm run build → npx cap sync android → android/gradlew assembleRelease。
  输出 android/app/build/outputs/apk/release/app-release.apk；交付复制为
  release/luojian-v2.0.0.apk，用 apksigner verify --print-certs 校验证书。
- 新 ID 与旧 Demo 是独立安装应用，不自动迁移旧数据。正式版后续覆盖升级必须使用
  同一密钥并提高 versionCode；请加密备份密钥库和密码配置，禁止重新生成或公开。
  网页 ZIP 未重新生成，Event 格式、识别和日历接口保持不变。
