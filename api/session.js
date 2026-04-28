import {
  clearAccessCookie,
  createAccessCookie,
  hasValidAccessCookie,
  isValidAccessPassword,
  parseJsonBody,
  readRequestBody,
  sendJson
} from './_shared.js';

const MAX_SESSION_BODY_BYTES = 2048;

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

  try {
    const body = parseJsonBody(await readRequestBody(req, MAX_SESSION_BODY_BYTES));

    if (!isValidAccessPassword(body.password)) {
      return sendJson(res, 401, { error: { message: 'Invalid access password.' } });
    }

    const cookie = createAccessCookie();
    if (!cookie) {
      return sendJson(res, 500, { error: { message: 'Server access gate is not configured.' } });
    }

    res.setHeader('Set-Cookie', cookie);
    sendJson(res, 200, { authenticated: true });
  } catch (error) {
    sendJson(res, error.statusCode || 400, {
      error: { message: error.statusCode ? error.message : 'Unable to create session.' }
    });
  }
}
