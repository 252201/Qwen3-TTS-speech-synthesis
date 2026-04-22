const DEFAULT_UPSTREAM_SPEECH_URL = 'https://api.252202.xyz/v1/audio/speech';

export const ALLOWED_TTS_MODELS = new Set([
  'Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit',
  'Qwen3-TTS-12Hz-1.7B-Base-8bit'
]);

export const ALLOWED_ASR_MODELS = new Set([
  'Qwen3-ASR-1.7B-8bit'
]);

export const ALLOWED_VOICES = new Set([
  'vivian',
  'serena',
  'uncle_fu',
  'dylan',
  'eric',
  'ryan',
  'aiden',
  'ono_anna',
  'sohee',
  'alloy'
]);

export function getUpstreamSpeechUrl() {
  return process.env.TTS_API_HOST || DEFAULT_UPSTREAM_SPEECH_URL;
}

export function getUpstreamApiKey() {
  return process.env.TTS_API_KEY;
}

export function getModelsUrl() {
  return getUpstreamSpeechUrl().replace(/\/audio\/speech\/?$/, '/models');
}

export function getTranscriptionsUrl() {
  return getUpstreamSpeechUrl().replace(/\/audio\/speech\/?$/, '/audio/transcriptions');
}

export function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function requireApiKey(res) {
  const apiKey = getUpstreamApiKey();
  if (!apiKey) {
    sendJson(res, 500, { error: { message: 'Server is missing TTS_API_KEY.' } });
    return null;
  }
  return apiKey;
}

export async function readRequestBody(req, limitBytes) {
  if (req.body !== undefined && req.body !== null) {
    const bodyBuffer = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === 'string'
        ? Buffer.from(req.body)
        : Buffer.from(JSON.stringify(req.body));

    if (bodyBuffer.length > limitBytes) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }

    return bodyBuffer;
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > limitBytes) {
    const error = new Error('Request body is too large.');
    error.statusCode = 413;
    throw error;
  }

  const chunks = [];
  let received = 0;

  for await (const chunk of req) {
    received += chunk.length;
    if (received > limitBytes) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export function parseJsonBody(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
}

export function clampString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}
