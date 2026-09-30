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
| 识别 | 前端直接调用 DeepSeek API（OpenAI 兼容格式，`https://api.deepseek.com`，模型 `deepseek-flash`，支持图片输入） |
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
│   ├── config.js      # API 地址、模型名、混淆后的 key
│   └── style.css
├── local/                 # 标准库本地服务器、配置和双击启动文件
├── scripts/package-local.mjs # 构建并生成本地网页版 ZIP
├── android/app/src/main/java/com/itp/campusdemo/
│   ├── MainActivity.java          # 注册插件
│   └── CalendarIntentPlugin.java  # 写日历原生插件
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
  "uncertain": ["模型不确定的字段名，如 start、location"],
  "status": "interested | registered | skipped",
  "createdAt": "ISO 时间字符串"
}
```

时间统一为本地时间 `YYYY-MM-DDTHH:mm`，不带时区。

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
- 使用 OpenAI 兼容的 `/chat/completions`，模型 `deepseek-flash`。图片**只能放在 `user` 消息里**（放进 system 会返回 400）：user 消息内容为 `[{type:"text"}, {type:"image_url", image_url:{url: imageDataUrl}}]`，system 消息只放纯文本提示词。
- 系统提示词要求：只输出 JSON 数组；把当前日期和星期告诉模型，用来推算相对日期；拿不准的字段填 `null` 并写进 `uncertain`；一张图有多个活动时拆成多条。
- 解析时容错：去掉 ```json 包裹，找到第一个 `[` 到最后一个 `]` 再 `JSON.parse`。
- 发送前把图片压缩到长边不超过 1600px，节省费用和时间。
- 文字入口复用同一套 system prompt、请求、容错解析和 Event 归一化；
  user 消息改为纯文字，不附带 `image_url`。

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
```

- 通过 `registerPlugin("CalendarIntent")` 调用原生方法 `insert({ title, beginMs, endMs, location, description })`。
- `end` 为空时默认 `start + 1 小时`；`start` 为空时不允许调用，界面提示用户先补全时间。
- 全天活动的 `end` 为空时默认使用次日零点。
- “加入日历”先保存当前表单；成功调起日历界面后把状态更新为 `registered`。

### CalendarIntentPlugin.java（原生，约 30 行）

- `@CapacitorPlugin(name = "CalendarIntent")`，方法 `@PluginMethod insert(PluginCall call)`。
- 构造 `new Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)`，填入 `CalendarContract.EXTRA_EVENT_BEGIN_TIME`、`EXTRA_EVENT_END_TIME`、`Events.TITLE`、`Events.EVENT_LOCATION`、`Events.DESCRIPTION`，`startActivity` 后 `call.resolve()`。
- 在 `MainActivity.onCreate` 中、`super.onCreate` 之前 `registerPlugin(CalendarIntentPlugin.class)`。
- 不需要任何日历读写权限：保存动作由系统日历完成。

### config.js

- 保留导出 `API_BASE`、`MODEL`、`getApiKey()`；同时通过 `getApiConfig()` 在每次请求前
  读取设备上的自定义 API 地址、模型名和 Key。存在完整自定义配置时优先使用，否则
  使用项目根目录 `.env.local` 在构建时注入的默认配置。
- **混淆不等于安全**：此 key 必须是 demo 专用、低余额、设消费上限，demo 结束即作废。

## 5. 界面与路由

### 启动动画

- 使用 `@capacitor/splash-screen`，原生启动页、WebView 初始背景和网页启动层统一使用
  `#F3F0E6`。网页启动层完成首次渲染后立即隐藏系统启动页，避免白色闪烁。
- 网页启动动画依次展示 “CAMPUS ACTION”、“把通知，”和墨绿色“变成行动。”；
  第二行延迟约 250ms，句号单独轻微弹出。标题停留后向上淡出，列表页随后淡入，
  完整过程约 1.5 秒。
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

进入添加或编辑页时页面从右侧滑入；返回时向右滑出，时长约 250ms，缓动为
`ease-out`。Android 返回键通过 `@capacitor/app` 处理：添加页和编辑页返回列表，
列表页退出 App；识别进行中返回时先确认“放弃本次识别？”。

### 左侧设置抽屉

- 在列表、添加或编辑页向右滑超过约 58px，主页面向右移动并露出左侧设置抽屉；
  普通活动卡片和表单外框均可起手，只有已展开快捷操作的卡片、弹窗和抽屉自身不触发。
  手势通过非被动 `touchmove` 在移动过程中识别，并用 `touch-action: pan-y` 保留纵向滚动，
  避免 Android WebView 在 `pointerup` 前取消横向手势。点击遮罩、在抽屉内向左滑或按
  Android 返回键关闭。
- 当前设置只包含 OpenAI 兼容 API 的基础地址、模型名称和 API Key。保存后无需重启，
  下一次识别直接使用自定义配置；“恢复内置”清除覆盖项并回退到构建配置。
- 自定义配置使用 Capacitor Preferences 保存在当前设备。Key 仅作输入框密码遮罩，
  并非加密存储，因此仍只适合低额度 Demo Key。
- 抽屉与页面位移使用 250ms `ease-out`；开启 `prefers-reduced-motion` 时仅淡入显示。

### 列表页

