import { sendJson } from './_shared.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Allow', '');
  sendJson(res, 404, { error: { message: 'Not found.' } });
}
