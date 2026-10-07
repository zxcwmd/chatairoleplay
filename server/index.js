import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.APP_DATA_DIR || path.join(rootDir, 'data'));
const generatedDir = path.join(dataDir, 'generated');
const settingsPath = path.join(dataDir, 'settings.json');
const isProduction = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 5173);

const defaults = {
  baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  apiKey: process.env.AI_API_KEY || '',
  chatModel: process.env.AI_CHAT_MODEL || 'gpt-4o-mini',
  imageModel: process.env.AI_IMAGE_MODEL || 'gpt-image-1',
};

await fs.mkdir(generatedDir, { recursive: true });
let settings = { ...defaults };
try {
  const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  settings = { ...settings, ...saved };
} catch (error) {
  if (error.code !== 'ENOENT') console.warn('Could not read saved AI settings:', error.message);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use('/media', express.static(generatedDir, {
  maxAge: '7d',
  immutable: true,
  fallthrough: false,
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));

const cleanString = (value, maxLength = 2000) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

function publicSettings() {
  return {
    baseUrl: settings.baseUrl,
    chatModel: settings.chatModel,
    imageModel: settings.imageModel,
    apiKeySet: Boolean(settings.apiKey),
    configured: Boolean(settings.apiKey && settings.chatModel),
  };
}

function normalizedBaseUrl(value) {
  const cleaned = cleanString(value, 500).replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error('Укажите корректный адрес API, например https://api.openai.com/v1.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Адрес API должен начинаться с http:// или https://.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Уберите логин, пароль, параметры и # из адреса API.');
  }
  return cleaned;
}

async function persistSettings() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(settingsPath, 0o600).catch(() => {});
}

function requireApiKey(res) {
  if (!settings.apiKey) {
    res.status(409).json({ error: 'Сначала добавьте API-ключ в разделе «Настройки». Ключ хранится на сервере этого приложения.' });
    return false;
  }
  return true;
}

async function upstream(pathname, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function providerError(response) {
  const body = await response.json().catch(() => null);
  const message = cleanString(body?.error?.message || body?.message || '', 800);
  const fallback = response.status === 401 || response.status === 403
    ? 'Провайдер отклонил ключ. Проверьте API-ключ и адрес.'
    : `Провайдер вернул ошибку ${response.status}. Проверьте модель и настройки.`;
  return message || fallback;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: publicSettings().configured });
});

app.get('/api/settings', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(publicSettings());
});

app.put('/api/settings', async (req, res) => {
  try {
    if (req.body?.baseUrl !== undefined) settings.baseUrl = normalizedBaseUrl(req.body.baseUrl);
    if (req.body?.chatModel !== undefined) settings.chatModel = cleanString(req.body.chatModel, 160);
    if (req.body?.imageModel !== undefined) settings.imageModel = cleanString(req.body.imageModel, 160);
    if (req.body?.clearApiKey === true) settings.apiKey = '';
    else if (typeof req.body?.apiKey === 'string' && req.body.apiKey.trim()) {
      settings.apiKey = req.body.apiKey.trim().slice(0, 2000);
    }
    if (!settings.chatModel) throw new Error('Введите название текстовой модели.');
    if (!settings.imageModel) throw new Error('Введите название модели изображений.');
    await persistSettings();
    res.json(publicSettings());
  } catch (error) {
    res.status(400).json({ error: cleanString(error.message, 500) || 'Не удалось сохранить настройки.' });
  }
});

app.post('/api/settings/test', async (_req, res) => {
  if (!requireApiKey(res)) return;
  try {
    const response = await upstream('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: settings.chatModel,
        messages: [{ role: 'user', content: 'Ответь одним словом: готово.' }],
        max_tokens: 16,
        temperature: 0,
      }),
    }, 25000);
    if (!response.ok) return res.status(response.status >= 500 ? 502 : response.status).json({ error: await providerError(response) });
    const result = await response.json();
    res.json({ ok: true, model: settings.chatModel, reply: cleanString(result?.choices?.[0]?.message?.content, 120) });
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Проверка заняла слишком много времени.' : cleanString(error.message, 500);
    res.status(502).json({ error: message || 'Не удалось связаться с провайдером.' });
  }
});