- 页头仅显示“我的活动”和活动总数，不再长期展示首页大标题。
- 活动按开始时间升序排列；已结束活动置灰并默认折叠在末尾“已结束”分组。
- 活动卡片显示标题、开始时间、地点和状态标签。距离报名截止不足 24 小时的活动
  显示“今天截止”或“明天截止”。
- 活动卡片默认只显示日程内容。向左滑动卡片后，卡片平移并露出右侧“加入日历”
  和“删除”操作；点击卡片或向右滑动收回，删除前二次确认。
- 页头“管理”进入多选模式，选中任意数量的活动后可通过底部工具条批量删除或
  批量加入日历；Android 返回键优先退出多选模式。由于原生层使用系统日历的
  `ACTION_INSERT`，批量加入时按顺序逐个打开日历页，用户保存并返回后继续下一条。
- 管理模式的选择控件和底部工具条以 200–220ms 渐入，不瞬间切换。已结束分组不使用
  原生 `<details>`，展开时容器像窗帘一样向下展开，活动卡片以 55ms 间隔依次下落排列。
- 删除、放弃、批量日历等确认操作统一使用 App 内自定义弹窗，复用米白背景、圆角、
  墨绿/警示色和阴影；点击遮罩、取消按钮、Esc 或 Android 返回键均可关闭。
- 空列表显示“选择校园通知截图，确认信息后写入系统日历”以及右下角加号引导。
- 右下角悬浮加号使用 `env(safe-area-inset-bottom)` 避让手势导航区域；列表向下
  滚动时缩小隐藏，向上滚动时恢复。点击进入 `#/add`。

### 添加页与编辑页

- 添加页顶部为返回按钮和“添加活动”，空闲态上下显示两个入口：
  上方选择通知截图，下方可粘贴群消息、公众号正文或邮件文字。图片选择框
  按下时在 160ms 内轻微缩小、收紧阴影并变暗，提供明确的物理按压反馈；
  `prefers-reduced-motion` 下只改变透明度。
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
- 识别成功后，骨架屏淡出，结果卡片以约 250ms 的淡入上移动画出现；多活动卡片
  依次错开 80ms，并显示识别数量。
- `uncertain` 字段采用黄色底色，首次出现时轻微闪烁一次，并标注“请核对”。
- 保存和加入日历期间，按钮显示 spinner 并禁用；完成后底部 toast 分别显示
  “已保存”或“已打开系统日历”，2 秒自动消失。
- 删除操作必须二次确认；删除动画为列表项向左滑出并收起。新增活动从列表顶部
  淡入。空列表显示说明文字和“选择截图”按钮。
- 所有动画仅使用 CSS `transform`、`opacity` 与 `keyframes`，单次过渡控制在
  150–300ms，统一使用 `ease-out`。开启 `prefers-reduced-motion` 时关闭 shimmer
  和位移动画，只保留透明度变化。

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
- `extractEvents(imageDataUrl, now)` 在原生模式仍直连 DeepSeek；网页模式
  只请求同源 `POST /api/chat`，不发送 Authorization 头。本地版构建时
  显式清空 `VITE_DEEPSEEK_API_KEY`，确保 ZIP 内的前端产物不包含 Key。
- `addToCalendar(event)` 在网页模式下生成并下载 `.ics`。文件使用
  CRLF，事件时间转为 UTC `Z` 格式，对 iCalendar 特殊字符转义，
  活动与可选的“【报名截止】”事件都带有提前 1 小时的 `VALARM`。
- Vite 的 `base` 为 `./`，使静态资源在压缩包目录内使用相对路径。

### 本地服务器与发布包

- `local/server.py` 只使用 Python 3 标准库，只监听 `127.0.0.1`。
  从 8765 端口开始尝试可用端口，提供 `dist/` 静态文件，并在启动后
  自动打开默认浏览器。
- 服务器在未配置 Key 时也会正常启动。网页通过 `GET /api/config/status`
  检查状态；未配置时显示与 App 风格一致且不可跳过的设置弹窗，再通过
  同源 `POST /api/config` 把 Key 交给本地服务器。服务器原子写入同目录
  `config.json`，接口只返回是否已配置，不读回 Key；设置抽屉可随时更新。
- 本地服务器把 `POST /api/chat` 代理转发到固定的
  `https://api.deepseek.com/chat/completions`。超时、网络错误和非 JSON
  上游错误均返回 `{ "error": { "message": "中文说明" } }`。
- Mac 使用 `start.command`，Windows 使用 `start.bat`；两者先切换到自身
  目录再启动 Python，避免用户从不同工作目录双击时找不到文件。
- `npm run package:local` 会先构建前端，然后生成项目根目录的
  `campus-demo-local.zip`。ZIP 根目录直接包含 `dist/`、`server.py`、
  空的 `config.json` 模板、两个启动文件和《使用说明.txt》，并保留 `start.command`
  的 Unix 可执行权限。
- 正式 Demo 产物更新使用 `npm run release:demo`：先用原生构建配置生成
  主产物 `campus-demo-android.apk`，再显式清空前端 Key 构建辅助产物
  `campus-demo-local.zip`。这个顺序保证两份产物来自同一份源码，同时网页包
  不会携带 Android Demo 的内置 Key。

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
