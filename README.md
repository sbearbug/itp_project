# 校园活动助手 Demo

从校园通知截图或粘贴的通知文字中提取活动信息，人工确认后加入日历。

Android APK 是 Demo 的主要产物，本地网页 ZIP 只用于没有 Android
设备的组员辅助体验。同步构建两份产物：

```bash
npm run release:demo
```

生成项目根目录的 `campus-demo-android.apk`和 `campus-demo-local.zip`。
当前 Android 版本为 1.3（`versionCode 4`），正式测试包输出为
`schedule-official-v1.apk`，避免下载器或文件缓存混淆新旧包。

## 本地预览

要求 Node.js 22 或更高版本。

```bash
npm install
npm run dev
```

开发服务器没有 `/api/chat` 代理，如需完整网页体验请使用下方的本地网页版。

## 本地网页版

生成可分发的 ZIP：

```bash
npm run package:local
```

产物为项目根目录的 `campus-demo-local.zip`。解压后 Mac 双击
`start.command`，Windows 双击 `start.bat`。正式演示包已在本地服务器的
`config.json` 中预置 GLM Demo Key，也可从设置页替换；若未配置才会弹出填写窗口。
服务只监听 `127.0.0.1`，API Key 不会写入浏览器前端文件。网页中的“加入日历”会
下载 `.ics` 文件供系统日历导入。

## Android

要求 Android Studio、Android SDK 及 JDK 21。

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
npm run cap:sync
npx cap open android
```

也可以连接设备后执行：

```bash
npx cap run android
```

构建调试 APK：

```bash
npm run apk
```

## API Key

默认识别服务为智谱 GLM，模型为 `glm-4.6v-flash`。本地开发构建可以通过
构建配置提供 Demo API Key。复制项目根目录中的
`campus-demo/.env.example` 为 `campus-demo/.env.local`，然后填写：

```dotenv
VITE_GLM_API_KEY=your-zhipu-api-key
```

修改后需要重新执行 `npm run cap:sync` 或 `npm run apk`。Vite 会在构建时把
Key 注入前端包，因此只能使用低额度、设有消费上限且可随时作废的 Demo 专用 Key；
不要提交 `.env.local`。

`npm run release:demo` 会把 `.env.production.local` 中的 GLM Demo Key 注入 Android
APK，同时强制清空备用 DeepSeek Key。本地网页版 ZIP 仍会清空两套 Key，并在首次
打开时要求填写，避免网页前端直接携带凭据。

App 内也支持自定义 OpenAI 兼容 API：在页面非交互区域向右滑打开左侧设置，填写
API 基础地址、模型名称和 API Key 后保存。自定义配置保存在当前设备的 Capacitor
Preferences 中，后续识别优先使用它；点击“恢复内置”可重新使用构建时注入的配置。

默认服务和备用 DeepSeek 服务都集中在 `src/config.js` 的 `API_PROVIDERS`
中。将 `ACTIVE_API_PROVIDER` 从 `glm` 改为 `deepseek` 即可切回原接口；切回时
在 `.env.local` 中填写 `VITE_DEEPSEEK_API_KEY`。

## 交互规则

- 模型识别结果先进入“待确认”，不直接写入正式活动列表。
- 返回首页会保留待确认项，并用黄色卡片表示。
- “确认并保存”后，活动默认状态为“感兴趣”。
- “保存并加入日历”会先保存，再打开系统日历，然后将状态改为“已加入日历”。
- 活动参与时间与报名截止时间分别写入两个独立日程；没有报名截止时间时只写活动日程。
- “已跳过”由用户在状态选择框中手动设置。
- 模型无法确定的字段为空并标黄；只有日期的活动按全天活动处理。
