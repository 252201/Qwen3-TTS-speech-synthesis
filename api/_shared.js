import crypto from 'node:crypto';

const DEFAULT_UPSTREAM_SPEECH_URL = 'https://api.252202.xyz/v1/audio/speech';
const ACCESS_COOKIE_NAME = 'qwen3_access';
const ACCESS_SESSION_TTL_SECONDS = 12 * 60 * 60;
const ACCESS_SESSION_VERSION = 2;
const MAX_SECURITY_STATE_ENTRIES = 2000;

const securityState = globalThis.__qwen3TtsSecurityState ||= {
  windows: new Map(),
  inFlight: new Map()
};

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
  const session = verifyAccessToken(token, secret, req);
  if (session) return session;

  sendJson(res, 401, { error: { message: 'Authentication required.' } });
  return false;
}

export function isValidAccessPassword(value) {
  const expected = process.env.SITE_ACCESS_PASSWORD;
  if (!expected || typeof value !== 'string') return false;

  return timingSafeEqualString(value, expected);
}

export function createAccessCookie(req) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_SESSION_TTL_SECONDS;
  const payload = {
    v: ACCESS_SESSION_VERSION,
    sid: crypto.randomUUID(),
    exp: expiresAt,
    fp: getClientFingerprint(req)
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signAccessValue(encodedPayload, secret);
  const token = `${encodedPayload}.${signature}`;

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
  return Boolean(verifyAccessToken(token, secret, req));
}

export function requireBrowserRequest(req, res) {
  const secFetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (secFetchSite === 'same-origin' || secFetchSite === 'same-site') return true;

  const host = getHeaderValue(req, 'x-forwarded-host') || getHeaderValue(req, 'host');
  const originHost = getUrlHost(getHeaderValue(req, 'origin'));
  const refererHost = getUrlHost(getHeaderValue(req, 'referer'));

  if (host && (originHost === host || refererHost === host)) return true;

  sendJson(res, 403, { error: { message: 'Browser-origin request required.' } });
  return false;
}

export function enforceRequestQuota(req, res, session, {
  name,
  windowMs,
  limit,
  cooldownMs = 0,
  maxConcurrent = 0
}) {
  const now = Date.now();
  const principal = session?.sid || getClientFingerprint(req);
  const key = `${name}:${principal}:${getClientIpScope(req)}`;
  const timestamps = (securityState.windows.get(key) || []).filter(timestamp => now - timestamp < windowMs);

  if (timestamps.length >= limit) {
    return denyQuota(res, Math.ceil((windowMs - (now - timestamps[0])) / 1000));
  }

  const lastRequestAt = timestamps.at(-1);
  if (lastRequestAt && cooldownMs > 0 && now - lastRequestAt < cooldownMs) {
    return denyQuota(res, Math.ceil((cooldownMs - (now - lastRequestAt)) / 1000));
  }

  let inFlightKey = null;
  if (maxConcurrent > 0) {
    inFlightKey = `flight:${key}`;
    pruneInFlight(now);
    if ((securityState.inFlight.get(inFlightKey) || 0) >= maxConcurrent) {
      return denyQuota(res, 20, 'A request is already running. Please wait for it to finish.');
    }
    securityState.inFlight.set(inFlightKey, (securityState.inFlight.get(inFlightKey) || 0) + 1);
  }

  timestamps.push(now);
  securityState.windows.set(key, timestamps);
  pruneSecurityWindows(now);

  return () => {
    if (!inFlightKey) return;

    const nextCount = (securityState.inFlight.get(inFlightKey) || 1) - 1;
    if (nextCount <= 0) {
      securityState.inFlight.delete(inFlightKey);
    } else {
      securityState.inFlight.set(inFlightKey, nextCount);
    }
  };
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

function verifyAccessToken(token, secret, req) {
  if (typeof token !== 'string') return false;

  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return false;
  if (!timingSafeEqualString(signature, signAccessValue(encodedPayload, secret))) {
    return false;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return false;
  }

  if (
    payload?.v !== ACCESS_SESSION_VERSION ||
    typeof payload.sid !== 'string' ||
    typeof payload.fp !== 'string' ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    return false;
  }

  if (!timingSafeEqualString(payload.fp, getClientFingerprint(req))) {
    return false;
  }

  return {
    sid: payload.sid,
    expiresAt: payload.exp
  };
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

function denyQuota(res, retryAfterSeconds, message = 'Too many requests. Please slow down.') {
  res.setHeader('Retry-After', String(Math.max(1, retryAfterSeconds)));
  sendJson(res, 429, { error: { message } });
  return null;
}

function pruneSecurityWindows(now) {
  if (securityState.windows.size <= MAX_SECURITY_STATE_ENTRIES) return;

  for (const [key, timestamps] of securityState.windows) {
    const fresh = timestamps.filter(timestamp => now - timestamp < 15 * 60 * 1000);
    if (fresh.length) {
      securityState.windows.set(key, fresh);
    } else {
      securityState.windows.delete(key);
    }

    if (securityState.windows.size <= MAX_SECURITY_STATE_ENTRIES) break;
  }
}

function pruneInFlight(now) {
  for (const [key, count] of securityState.inFlight) {
    if (count <= 0) securityState.inFlight.delete(key);
  }

  if (now && securityState.inFlight.size > MAX_SECURITY_STATE_ENTRIES) {
    securityState.inFlight.clear();
  }
}

function getClientFingerprint(req) {
  const userAgent = getHeaderValue(req, 'user-agent').slice(0, 240);
  return hashCompact(`${getClientIpScope(req)}|${userAgent}`);
}

function getClientIpScope(req) {
  const ip = getHeaderValue(req, 'x-forwarded-for').split(',')[0].trim() ||
    getHeaderValue(req, 'x-real-ip') ||
    req.socket?.remoteAddress ||
    'unknown';

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }

  if (ip.includes(':')) {
    return ip.split(':').slice(0, 4).join(':') || ip;
  }

  return ip;
}

function getHeaderValue(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || '';
  return String(value || '');
}

function getUrlHost(value) {
  if (!value) return '';
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

function hashCompact(value) {
  return crypto.createHash('sha256').update(value).digest('base64url').slice(0, 24);
}
