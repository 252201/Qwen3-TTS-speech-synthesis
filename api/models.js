import { getModelsUrl, requireApiKey, requireSiteSession, sendJson } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: { message: 'Method not allowed.' } });
  }

  if (!requireSiteSession(req, res)) return;

  const apiKey = requireApiKey(res);
  if (!apiKey) return;

  try {
    const upstream = await fetch(getModelsUrl(), {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    res.end(text);
  } catch (error) {
    console.error('Models proxy failed:', error);
    sendJson(res, 502, { error: { message: 'Models upstream request failed.' } });
  }
}
