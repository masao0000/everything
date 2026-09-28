// 👍👎の学習結果を合言葉ごとに保存して、スマホと PC で同期する API
// Vercel の Upstash (Redis) 連携で自動設定される環境変数を使う
import { createHash } from 'node:crypto';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).result;
}

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  let s = '';
  for await (const c of req) s += c;
  return s;
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ error: 'sync_not_configured' });

  const pass = String(req.headers['x-sync-key'] || '');
  if (pass.length < 8) return res.status(400).json({ error: 'key_too_short' });
  const key = 'prefs:' + createHash('sha256').update(pass).digest('hex');

  try {
    if (req.method === 'GET') {
      const v = await redis(['GET', key]);
      return res.status(200).json(v ? JSON.parse(v) : null);
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (body.length > 200_000) return res.status(413).json({ error: 'too_large' });
      JSON.parse(body);
      await redis(['SET', key, body]);
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
