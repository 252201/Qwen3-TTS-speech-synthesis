import crypto from 'node:crypto';

const DEFAULT_UPSTREAM_SPEECH_URL = 'https://api.252202.xyz/v1/audio/speech';
const ACCESS_COOKIE_NAME = 'qwen3_access';
const ACCESS_SESSION_TTL_SECONDS = 12 * 60 * 60;

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

export function requireSiteSession(req, res) {
  const password = process.env.SITE_ACCESS_PASSWORD;
  const secret = process.env.SESSION_SECRET;

  if (!password || !secret) {
    sendJson(res, 500, { error: { message: 'Server access gate is not configured.' } });
    return false;
  }

  const token = parseCookies(req.headers.cookie || '')[ACCESS_COOKIE_NAME];
  if (verifyAccessToken(token, secret)) return true;

  sendJson(res, 401, { error: { message: 'Authentication required.' } });
  return false;
}

export function isValidAccessPassword(value) {
  const expected = process.env.SITE_ACCESS_PASSWORD;
  if (!expected || typeof value !== 'string') return false;

  return timingSafeEqualString(value, expected);
}

export function createAccessCookie() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_SESSION_TTL_SECONDS;
  const signature = signAccessValue(String(expiresAt), secret);
  const token = `${expiresAt}.${signature}`;

  return [
    `${ACCESS_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${ACCESS_SESSION_TTL_SECONDS}`
  ].join('; ');
}

export function clearAccessCookie() {
  return `${ACCESS_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function hasValidAccessCookie(req) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const token = parseCookies(req.headers.cookie || '')[ACCESS_COOKIE_NAME];
  return verifyAccessToken(token, secret);
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

function verifyAccessToken(token, secret) {
  if (typeof token !== 'string') return false;

  const [expiresAtRaw, signature] = token.split('.');
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  return timingSafeEqualString(signature, signAccessValue(expiresAtRaw, secret));
}

function signAccessValue(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function timingSafeEqualString(actual = '', expected = '') {
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));

  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseCookies(cookieHeader) {
  return cookieHeader
    .split(';')
    .map(cookie => cookie.trim())
    .filter(Boolean)
    .reduce((cookies, cookie) => {
      const separatorIndex = cookie.indexOf('=');
      if (separatorIndex === -1) return cookies;

      const name = cookie.slice(0, separatorIndex);
      const value = cookie.slice(separatorIndex + 1);
      cookies[name] = value;
      return cookies;
    }, {});
}
