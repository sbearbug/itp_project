# 校园活动助手 Demo

从校园通知截图中提取活动信息，人工确认后调起 Android 系统日历。

## 本地预览

要求 Node.js 22 或更高版本。

```bash
npm install
npm run dev
```

浏览器预览支持活动识别、待确认队列和本地编辑；“加入系统日历”只在 Android App 中可用。

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

内置 Demo API Key 通过构建配置提供。复制项目根目录中的
`campus-demo/.env.example` 为 `campus-demo/.env.local`，然后填写：

```dotenv
VITE_DEEPSEEK_API_KEY=sk-your-demo-key
```

修改后需要重新执行 `npm run cap:sync` 或 `npm run apk`。Vite 会在构建时把
Key 注入前端包，因此只能使用低额度、设有消费上限且可随时作废的 Demo 专用 Key；
不要提交 `.env.local`。

App 内也支持自定义 OpenAI 兼容 API：在页面非交互区域向右滑打开左侧设置，填写
API 基础地址、模型名称和 API Key 后保存。自定义配置保存在当前设备的 Capacitor
Preferences 中，后续识别优先使用它；点击“恢复内置”可重新使用构建时注入的配置。

## 交互规则

- 模型识别结果先进入“待确认”，不直接写入正式活动列表。
- 返回首页会保留待确认项，并用黄色卡片表示。
- “确认并保存”后，活动默认状态为“感兴趣”。
- “保存并加入日历”会先保存，再打开系统日历，然后将状态改为“已加入日历”。
- “已跳过”由用户在状态选择框中手动设置。
- 模型无法确定的字段为空并标黄；只有日期的活动按全天活动处理。
