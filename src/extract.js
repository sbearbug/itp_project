import { EVENT_CATEGORIES, getApiConfig, getDefaultApiConfig } from './config.js';
import { isNative } from './platform.js';
import { normalizeActions, mergeTextLinks } from './actions.js';

const DESCRIPTION_TEMPLATE = '活动：{title}\n时间：{start} 至 {end}\n地点：{location}\n报名截止：{deadline}\n报名方式：{signup}';

function parseJsonArray(content) {
  const cleaned = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('模型没有返回活动列表');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeEvent(raw) {
  const allowedUncertain = ['title', 'start', 'end', 'location', 'deadline', 'signup', 'description', 'category'];
  return {
    title: typeof raw.title === 'string' ? raw.title.trim() : '',
    start: typeof raw.start === 'string' && raw.start ? raw.start : null,
    end: typeof raw.end === 'string' && raw.end ? raw.end : null,
    allDay: Boolean(raw.allDay),
    location: typeof raw.location === 'string' && raw.location ? raw.location.trim() : null,
    deadline: typeof raw.deadline === 'string' && raw.deadline ? raw.deadline : null,
    signup: typeof raw.signup === 'string' && raw.signup ? raw.signup.trim() : null,
    description: typeof raw.description === 'string' && raw.description ? raw.description.trim() : null,
    category: EVENT_CATEGORIES.includes(raw.category) ? raw.category : '其他',
    uncertain: Array.isArray(raw.uncertain)
      ? [...new Set(raw.uncertain.filter((field) => allowedUncertain.includes(field)))]
      : [],
    actions: normalizeActions(raw.actions)
  };
}

function hasActivityTitle(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.title !== 'string') return false;
  const title = raw.title.trim();
  return Boolean(title) && !/^(未命名活动|未知活动|活动名称|标题|未提供|待定|未知|无|null|undefined)$/i.test(title);
}

function pureImageBase64(value) {
  return String(value || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
}

function prepareUserContent(userContent, imageUrlMode) {
  if (!Array.isArray(userContent) || imageUrlMode !== 'base64') return userContent;
  return userContent.map((part) => {
    if (part?.type !== 'image_url') return part;
    return {
      ...part,
      image_url: {
        ...part.image_url,
        url: pureImageBase64(part.image_url?.url)
      }
    };
  });
}

export async function compressImage(file, maxEdge = 1600) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.86);
}