app.post('/api/chat', async (req, res) => {
  if (!requireApiKey(res)) return;
  const character = req.body?.character || {};
  const name = cleanString(character.name, 80) || 'Персонаж';
  const role = cleanString(character.role, 180);
  const personality = cleanString(character.personality || character.description, 1200);
  const scenario = cleanString(character.scenario, 1000);
  const style = cleanString(character.style, 300);
  const incoming = Array.isArray(req.body?.messages) ? req.body.messages.slice(-24) : [];
  const messages = incoming
    .filter((message) => ['user', 'assistant'].includes(message?.role) && typeof message?.content === 'string')
    .map((message) => ({ role: message.role, content: cleanString(message.content, 6000) }))
    .filter((message) => message.content);

  if (!messages.length) return res.status(400).json({ error: 'Добавьте сообщение, чтобы начать диалог.' });
  const systemPrompt = [
    `Ты — ${name}, персонаж интерактивной художественной ролевой истории.`,
    role && `Роль: ${role}.`,
    personality && `Личность и детали: ${personality}.`,
    scenario && `Сеттинг: ${scenario}.`,
    style && `Стиль общения: ${style}.`,
    'Отвечай на русском, оставайся последовательным и выразительным. Не описывай мысли, слова или действия собеседника за него; оставляй ему пространство для ответа. Не выходи из роли без необходимости.',
  ].filter(Boolean).join('\n');

  try {
    const response = await upstream('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: settings.chatModel,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.9,
        max_tokens: 900,
      }),
    });
    if (!response.ok) return res.status(response.status >= 500 ? 502 : response.status).json({ error: await providerError(response) });
    const result = await response.json();
    const answer = result?.choices?.[0]?.message?.content;
    const text = typeof answer === 'string'
      ? answer.trim()
      : Array.isArray(answer)
        ? answer.map((part) => part?.text || '').join('').trim()
        : '';
    if (!text) return res.status(502).json({ error: 'Модель вернула пустой ответ. Попробуйте ещё раз.' });
    res.json({ message: text });
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Модель отвечает слишком долго. Попробуйте ещё раз.' : cleanString(error.message, 500);
    res.status(502).json({ error: message || 'Не удалось получить ответ от модели.' });
  }
});

app.post('/api/images', async (req, res) => {
  if (!requireApiKey(res)) return;
  const prompt = cleanString(req.body?.prompt, 1800);
  const character = req.body?.character || {};
  const name = cleanString(character.name, 80);
  const description = cleanString(character.personality || character.description, 500);
  if (prompt.length < 3) return res.status(400).json({ error: 'Опишите, какое изображение нужно создать.' });

  const fullPrompt = [
    name && `Персонаж: ${name}.`,
    description && `Внешность и детали персонажа: ${description}.`,
    `Сцена и пожелания пользователя: ${prompt}`,
    'Создай выразительное, цельное изображение. Не добавляй надписи и водяные знаки.',
  ].filter(Boolean).join('\n');

  try {
    const response = await upstream('/images/generations', {
      method: 'POST',
      body: JSON.stringify({ model: settings.imageModel, prompt: fullPrompt, n: 1, size: '1024x1024' }),
    }, 150000);
    if (!response.ok) return res.status(response.status >= 500 ? 502 : response.status).json({ error: await providerError(response) });
    const result = await response.json();
    const item = result?.data?.[0];
    if (item?.url) {
      let parsed;
      try { parsed = new URL(item.url); } catch { parsed = null; }
      if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(502).json({ error: 'Провайдер вернул некорректную ссылку на изображение.' });
      }
      return res.json({ imageUrl: parsed.toString(), prompt });
    }
    if (item?.b64_json) {
      const base64 = item.b64_json.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      if (!buffer.length || buffer.length > 20 * 1024 * 1024) {
        return res.status(502).json({ error: 'Получено пустое или слишком большое изображение.' });
      }
      let extension = 'png';
      if (buffer[0] === 0xff && buffer[1] === 0xd8) extension = 'jpg';
      else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') extension = 'webp';
      else if (buffer.toString('ascii', 0, 6).startsWith('GIF8')) extension = 'gif';
      const filename = `${crypto.randomUUID()}.${extension}`;
      await fs.writeFile(path.join(generatedDir, filename), buffer, { mode: 0o644 });
      return res.json({ imageUrl: `/media/${filename}`, prompt });
    }
    res.status(502).json({ error: 'Провайдер не вернул изображение. Проверьте совместимость модели изображений.' });
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Генерация заняла слишком много времени.' : cleanString(error.message, 500);
    res.status(502).json({ error: message || 'Не удалось создать изображение.' });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API-маршрут не найден.' }));

if (isProduction) {
  const distDir = path.join(rootDir, 'dist');
  app.use(express.static(distDir, { index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: rootDir,
    configFile: path.join(rootDir, 'vite.config.js'),
    server: { middlewareMode: true, host: '0.0.0.0', allowedHosts: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Миры — ${isProduction ? 'production' : 'development'} server running on http://0.0.0.0:${port}`);
});
