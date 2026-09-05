// api/cleanup-status.js — Vercel Serverless Function
// Hapus file media (foto/video) Cloudinary milik status yang SUDAH
// expired. Dipanggil dari client (js/status.js) secara opportunistik.
//
// Aman dipanggil publik: endpoint ini HANYA menghapus media yang
// public_id-nya dikirim client — dan client sendiri hanya bisa tahu
// public_id itu dari baris status yang sudah expired (RLS di database
// cuma izinkan baca baris expired atau punya sendiri, lihat sql/11-status.sql).
// Kalaupun disalahgunakan, dampak paling buruk cuma "coba hapus file yang
// memang sudah kadaluarsa" — tidak bisa dipakai membocorkan/menghapus data lain.

const ALLOWED_ORIGINS = [
  'https://xrzzky-chatroom.vercel.app',
  'https://xrezzky-chatroom.vercel.app',
  'https://rezzkystoreidn.github.io',
  'https://hatroom-eight.vercel.app',
  'https://xrezzky-chatroom-eight.vercel.app',
  'https://chat.xrezzkybeta.my.id',
  'https://xrezzky.com',
];

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'Forbidden' });

  const CLOUD  = process.env.CLOUDINARY_CLOUD;
  const KEY    = process.env.CLOUDINARY_KEY;
  const SECRET = process.env.CLOUDINARY_SECRET;

  if (!CLOUD || !KEY || !SECRET) {
    return res.status(500).json({ error: 'Cloudinary ENV tidak dikonfigurasi' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const items = Array.isArray(body?.items) ? body.items.slice(0, 50) : []; // batas 50/panggilan

  if (!items.length) return res.status(200).json({ deleted: 0 });

  const crypto = await import('crypto');
  const results = [];

  for (const item of items) {
    const publicId = String(item?.publicId || '').trim();
    const resourceType = item?.resourceType === 'video' ? 'video' : 'image';
    if (!publicId) continue;

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const toSign = `public_id=${publicId}&timestamp=${timestamp}${SECRET}`;
      const signature = crypto.createHash('sha1').update(toSign).digest('hex');

      const form = new URLSearchParams();
      form.append('public_id', publicId);
      form.append('timestamp', String(timestamp));
      form.append('api_key', KEY);
      form.append('signature', signature);

      const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/${resourceType}/destroy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      const j = await r.json().catch(() => ({}));
      results.push({ publicId, ok: r.ok && (j.result === 'ok' || j.result === 'not found'), result: j.result });
    } catch (e) {
      results.push({ publicId, ok: false, error: e.message });
    }
  }

  return res.status(200).json({ deleted: results.filter(r => r.ok).length, results });
}
