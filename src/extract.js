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
  if (native && !apiKey) throw new Error('未配置 API Key，请在左侧设置中填写或检查项目根目录的 .env.local');

  const localNow = new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(now);

  const systemPrompt = [
    '你是校园通知信息提取助手。当前本地时间是：' + localNow + '。',
    `读取用户提供的${sourceLabel}，提取其中所有独立活动，只输出 JSON 数组，不要输出解释或 Markdown。`,
    '每项严格使用以下结构：',
    '{"title":"活动名称","start":"YYYY-MM-DDTHH:mm 或 null","end":"YYYY-MM-DDTHH:mm 或 null","allDay":false,"location":"地点或 null","deadline":"YYYY-MM-DDTHH:mm 或 null","signup":"报名方式、链接或二维码说明，或 null","description":"按指定模板总结","category":"讲座、竞赛、志愿、社团、招聘、其他之一","uncertain":["不确定的字段名"],"actions":[{"type":"url","label":"去报名","value":"https://..."}]}',
    '',
    '规则：',
    '1. 一张图有多个活动时拆成多项。',
    '2. 根据当前日期推算“今晚”“下周三”等相对日期。',
    '3. 只有明确日期、没有具体钟点时，start 使用当天 00:00，end 使用次日 00:00，allDay=true。',
    '4. 任何拿不准的字段填 null，并把字段名写进 uncertain；禁止猜测。',
    '5. description 必须严格按此模板生成，缺失值写“未提供”：',
    DESCRIPTION_TEMPLATE,
    '从通知明确写出的报名链接、问卷链接、详情网址中提取 actions 数组；每项为 {"type":"url","label":"去报名/去填写/查看详情之一","value":"完整 http/https 网址"}。没有链接时输出 []。不猜测或补全残缺网址，不读取或推测二维码内容。',
    '6. description 中只总结截图明确提供的信息，不添加建议。',
    '7. category 必须从“讲座、竞赛、志愿、社团、招聘、其他”中选择；无法判断时使用“其他”，并将 category 加入 uncertain。'
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
    const cancel = () => request.abort();
    const cleanup = () => window.removeEventListener('campus:cancel-extraction', cancel);

    request.open('POST', native ? apiUrl : '/api/chat');
    request.timeout = 60_000;
    request.setRequestHeader('Content-Type', 'application/json');
    if (native) request.setRequestHeader('Authorization', 'Bearer ' + apiKey);
    else request.setRequestHeader('X-Campus-Api-Url', apiUrl);

    request.upload.addEventListener('load', () => {
      window.dispatchEvent(new CustomEvent('campus:extract-stage', { detail: 'recognizing' }));
    }, { once: true });

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
        resolve(extracted.map(normalizeEvent));
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
