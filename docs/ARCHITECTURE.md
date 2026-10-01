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
npx cap init "校园活动助手" com.itp.campusdemo --web-dir dist
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
├── android/app/src/main/java/com/itp/campusdemo/
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
  "uncertain": ["模型不确定的字段名，如 start、location"],
  "status": "interested | registered | skipped",
  "createdAt": "ISO 时间字符串"
}
```

时间统一为本地时间 `YYYY-MM-DDTHH:mm`，不带时区。
`category` 是新增的可选展示字段；读取旧数据或收到未知值时统一按“其他”处理，
因此不会破坏已有 Event 或模块接口。

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

- 使用 `@capacitor/splash-screen`，原生启动页、状态栏、WebView 初始背景和网页启动层
  统一使用 `#FFFFFF`。网页启动层完成首次渲染后立即隐藏系统启动页，避免闪色。
- 启动动画只显示蓝色日历标记和中文应用名“活动”，移除英文标签、口号和装饰性小字；
  标记与标题依次淡入，停留后淡出，完整过程约 1.5 秒。
- 启动动画期间并行执行 `loadEvents()`。动画和数据加载都完成后才显示列表页；
  点击启动层任意位置可提前结束动画，但仍等待数据加载完成。
- 使用 Preferences 记录完整动画最后播放的本地日期。每天首次启动播放完整动画，
  当天再次启动只播放约 0.5 秒的快速淡入淡出。
- `prefers-reduced-motion` 开启时取消上移和弹出，仅保留透明度变化。

### Hash 路由与页面

`main.js` 统一管理页面状态并实现以下路由：

1. `#/list`：默认列表页。
2. `#/add`：添加页，承载选图、识别和逐条确认。
3. `#/edit/:id`：编辑已保存活动。

进入添加或编辑页时页面从右侧滑入；返回时向右滑出，时长约 250ms，使用无明显弹跳的
CSS `linear()` 弹簧曲线。Android 返回键通过 `@capacitor/app` 处理：添加页和编辑页返回列表，
列表页退出 App；识别进行中返回时先确认“放弃本次识别？”。

### 设置底部弹层

- 在列表、添加或编辑页向右滑超过约 58px，或点击列表应用栏右侧的三点菜单，打开
  Material 3 风格的底部设置弹层；普通活动卡片和表单外框均可起手，只有已展开快捷
  操作的卡片、弹窗和弹层自身不触发。
  手势通过非被动 `touchmove` 在移动过程中识别，并用 `touch-action: pan-y` 保留纵向滚动，
  避免 Android WebView 在 `pointerup` 前取消横向手势。点击遮罩、在抽屉层向右滑或按
  Android 返回键关闭；左滑不触发关闭，避免页面沿错误方向越过列表位置。关闭手势只
  在抽屉根节点绑定一次，设置内容重绘时不得重复注册监听器。
- 设置菜单包含“外观”和“识别接口”两个入口。识别接口提供 OpenAI 兼容 API 的
  基础地址、模型名称和 API Key。保存后无需重启，
  下一次识别直接使用自定义配置；“恢复内置”清除覆盖项并回退到构建配置。
- 自定义配置使用 Capacitor Preferences 保存在当前设备。Key 仅作输入框密码遮罩，
  并非加密存储，因此仍只适合低额度 Demo Key。
- 弹层先在视口底部完成渲染，再于下一次绘制后向上进入；关闭时向下滑出，进入和退出
  均使用约 250ms 的 CSS `linear()` 轻弹簧曲线，避免首次显示跳帧。已有
  `prefers-reduced-motion` 规则仍保留为淡入淡出。

### 主题层

- `style.css` 中的所有组件只引用 `--bg`、`--surface`、`--surface-2`、`--divider`、
  `--text`、`--text-2`、`--accent`、`--on-accent`、`--btn`、`--on-btn`、`--date-bg`、
  `--date-text`、`--today-bg`、`--today-text`、`--highlight`、`--on-highlight`、
  `--urgent-bg` 和 `--urgent-text` 语义变量；具体色值只出现在主题令牌定义中。
- 主题提供烟雨、坚冰、苔绿、暖阳四套，每套同时包含浅色和深色版本；模式提供
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
- 状态栏通过官方 `@capacitor/status-bar` 同步背景和图标明暗；自有 `SystemBarsPlugin`
  同步 Android 导航栏，并把已解析主题、模式和所选主题镜像到原生偏好。
  MainActivity 在 `super.onCreate` 前选择对应的八套 Splash 背景，因此冷启动页、状态栏、导航栏和
  WebView 首帧使用同一背景色。

### 列表页

- 使用 Material 3 标准顶部应用栏，标题为“活动”，右侧显示活动总数、管理和设置操作。
- 应用栏下方显示撕页台历样式的“今天”卡片，包含大号日期、星期和日期；当前日期
  位于 `TERM_CONFIG` 配置的教学周期内时，再显示“秋学期第 N 周”，学期外隐藏该行。
