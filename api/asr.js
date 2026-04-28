import { ALLOWED_ASR_MODELS, getTranscriptionsUrl, readRequestBody, requireApiKey, requireSiteSession, sendJson } from './_shared.js';

const MAX_ASR_UPLOAD_BYTES = 10 * 1024 * 1024;

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: { message: 'Method not allowed.' } });
  }

  if (!requireSiteSession(req, res)) return;

  const apiKey = requireApiKey(res);
  if (!apiKey) return;

  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return sendJson(res, 415, { error: { message: 'Expected multipart/form-data.' } });
  }

  try {
    const body = await readRequestBody(req, MAX_ASR_UPLOAD_BYTES);
    const requestedModel = getMultipartField(body, 'model');

    if (!ALLOWED_ASR_MODELS.has(requestedModel)) {
      return sendJson(res, 400, { error: { message: 'Unsupported ASR model.' } });
    }

    const upstream = await fetch(getTranscriptionsUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': contentType
      },
      body
    });

    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    res.end(text);
  } catch (error) {
    console.error('ASR proxy failed:', error);
    sendJson(res, error.statusCode || 502, {
      error: { message: error.statusCode === 413 ? '上传文件过大。' : 'ASR upstream request failed.' }
    });
  }
}

function getMultipartField(buffer, fieldName) {
  const text = buffer.toString('latin1');
  const match = text.match(new RegExp(`name="${fieldName}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`));
  return match?.[1]?.trim() || '';
}
