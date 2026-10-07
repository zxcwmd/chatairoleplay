import { Capacitor, CapacitorHttp } from '@capacitor/core';

const DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  chatModel: 'gpt-4o-mini',
  imageModel: 'gpt-image-1',
};
const NATIVE_SETTINGS_KEY = 'miryi-native-ai-settings-v1';

export const isNativeApp = Capacitor.isNativePlatform();

function publicSettings(value = {}) {
  const apiKeySet = Boolean(value.apiKey);
  return {
    baseUrl: value.baseUrl || DEFAULTS.baseUrl,
    chatModel: value.chatModel || DEFAULTS.chatModel,
    imageModel: value.imageModel || DEFAULTS.imageModel,
    apiKeySet,
    configured: apiKeySet && Boolean(value.chatModel || DEFAULTS.chatModel),
  };
}

function readNativeSettings() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(NATIVE_SETTINGS_KEY) || '{}')) };
  } catch {
    return { ...DEFAULTS, apiKey: '' };
  }
}

function makeError(message, status = 502) {
  const error = new Error(message || 'Не удалось выполнить запрос.');
  error.status = status;
  return error;
}

function providerMessage(data, status) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { /* use fallback below */ }
  }
  return data?.error?.message || data?.message || (status === 401 || status === 403
    ? 'Провайдер отклонил ключ. Проверь API-ключ и адрес.'
    : `Провайдер вернул ошибку ${status}. Проверь модель и настройки.`);
}

async function nativeRequest(path, body, timeout = 90000) {
  const settings = readNativeSettings();
  if (!settings.apiKey) throw makeError('Сначала добавь API-ключ в разделе «Настройки».', 409);
  const baseUrl = settings.baseUrl.replace(/\/+$/, '');
  try {
    const response = await CapacitorHttp.request({
      url: `${baseUrl}${path}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
      },
      data: body,
      connectTimeout: 25000,
      readTimeout: timeout,
    });
    if (response.status < 200 || response.status >= 300) {
      throw makeError(providerMessage(response.data, response.status), response.status);
    }
    const data = typeof response.data === 'string'
      ? JSON.parse(response.data)
      : response.data;
    return data || {};
  } catch (error) {
    if (error.status) throw error;
    throw makeError(error.message || 'Не удалось связаться с провайдером. Проверь интернет-соединение.');
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw makeError(data.error || 'Не удалось выполнить запрос.', response.status);
  return data;
}

export async function loadAISettings() {
  if (isNativeApp) return publicSettings(readNativeSettings());
  return fetchJson('/api/settings');
}

export async function saveAISettings(payload) {
  if (isNativeApp) {
    const current = readNativeSettings();
    const next = {
      ...current,
      baseUrl: typeof payload.baseUrl === 'string' ? payload.baseUrl.trim() : current.baseUrl,
      chatModel: typeof payload.chatModel === 'string' ? payload.chatModel.trim() : current.chatModel,
      imageModel: typeof payload.imageModel === 'string' ? payload.imageModel.trim() : current.imageModel,
    };
    if (payload.clearApiKey === true) next.apiKey = '';
    else if (typeof payload.apiKey === 'string' && payload.apiKey.trim()) next.apiKey = payload.apiKey.trim();
    if (!next.baseUrl || !/^https?:\/\//i.test(next.baseUrl)) throw makeError('Укажи корректный адрес API, начиная с https://.', 400);
    if (!next.chatModel || !next.imageModel) throw makeError('Укажи названия текстовой модели и модели изображений.', 400);
    localStorage.setItem(NATIVE_SETTINGS_KEY, JSON.stringify(next));
    return publicSettings(next);
  }
  return fetchJson('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function testAIProvider() {
  if (!isNativeApp) return fetchJson('/api/settings/test', { method: 'POST' });
  const settings = readNativeSettings();
  const result = await nativeRequest('/chat/completions', {
    model: settings.chatModel,
    messages: [{ role: 'user', content: 'Ответь одним словом: готово.' }],
    max_tokens: 16,
    temperature: 0,
  }, 25000);
  return {
    ok: true,
    model: settings.chatModel,
    reply: result?.choices?.[0]?.message?.content || '',
  };
}

export async function sendAIMessage(payload) {
  if (!isNativeApp) return fetchJson('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const settings = readNativeSettings();
  const character = payload.character || {};
  const name = String(character.name || 'Персонаж').slice(0, 80);
  const fields = [
    `Ты — ${name}, персонаж интерактивной художественной ролевой истории.`,
    character.role && `Роль: ${String(character.role).slice(0, 180)}.`,
    character.personality && `Личность и детали: ${String(character.personality).slice(0, 1200)}.`,
    character.scenario && `Сеттинг: ${String(character.scenario).slice(0, 1000)}.`,
    character.style && `Стиль общения: ${String(character.style).slice(0, 300)}.`,
    'Отвечай на русском, оставайся последовательным и выразительным. Не описывай мысли, слова или действия собеседника за него; оставляй ему пространство для ответа. Не выходи из роли без необходимости.',
  ].filter(Boolean).join('\n');
  const messages = (payload.messages || []).slice(-24).filter((message) => ['user', 'assistant'].includes(message.role)).map((message) => ({
    role: message.role,
    content: String(message.content || '').slice(0, 6000),
  }));
  if (!messages.length) throw makeError('Добавь сообщение, чтобы начать диалог.', 400);
  const result = await nativeRequest('/chat/completions', {
    model: settings.chatModel,
    messages: [{ role: 'system', content: fields }, ...messages],
    temperature: 0.9,
    max_tokens: 900,
  });
  const answer = result?.choices?.[0]?.message?.content;
  const message = typeof answer === 'string'
    ? answer.trim()
    : Array.isArray(answer)
      ? answer.map((part) => part?.text || '').join('').trim()
      : '';
  if (!message) throw makeError('Модель вернула пустой ответ. Попробуй ещё раз.');
  return { message };
}

export async function generateAIImage(payload) {
  if (!isNativeApp) return fetchJson('/api/images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const settings = readNativeSettings();
  const prompt = String(payload.prompt || '').trim().slice(0, 1800);
  const character = payload.character || {};
  if (prompt.length < 3) throw makeError('Опиши, какое изображение нужно создать.', 400);
  const name = String(character.name || '').slice(0, 80);
  const description = String(character.personality || character.description || '').slice(0, 500);
  const fullPrompt = [
    name && `Персонаж: ${name}.`,
    description && `Внешность и детали персонажа: ${description}.`,
    `Сцена и пожелания пользователя: ${prompt}`,
    'Создай выразительное, цельное изображение. Не добавляй надписи и водяные знаки.',
  ].filter(Boolean).join('\n');
  const result = await nativeRequest('/images/generations', {
    model: settings.imageModel,
    prompt: fullPrompt,
    n: 1,
    size: '1024x1024',
  }, 150000);
  const item = result?.data?.[0];
  if (item?.url) return { imageUrl: item.url, prompt };
  if (item?.b64_json) return { imageUrl: `data:image/png;base64,${item.b64_json}`, prompt };
  throw makeError('Провайдер не вернул изображение. Проверь поддержку модели и endpoint /images/generations.');
}
