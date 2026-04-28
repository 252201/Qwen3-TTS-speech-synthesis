import {
  ALLOWED_TTS_MODELS,
  ALLOWED_VOICES,
  clampString,
  getUpstreamSpeechUrl,
  parseJsonBody,
  readRequestBody,
  requireApiKey,
  requireSiteSession,
  sendJson
} from './_shared.js';

const MAX_TTS_BODY_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_LENGTH = 1000;
const MAX_INSTRUCTIONS_LENGTH = 240;
const MAX_REF_TEXT_LENGTH = 2000;
const MAX_REF_AUDIO_BASE64_LENGTH = 7 * 1024 * 1024;

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
  if (!contentType.toLowerCase().includes('application/json')) {
    return sendJson(res, 415, { error: { message: 'Expected application/json.' } });
  }

  try {
    const bodyBuffer = await readRequestBody(req, MAX_TTS_BODY_BYTES);
    const clientBody = parseJsonBody(bodyBuffer);
    const upstreamBody = buildSafeTtsBody(clientBody);

    const upstream = await fetch(getUpstreamSpeechUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(upstreamBody)
    });

    const responseBuffer = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(responseBuffer);
  } catch (error) {
    console.error('TTS proxy failed:', error);
    sendJson(res, error.statusCode || 502, {
      error: { message: error.statusCode ? error.message : 'TTS upstream request failed.' }
    });
  }
}

function buildSafeTtsBody(clientBody) {
  const model = clampString(clientBody.model, 80);
  const voice = clampString(clientBody.voice, 40);
  const input = clampString(clientBody.input, MAX_INPUT_LENGTH);
  const instructions = clampString(clientBody.instructions, MAX_INSTRUCTIONS_LENGTH);
  const responseFormat = clampString(clientBody.response_format, 12) || 'wav';
  const refAudio = typeof clientBody.ref_audio === 'string' ? clientBody.ref_audio : '';
  const refText = clampString(clientBody.ref_text, MAX_REF_TEXT_LENGTH);

  if (!ALLOWED_TTS_MODELS.has(model)) {
    const error = new Error('Unsupported TTS model.');
    error.statusCode = 400;
    throw error;
  }

  if (!ALLOWED_VOICES.has(voice)) {
    const error = new Error('Unsupported voice.');
    error.statusCode = 400;
    throw error;
  }

  if (!input) {
    const error = new Error('Input text is required.');
    error.statusCode = 400;
    throw error;
  }

  if (responseFormat !== 'wav') {
    const error = new Error('Only wav output is allowed.');
    error.statusCode = 400;
    throw error;
  }

  if (refAudio.length > MAX_REF_AUDIO_BASE64_LENGTH) {
    const error = new Error('Reference audio is too large.');
    error.statusCode = 413;
    throw error;
  }

  const safeBody = {
    model,
    input,
    voice,
    max_tokens: 4096,
    response_format: 'wav'
  };

  if (instructions) {
    safeBody.instructions = instructions;
  }

  if (refAudio) {
    if (!model.includes('Base')) {
      const error = new Error('Reference audio requires a Base clone model.');
      error.statusCode = 400;
      throw error;
    }
    if (!refText) {
      const error = new Error('Reference text is required when reference audio is provided.');
      error.statusCode = 400;
      throw error;
    }
    safeBody.ref_audio = refAudio;
    safeBody.ref_text = refText;
  }

  return safeBody;
}
