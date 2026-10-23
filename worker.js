// กล่องฝากไฟล์ (beersbox) — Cloudflare Worker API
// The page (public/index.html) encrypts everything in the browser with a key
// derived from the pickup code. This worker only stores encrypted bytes in KV.
//
// Bindings (wrangler.toml):
//   BOX       KV namespace
//   SEND_PIN  optional secret; when set, sending needs this PIN (receiving never does)

import PAGE from './index.html';

const MAX_CHUNK = 24 * 1024 * 1024;      // KV value limit is 25 MiB
const MAX_DROP = 64 * 1024;              // encrypted manifest
const MIN_TTL = 60;
const MAX_TTL = 30 * 24 * 3600;
const ID_RE = /^[a-f0-9]{32,64}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const fail = (status, error) => json({ error }, status);

function ttlOf(url) {
  const t = Math.floor(Number(url.searchParams.get('ttl')));
  return Number.isFinite(t) ? Math.min(MAX_TTL, Math.max(MIN_TTL, t)) : 86400;
}

function randomHex(bytes = 16) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function pinOk(req, env) {
  if (!env.SEND_PIN) return true;
  return timingSafeEqual(req.headers.get('x-send-pin') || '', String(env.SEND_PIN));
}

async function readLimited(req, limit) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > limit) return null;
  const buf = await req.arrayBuffer();
  return buf.byteLength > limit || buf.byteLength === 0 ? null : buf;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    const m = req.method;

    if (!path.startsWith('/api/')) {
      if (m !== 'GET' && m !== 'HEAD') return fail(405, 'method_not_allowed');
      return new Response(PAGE, { headers: {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      } });
    }
    if (!env.BOX) return fail(500, 'storage_not_bound');

    // GET /api/config
    if (path === '/api/config' && m === 'GET') return json({ pinRequired: !!env.SEND_PIN });

    // POST /api/check-pin
    if (path === '/api/check-pin' && m === 'POST') return pinOk(req, env) ? json({ ok: true }) : fail(403, 'bad_pin');

    // POST /api/blob?ttl=  -> store one encrypted chunk
    if (path === '/api/blob' && m === 'POST') {
      if (!pinOk(req, env)) return fail(403, 'bad_pin');
      const buf = await readLimited(req, MAX_CHUNK);
      if (!buf) return fail(413, 'chunk_too_large');
      const id = randomHex(16);
      await env.BOX.put('b:' + id, buf, { expirationTtl: ttlOf(url) + 3600 });
      return json({ id });
    }

    // GET /api/blob/:id
    let mm = path.match(/^\/api\/blob\/([a-f0-9]+)$/);
    if (mm && m === 'GET') {
      if (!ID_RE.test(mm[1])) return fail(404, 'not_found');
      const data = await env.BOX.get('b:' + mm[1], { type: 'arrayBuffer' });
      if (!data) return fail(404, 'not_found');
      return new Response(data, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, max-age=3600' } });
    }

    mm = path.match(/^\/api\/drop\/([a-f0-9]+)$/);
    if (mm) {
      const lid = mm[1];
      if (!ID_RE.test(lid)) return fail(404, 'not_found');
      const key = 'd:' + lid;

      // GET /api/drop/:lid -> encrypted manifest
      if (m === 'GET') {
        const rec = await env.BOX.get(key, { type: 'json' });
        if (!rec) return fail(404, 'not_found');
        if (rec.expiresAt && Date.now() > rec.expiresAt) return fail(410, 'expired');
        return json({ iv: rec.iv, ct: rec.ct, createdAt: rec.createdAt, expiresAt: rec.expiresAt });
      }

      // PUT /api/drop/:lid?ttl=  body {iv, ct, blobs:[ids]} -> {deleteToken}
      if (m === 'PUT') {
        if (!pinOk(req, env)) return fail(403, 'bad_pin');
        const buf = await readLimited(req, MAX_DROP);
        if (!buf) return fail(413, 'too_large');
        let body;
        try { body = JSON.parse(new TextDecoder().decode(buf)); } catch { return fail(400, 'bad_json'); }
        if (typeof body.iv !== 'string' || typeof body.ct !== 'string') return fail(400, 'bad_body');
        const blobs = Array.isArray(body.blobs) ? body.blobs.filter(b => typeof b === 'string' && ID_RE.test(b)).slice(0, 200) : [];
        if (await env.BOX.get(key)) return fail(409, 'code_taken');
        const ttl = ttlOf(url);
        const deleteToken = randomHex(16);
        const now = Date.now();
        await env.BOX.put(key, JSON.stringify({
          iv: body.iv, ct: body.ct, blobs, createdAt: now, expiresAt: now + ttl * 1000,
          del: await sha256Hex(deleteToken),
        }), { expirationTtl: ttl });
        return json({ deleteToken, expiresAt: now + ttl * 1000 });
      }

      // DELETE /api/drop/:lid  header x-delete-token
      if (m === 'DELETE') {
        const rec = await env.BOX.get(key, { type: 'json' });
        if (!rec) return json({ deleted: false });
        const tok = req.headers.get('x-delete-token') || '';
        if (!timingSafeEqual(await sha256Hex(tok), rec.del)) return fail(403, 'bad_token');
        await Promise.all([env.BOX.delete(key), ...(rec.blobs || []).map(b => env.BOX.delete('b:' + b))]);
        return json({ deleted: true });
      }
    }

    // DELETE /api/blob/:id — clean up chunks from a send that failed half-way
    mm = path.match(/^\/api\/blob\/([a-f0-9]+)$/);
    if (mm && m === 'DELETE') {
      if (!pinOk(req, env)) return fail(403, 'bad_pin');
      if (ID_RE.test(mm[1])) await env.BOX.delete('b:' + mm[1]);
      return json({ deleted: true });
    }

    return fail(404, 'not_found');
  },
};