- 未结束活动按开始时间升序排列，并分为“今天、明天、本周、以后”四组；空分组不显示，
  分组标题滚动时吸附在应用栏下方。已结束活动置灰并默认折叠在末尾“已结束”分组。
- 活动卡片左侧显示台历式日期块，包含月份、等宽大号日期数字和星期；右侧依次显示
  标题、开始时间、地点、类型和状态。普通日期块统一使用浅强调色 `#C3E9EA` 配
  `#1E2D58` 日期文字；`category` 改为同色系的小文字标签，不再改变日期块颜色。
  距离报名截止不足 24 小时时，日期块改为 `#FBE4E1` 配 `#9F2F28`，该暖色只用于
  紧急或破坏性状态，并显示“今天截止”或“明天截止”。
- “今天”卡片与活动日期块的日期数字使用随 App 打包的开源 Oswald Bold 字体并启用
  等宽数字，其他文字仍使用 Android 系统中文字体。字体许可证随资源一同保留。
- “加入日历”成功后，对应日期块播放一次约 400ms 的撕页反馈：上半页向下翻折淡出，
  底层显示勾号；减少动态效果开启时只做透明度切换。
- 活动卡片默认只显示日程内容。向左滑动卡片后，卡片平移并露出右侧“加入日历”
  和“删除”操作；卡片在展开态取消接缝侧圆角，操作区使用连续背景和外侧圆角，不能
  在卡片与“加入日历”之间露出底色缝隙。点击卡片或向右滑动收回，删除前二次确认。
- 页头“管理”进入多选模式，选中任意数量的活动后可通过底部工具条批量删除或
  批量加入日历；Android 返回键优先退出多选模式。由于原生层使用系统日历的
  `ACTION_INSERT`，批量加入时按顺序逐个打开日历页，用户保存并返回后继续下一条。
- 管理模式使用底部操作条，进入时从下向上出现，点击完成、取消或按返回键时先向下
  滑出再退出管理状态。已结束分组不使用
  原生 `<details>`，展开时容器像窗帘一样向下展开，活动卡片以 55ms 间隔依次下落排列。
- 删除、放弃、批量日历等确认操作统一使用 App 内 Material 3 弹窗；点击遮罩、取消
  按钮、Esc 或 Android 返回键均可关闭。
- 空列表使用随项目提供的简笔画空白台历 SVG，并显示“还没有活动，点右下角的加号，
  添加一张通知截图”。应用图标使用同一组提供的台历撕页 SVG，主色为烟雨主题的
  `#565C78`，不含文字；
  Android 自适应图标和各密度兼容图标均由该资源生成。
- 右下角悬浮加号使用 `env(safe-area-inset-bottom)` 避让手势导航区域；列表向下
  滚动时缩小隐藏，向上滚动时恢复。点击进入 `#/add`。

### 添加页与编辑页

- 添加页顶部为标准应用栏，含返回按钮和“添加活动”；空闲态上下显示两个入口：
  上方选择通知截图，下方可粘贴群消息、公众号正文或邮件文字。
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
- 所有动画仅使用 CSS `transform`、`opacity` 与 `keyframes`，常规单次过渡控制在
  150–300ms。物理反馈使用 CSS `linear()` 定义的直接过渡、轻弹簧和按压三种曲线，不引入
  动画库；已有 `prefers-reduced-motion` 规则继续关闭 shimmer 和大幅位移。
- 所有可点击按钮、卡片和入口使用统一的 Material 状态层与点击水波纹，并为非手势控件
  增加极轻的按压缩放以强化 pointer-down 即时响应。水波纹原点跟随触点，约 420ms 后结束。
- 默认浅色烟雨主题和其他五套主题的颜色只在 `style.css` 的主题令牌中定义。组件不直接
  引用色值；强调填充、主要按钮、日期块、“今天”卡片和紧急状态均通过语义变量适配。
  界面使用系统中文字体，不使用渐变和装饰性阴影；卡片仅用细边框或极轻阴影区分层级。
- 网页首次配置 API Key 的弹窗宽度不超过视口减 32px，高度不超过动态视口；输入框
  字号固定为至少 16px，防止移动浏览器聚焦时自动放大整个页面。

## 6. 本地网页版

本地网页版与 Android App 共用 `main.js`、`extract.js`、`store.js`、
`calendar.js` 和全部 UI，不复制业务代码。`platform.js` 只对外导出
`isNative()`，内部使用 `Capacitor.isNativePlatform()` 作为统一的平台分流点。
`Event` 数据格式和第 4 节的模块公开接口保持不变。

### 网页运行时

- `@capacitor/preferences` 在网页平台使用其 Web 实现，数据落到同源
  `localStorage`，活动、待确认队列和每日启动标记均可持久保存。
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
