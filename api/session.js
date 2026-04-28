import {
  clearAccessCookie,
  createAccessCookie,
  enforceRequestQuota,
  hasValidAccessCookie,
  isValidAccessPassword,
  parseJsonBody,
  readRequestBody,
  requireBrowserRequest,
  sendJson
} from './_shared.js';

const MAX_SESSION_BODY_BYTES = 2048;
const SESSION_QUOTA = {
  name: 'session',
  windowMs: 15 * 60 * 1000,
  limit: 6,
  cooldownMs: 1500
};

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return sendJson(res, 200, { authenticated: hasValidAccessCookie(req) });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearAccessCookie());
    return sendJson(res, 200, { authenticated: false });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return sendJson(res, 405, { error: { message: 'Method not allowed.' } });
  }

  if (!requireBrowserRequest(req, res)) return;

  try {
    const releaseQuota = enforceRequestQuota(req, res, null, SESSION_QUOTA);
    if (!releaseQuota) return;

    const body = parseJsonBody(await readRequestBody(req, MAX_SESSION_BODY_BYTES));

    if (!isValidAccessPassword(body.password)) {
      return sendJson(res, 401, { error: { message: 'Invalid access password.' } });
    }

    const cookie = createAccessCookie(req);
    if (!cookie) {
      return sendJson(res, 500, { error: { message: 'Server access gate is not configured.' } });
    }

    res.setHeader('Set-Cookie', cookie);
    sendJson(res, 200, { authenticated: true });
    releaseQuota();
  } catch (error) {
    sendJson(res, error.statusCode || 400, {
      error: { message: error.statusCode ? error.message : 'Unable to create session.' }
    });
  }
}