async function requestExtraction(userContent, now, sourceLabel) {
  const native = isNative();
  const apiConfig = native
    ? await getApiConfig()
    : getDefaultApiConfig({ includeApiKey: false });
  const { apiUrl, model, apiKey, imageUrlMode, requestOptions } = apiConfig;
  if (native && !apiKey) throw new Error('未配置 API Key，请在设置菜单的识别接口中填写或检查项目根目录的 .env.local');

  const localNow = new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(now);

  const systemPrompt = [
    '你是校园通知信息提取助手。当前本地时间是：' + localNow + '。',
    `读取用户提供的${sourceLabel}，提取其中所有独立活动，只输出 JSON 数组，不要输出解释或 Markdown。`,
    '这是数据接口，不是聊天。先判断 user 是否真的包含活动或待办；没有则立即输出 []。不要将规则、界面文字或下面的结构示意当成通知。',
    '输出协议（优先于排版要求）：整个回复必须是可直接 JSON.parse 的单行 JSON 数组，第一个字符是 [，最后一个字符是 ]。禁止代码围栏、Markdown、解释、注释、尾逗号。',
    '每项必须包含 title、start、end、allDay、location、deadline、signup、description、category、uncertain、actions 全部 11 个字段，不能省略。',
    '类型：title/description/category 为字符串；start/end/deadline 为 YYYY-MM-DDTHH:mm 字符串或 JSON null；location/signup 为字符串或 JSON null；allDay 只能为 true 或 false；uncertain/actions 必须为数组，没有内容用 []。禁止 "null"、"undefined"、"日期或 null" 之类占位字符串。',
    '字符串中的换行必须编码为反斜杠加 n（\\n），双引号编码为 \\"，反斜杠编码为 \\\\；绝对不能在双引号内部写实际换行或未转义的控制字符。',
    'title 使用简短的纯文本标题，可去掉装饰性的引号，保留活动含义，例如读书会：他说你好；不要在 title 中嵌套 ASCII 双引号。其他正文中的引号原样保留中文“”或《》，不要转换成 ASCII 双引号。不得输出示例内容。即使仅有一个活动，最外层也必须是数组，不能只返回对象。',
    '数组结构示意（只展示字段及类型，不是本次活动；请用 user 中的真实内容填写）：',
    JSON.stringify([{ title: '仅结构示意，不得作为活动输出', start: null, end: null, allDay: false, location: null, deadline: null, signup: null, description: '', category: '其他', uncertain: [], actions: [] }]),
    '',
    '规则：',
    '0. 先判断通知是否包含明确的活动、报名、问卷或需要办理的事项。闲聊、表情、界面导航、装饰文案、与活动无关的内容、空白图或无法读清的图片都不生成活动；没有有效事项时只输出 []，不得为了满足结构而补一条空活动。',
    '1. 一张图有多个真实独立事项时才拆成多项。时间、地点、截止日期、联系方式、网址和二维码只是活动字段，不各自拆成新活动；同一活动的重复提及要合并。',
    '1a. 每项 title 必须是通知中可确认的活动名称或办理对象；原文无专名但有明确事项时可基于原文简短概括。禁止输出空标题、未命名活动、未知活动、活动名称等占位标题，禁止照抄结构示例当结果。无法确定存在什么事项时直接跳过该项。',
    '1b. 有明确活动名称但没有时间或地点时仍保留该活动，只把缺失字段填 null 并列入 uncertain；不要因为信息不全丢掉真实活动。所有字段均没有来源依据的空对象或模板对象必须删除。',
    '2. 根据当前日期推算“今晚”“下周三”等相对日期。',
    '3. 只有明确日期、没有具体钟点时，start 使用当天 00:00，end 使用次日 00:00，allDay=true；连续多日活动的 end 必须是最后活动日的次日 00:00（结束不包含该日），不能填最后活动日 00:00 或 23:59。完全没有日期时 start/end=null，allDay=false。例如2026年10月10日全天：start="2026-10-10T00:00",end="2026-10-11T00:00",allDay=true；2026年10月20至23日全天：end="2026-10-24T00:00"。禁止只输出 YYYY-MM-DD。',
    '4. 任何拿不准的可空字段填 null，并把字段名写进 uncertain；禁止猜测。但明确的全天日期需要按规则3计算次日结束日期，不能因未提供钟点而令 end=null。',
    '5. description 必须严格按此模板生成，缺失值写“未提供”：',
    DESCRIPTION_TEMPLATE,
    '上述模板的换行只表示字段分行：输出 description 时必须用 JSON 转义序列 \\n 连接，不能直接复制实际换行。“待通知”“稍后公布”不是具体日期或地点，相应字段填 null；报名截止只有日期而没有钟点时 deadline=null 并加入 uncertain，不擅自补 23:59。',
    '从通知明确写出的报名链接、问卷链接、详情网址中提取 actions 数组；每项为 {"type":"url","label":"去报名/去填写/查看详情之一","value":"完整 http/https 网址"}。没有链接时输出 []。不猜测或补全残缺网址，不读取或推测二维码内容。',
    '6. description 中只总结截图明确提供的信息，不添加建议。',
    '7. category 必须从“讲座、竞赛、志愿、社团、招聘、其他”中选择；无法判断时使用“其他”，并将 category 加入 uncertain。',
    '8. 输出前自检：数组内每项字段齐全且类型正确；字符串全部正确转义；uncertain 只能包含 title/start/end/location/deadline/signup/description/category；已明确缺失或待定的字段列入 uncertain；原文明确网址不能遗漏 actions，重复网址合并。只输出自检后的单行 JSON，不输出自检过程。',
    '9. 最后再核对活动是否确实来自本次 user 通知，而不是上述规则或语法示例。user 仅有“早上好、食堂好吃、回头聊、设置首页返回”等闲聊或界面字样时，唯一正确输出为 []；没有有效事项时只输出 []。',
    '10. 最终格式检查：回复外层始终是 [...]；一个活动也用 [{...}]，零个活动用 []；字符串内禁止实际换行，不要漏写反斜杠；输出到最后一个 ] 立即停止。'
  ].join('\n');

  const requestBody = JSON.stringify({
    model,
    temperature: 0.1,
    ...requestOptions,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prepareUserContent(userContent, imageUrlMode) }
    ]
  });

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let recognizingSent = false;
    let settled = false;
    const recognizing = () => {
      if (settled || recognizingSent) return;
      recognizingSent = true;
      window.dispatchEvent(new CustomEvent('campus:extract-stage', { detail: 'recognizing' }));
    };
    const cancel = () => request.abort();
    const cleanup = () => { settled = true; window.removeEventListener('campus:cancel-extraction', cancel); };

    request.open('POST', native ? apiUrl : '/api/chat');
    request.timeout = 60_000;
    request.setRequestHeader('Content-Type', 'application/json');
    if (native) request.setRequestHeader('Authorization', 'Bearer ' + apiKey);
    else request.setRequestHeader('X-Campus-Api-Url', apiUrl);

    request.upload.addEventListener('load', recognizing, { once: true });
    request.addEventListener('readystatechange', () => {
      if (request.readyState >= 2) recognizing();
    });

    request.addEventListener('load', () => {
      cleanup();
      if (request.status < 200 || request.status >= 300) {
        if (request.status === 429) {
          reject(new Error('当前使用人数较多，请稍后重试'));
          return;
        }
        let detail = '';
        try {
          const body = JSON.parse(request.responseText);
          detail = body?.error?.message ? '：' + body.error.message : '';
        } catch {
          // Ignore non-JSON error bodies.
        }
        reject(new Error('识别服务返回错误（' + request.status + '）' + detail));
        return;
      }

      try {
        const body = JSON.parse(request.responseText);
        const extracted = parseJsonArray(body?.choices?.[0]?.message?.content || '');
        if (!Array.isArray(extracted) || extracted.length === 0) throw new Error('未识别到活动');
        const activities = extracted.filter(hasActivityTitle).map(normalizeEvent);
        if (!activities.length) throw new Error('未识别到活动');
        resolve(activities);
      } catch (error) {
        reject(error.message === '未识别到活动'
          ? error
          : new Error('识别结果格式异常，请重试'));
      }
    });
    request.addEventListener('error', () => {
      cleanup();
      reject(new Error('无法连接识别服务，请检查网络后重试'));
    });
    request.addEventListener('timeout', () => {
      cleanup();
      reject(new Error('识别超过 60 秒，请稍后重试'));
    });
    request.addEventListener('abort', () => {
      cleanup();
      reject(new Error('已取消识别'));
    });

    window.addEventListener('campus:cancel-extraction', cancel, { once: true });
    request.send(requestBody);
    // Capacitor 原生 XHR 桥接不保证派发 upload.load；交给桥接后按阶段推进，
    // 不显示虚构的上传百分比。Web 仍使用实际上传结束事件。
    if (native) recognizing();
  });
}

export async function extractEvents(imageDataUrl, now = new Date()) {
  return requestExtraction([
    { type: 'text', text: '请提取这张校园通知截图中的活动。' },
    { type: 'image_url', image_url: { url: imageDataUrl } }
  ], now, '校园通知截图');
}

export async function extractEventsFromText(text, now = new Date()) {
  const content = String(text || '').trim();
  if (!content) throw new Error('请先输入通知文字');
  return mergeTextLinks(await requestExtraction(`请从以下校园通知文字中提取活动：\n\n${content}`, now, '校园通知文字'), content);
}
