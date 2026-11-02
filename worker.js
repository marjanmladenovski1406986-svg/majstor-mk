import { neon } from '@neondatabase/serverless';

// ===== ПОДЕСУВАЊА =====
const ALLOWED_ORIGINS = ['https://majsto.mk', 'https://www.majsto.mk'];
const ADMIN_EMAILS = ['marjanmladenovski1406986@gmail.com', 'majsto.info@gmail.com'];
const FOUNDER_LIMIT = 50;
const IMAGE_LIMIT = 50;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const CATEGORIES = ['elektrika', 'vodovod', 'gradeznistvo', 'popravki', 'finalni', 'plockari', 'gipsari', 'stolari',
  'klima', 'greenje', 'krov', 'sanitarii', 'pvc', 'dvorovi', 'cistenje', 'opti', 'bravari', 'belatehnika',
  'videonadzor', 'bazeni', 'fasadi', 'iskop', 'hidroizolacija', 'otpad'];
// полиња што НИКОГАШ не се враќаат јавно
const HIDDEN_FIELDS = ['email', 'user_id', 'clerk_id', 'paid_until', 'payment_status', 'agreed_to_terms'];

// ===== ПОМОШНИ ФУНКЦИИ =====
function corsFor(request) {
  const origin = request.headers.get('Origin');
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status: status || 200, headers });
}
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function clean(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}
function parseId(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function normUrl(v) {
  let s = clean(v, 300);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch (e) { return null; }
}
function strip(row) {
  if (!row) return row;
  const o = { ...row };
  for (const k of HIDDEN_FIELDS) delete o[k];
  return o;
}
async function readBody(request) {
  try { return await request.json(); } catch (e) { return null; }
}
function profileFields(body) {
  const f = {
    name: clean(body.name, 100),
    phone: clean(body.phone, 30),
    city: clean(body.city, 60),
    category: clean(body.category, 40),
    description: clean(body.description, 2000) || '',
    facebook_url: normUrl(body.facebook_url),
    website_url: normUrl(body.website_url),
  };
  if (!f.name || !f.phone || !f.city || !f.category) {
    return { error: 'Име, телефон, град и категорија се задолжителни' };
  }
  if (!CATEGORIES.includes(f.category)) return { error: 'Невалидна категорија' };
  return { f };
}

// ===== CLERK =====
let jwksCache = null;
let jwksFetchedAt = 0;
async function getJwks(env, force) {
  const now = Date.now();
  if (jwksCache && !force) return jwksCache;
  if (jwksCache && now - jwksFetchedAt < 60000) return jwksCache;
  const res = await fetch('https://api.clerk.com/v1/jwks', {
    headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
  });
  if (!res.ok) throw new Error('JWKS fetch failed');
  jwksCache = await res.json();
  jwksFetchedAt = now;
  return jwksCache;
}
async function getUserId(request, env) {
  try {
    const m = (request.headers.get('Authorization') || '').match(/^Bearer (.+)$/i);
    if (!m) return null;
    const parts = m[1].split('.');
    if (parts.length !== 3) return null;
    const dec = new TextDecoder();
    const header = JSON.parse(dec.decode(b64urlToBytes(parts[0])));
    const payload = JSON.parse(dec.decode(b64urlToBytes(parts[1])));
    if (header.alg !== 'RS256') return null;
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) return null;
    if (payload.nbf && payload.nbf > now + 5) return null;
    if (payload.azp && !ALLOWED_ORIGINS.includes(payload.azp)) return null;
    if (env.CLERK_ISSUER && payload.iss !== env.CLERK_ISSUER) return null;
    if (!payload.sub) return null;
    let jwks = await getJwks(env, false);
    let jwk = jwks.keys.find((k) => k.kid === header.kid);
    if (!jwk) {
      jwks = await getJwks(env, true);
      jwk = jwks.keys.find((k) => k.kid === header.kid);
    }
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + '.' + parts[1]));
    return ok ? payload.sub : null;
  } catch (e) { return null; }
}
// Потврдена примарна е-пошта на корисникот (од Clerk, не од барањето)
const emailCache = new Map();
async function getClerkEmail(userId, env) {
  const hit = emailCache.get(userId);
  if (hit && Date.now() - hit.t < 300000) return hit.email;
  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
  });
  if (!res.ok) return null;
  const u = await res.json();
  const p = (u.email_addresses || []).find((e) => e.id === u.primary_email_address_id);
  const email = p && p.verification && p.verification.status === 'verified'
    ? String(p.email_address).toLowerCase() : null;
  emailCache.set(userId, { email, t: Date.now() });
  return email;
}

// Најди профил врз кој корисникот смее да работи (свој, или било кој ако е админ)
async function resolveTarget(sql, userId, admin, rawId) {
  const id = parseId(rawId);
  if (admin && id) return (await sql`SELECT * FROM majstori WHERE id=${id}`)[0] || null;
  if (id) return (await sql`SELECT * FROM majstori WHERE id=${id} AND user_id=${userId}`)[0] || null;
  return (await sql`SELECT * FROM majstori WHERE user_id=${userId} LIMIT 1`)[0] || null;
}

// ===== ГЛАВЕН WORKER =====
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Clerk Proxy (непроменето)
    if (url.hostname === 'clerk.majsto.mk') {
      const targetUrl = `https://frontend-api.clerk.services${url.pathname}${url.search}`;
      const newHeaders = new Headers(request.headers);
      newHeaders.set('host', 'frontend-api.clerk.services');
      return fetch(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.arrayBuffer() : undefined,
      });
    }

    const cors = corsFor(request);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // 2. Статични страници
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const headers = { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' };
    const out = (data, status) => json(data, status || 200, headers);
    const path = url.pathname;
    const method = request.method;

    try {
      if (!env.DATABASE_URL) return out({ error: 'Серверот не е подесен' }, 500);
      const sql = neon(env.DATABASE_URL);

      // ================= ЈАВНО ЧИТАЊЕ =================
      if (method === 'GET') {
        if (path === '/api/majstori') {
          if (url.searchParams.get('id')) {
            const id = parseId(url.searchParams.get('id'));
            if (!id) return out(null);
            const rows = await sql`SELECT * FROM majstori WHERE id=${id} LIMIT 1`;
            return out(rows[0] ? strip(rows[0]) : null);
          }
          const rows = await sql`SELECT * FROM majstori WHERE is_premium=true OR is_founder=true ORDER BY is_founder DESC, is_premium DESC, rating DESC, id DESC LIMIT 200`;
          return out(rows.map(strip));
        }
        if (path === '/api/media') {
          const mid = parseId(url.searchParams.get('majstor_id'));
          const rows = mid
            ? await sql`SELECT * FROM majstor_media WHERE majstor_id=${mid} AND type='image' ORDER BY id DESC`
            : await sql`SELECT * FROM majstor_media WHERE type='image' ORDER BY id DESC LIMIT 300`;
          return out(rows);
        }
        if (path === '/api/ratings') {
          const mid = parseId(url.searchParams.get('majstor_id'));
          const rows = mid
            ? await sql`SELECT * FROM ratings WHERE majstor_id=${mid} AND status='approved' ORDER BY created_at DESC`
            : await sql`SELECT * FROM ratings WHERE status='approved' ORDER BY created_at DESC LIMIT 100`;
          return out(rows.map(strip));
        }
        if (path === '/api/partners') {
          try {
            return out(await sql`SELECT * FROM partners ORDER BY id DESC`);
          } catch (e) { return out([]); }
        }
      }

      // ================= ЈАВНО ПИШУВАЊЕ =================
      if (method === 'POST' && path === '/api/track') {
        const body = (await readBody(request)) || {};
        const mid = parseId(body.majstor_id);
        if (mid && (body.type === 'view' || body.type === 'phone')) {
          try {
            if (body.type === 'view') await sql`UPDATE majstori SET views = COALESCE(views,0)+1 WHERE id=${mid}`;
            else await sql`UPDATE majstori SET phone_clicks = COALESCE(phone_clicks,0)+1 WHERE id=${mid}`;
            await sql`INSERT INTO majstor_stats (majstor_id, event_type) VALUES (${mid}, ${body.type})`;
          } catch (e) { console.log(e.message); }
        }
        return out({ success: true });
      }
      if (method === 'POST' && path === '/api/contact') {
        const body = (await readBody(request)) || {};
        const name = clean(body.name, 100), email = clean(body.email, 200), message = clean(body.message, 2000);
        if (!name || !email || !message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return out({ error: 'Пополни име, валидна е-пошта и порака' }, 400);
        }
        await sql`INSERT INTO contact_messages (name, email, message) VALUES (${name}, ${email}, ${message})`;
        return out({ success: true });
      }

      // ================= ПОТРЕБНА Е НАЈАВА =================
      const authed = (method === 'POST') ||
        (method === 'GET' && ['/api/my-profile', '/api/admin/majstori', '/api/admin/ratings'].includes(path));
      if (authed) {
        const userId = await getUserId(request, env);
        if (!userId) return out({ error: 'Мора да бидеш најавен' }, 401);

        let adminMemo = null;
        const getAdmin = async () => {
          if (adminMemo === null) {
            const em = await getClerkEmail(userId, env);
            adminMemo = !!em && ADMIN_EMAILS.includes(em);
          }
          return adminMemo;
        };
        const needAdmin = async () => (await getAdmin()) ? null : out({ error: 'Само за администратор' }, 403);

        // ---------- GET ----------
        if (method === 'GET') {
          if (path === '/api/my-profile') {
            const rows = await sql`SELECT * FROM majstori WHERE user_id=${userId} LIMIT 1`;
            return out(rows[0] || null);
          }
          const denied = await needAdmin();
          if (denied) return denied;
          if (path === '/api/admin/majstori') return out(await sql`SELECT * FROM majstori ORDER BY id DESC`);
          if (path === '/api/admin/ratings') return out(await sql`SELECT * FROM ratings ORDER BY created_at DESC LIMIT 300`);
        }

        // ---------- POST: корисник ----------
        if (method === 'POST') {
          // --- регистрација / поврзување на постоечки профил ---
          if (path === '/api/register-user') {
            const body = await readBody(request);
            if (!body) return out({ error: 'Невалидно барање' }, 400);
            const email = await getClerkEmail(userId, env);
            if (!email) return out({ error: 'Потребна е потврдена е-пошта' }, 400);

            // стар профил со иста потврдена е-пошта (од Supabase) -> поврзи го
            const claimed = await sql`
              UPDATE majstori SET user_id=${userId}, updated_at=NOW()
              WHERE LOWER(email)=${email} AND (user_id IS NULL OR user_id NOT LIKE 'user_%')
              RETURNING *`;
            if (claimed.length) {
              return out({ success: true, claimed: true, majstor: claimed[0], isFounder: !!claimed[0].is_founder });
            }

            const { f, error } = profileFields(body);
            if (error) return out({ error }, 400);

            const result = await sql`
              INSERT INTO majstori (user_id, email, name, phone, city, category, description, facebook_url, website_url,
                is_founder, founder_number, is_premium, paid_until, agreed_to_terms, created_at, rating, rating_count, views, phone_clicks)
              SELECT ${userId}::text, ${email}::text, ${f.name}::text, ${f.phone}::text, ${f.city}::text, ${f.category}::text,
                ${f.description}::text, ${f.facebook_url}::text, ${f.website_url}::text,
                x.c < ${FOUNDER_LIMIT}::int,
                CASE WHEN x.c < ${FOUNDER_LIMIT}::int THEN x.c + 1 END,
                true,
                CASE WHEN x.c < ${FOUNDER_LIMIT}::int THEN NULL ELSE NOW() + INTERVAL '1 year' END,
                true, NOW(), 0, 0, 0, 0
              FROM (SELECT COUNT(*)::int AS c FROM majstori WHERE is_founder = true) x
              WHERE NOT EXISTS (SELECT 1 FROM majstori WHERE user_id=${userId} OR LOWER(email)=${email})
              RETURNING *`;
            if (!result.length) return out({ error: 'Веќе имаш профил' }, 409);
            return out({ success: true, majstor: result[0], isFounder: !!result[0].is_founder });
          }

          // --- уредување профил ---
          if (path === '/api/update-profile') {
            const body = await readBody(request);
            if (!body) return out({ error: 'Невалидно барање' }, 400);
            const { f, error } = profileFields(body);
            if (error) return out({ error }, 400);
            const t = await resolveTarget(sql, userId, await getAdmin(), body.id);
            if (!t) return out({ error: 'Немаш дозвола или профилот не постои' }, 403);
            const rows = await sql`
              UPDATE majstori SET name=${f.name}, phone=${f.phone}, city=${f.city}, category=${f.category},
                description=${f.description}, facebook_url=${f.facebook_url}, website_url=${f.website_url}, updated_at=NOW()
              WHERE id=${t.id} RETURNING *`;
            return out({ success: true, majstor: rows[0] });
          }
          if (path === '/api/update-avatar' || path === '/api/update-cover') {
            const body = await readBody(request);
            const img = body && clean(body.url, 500);
            if (!img || !img.startsWith('https://i.ibb.co/')) return out({ error: 'Невалиден линк на слика' }, 400);
            const t = await resolveTarget(sql, userId, await getAdmin(), body.id);
            if (!t) return out({ error: 'Немаш дозвола' }, 403);
            if (path === '/api/update-avatar') await sql`UPDATE majstori SET photo_url=${img}, updated_at=NOW() WHERE id=${t.id}`;
            else await sql`UPDATE majstori SET cover_url=${img}, updated_at=NOW() WHERE id=${t.id}`;
            return out({ success: true });
          }

          // --- слики ---
          if (path === '/api/upload') {
            const admin = await getAdmin();
            const mine = await sql`SELECT id FROM majstori WHERE user_id=${userId} LIMIT 1`;
            if (!mine.length && !admin) return out({ error: 'Прво направи профил на мајстор' }, 403);
            const formData = await request.formData();
            const file = formData.get('file');
            if (!file || typeof file === 'string') return out({ error: 'Нема слика' }, 400);
            if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return out({ error: 'Дозволени се само JPG, PNG, WEBP и GIF' }, 400);
            if (file.size > MAX_UPLOAD_BYTES) return out({ error: 'Сликата е преголема (максимум 5 MB)' }, 413);
            const fd = new FormData();
            fd.append('image', file);
            const r = await fetch(`https://api.imgbb.com/1/upload?key=${env.IMGBB_API_KEY}`, { method: 'POST', body: fd });
            const result = await r.json();
            if (result.data && result.data.url) {
              return out({ secure_url: result.data.url, url: result.data.url, delete_url: result.data.delete_url || null });
            }
            console.error('ImgBB error', JSON.stringify(result.error || {}));
            return out({ error: 'Грешка при качување на сликата' }, 502);
          }
          if (path === '/api/add-media') {
            const body = await readBody(request);
            if (!body) return out({ error: 'Невалидно барање' }, 400);
            const mediaUrl = clean(body.url, 500);
            if (!mediaUrl || !mediaUrl.startsWith('https://i.ibb.co/')) return out({ error: 'Невалиден линк на слика' }, 400);
            const t = await resolveTarget(sql, userId, await getAdmin(), body.majstor_id);
            if (!t) return out({ error: 'Немаш дозвола за овој профил' }, 403);
            const cnt = await sql`SELECT COUNT(*)::int AS n FROM majstor_media WHERE majstor_id=${t.id} AND type='image'`;
            if (cnt[0].n >= IMAGE_LIMIT) return out({ error: `Лимитот од ${IMAGE_LIMIT} слики е достигнат` }, 403);
            const rows = await sql`
              INSERT INTO majstor_media (majstor_id, type, url, title, delete_url)
              VALUES (${t.id}, 'image', ${mediaUrl}, 'Слика од работа', ${clean(body.delete_url, 500)}) RETURNING *`;
            return out(rows[0]);
          }
          if (path === '/api/delete-media') {
            const body = await readBody(request);
            const id = body && parseId(body.id);
            if (!id) return out({ error: 'Невалидно барање' }, 400);
            const rows = (await getAdmin())
              ? await sql`DELETE FROM majstor_media WHERE id=${id} RETURNING id`
              : await sql`DELETE FROM majstor_media WHERE id=${id} AND majstor_id IN (SELECT id FROM majstori WHERE user_id=${userId}) RETURNING id`;
            if (!rows.length) return out({ error: 'Сликата не е пронајдена или не е твоја' }, 403);
            return out({ success: true });
          }

          // --- плаќање: корисникот јавува дека платил ---
          if (path === '/api/payment-request') {
            const rows = await sql`UPDATE majstori SET payment_status='pending', updated_at=NOW() WHERE user_id=${userId} RETURNING id`;
            if (!rows.length) return out({ error: 'Прво направи профил' }, 403);
            return out({ success: true });
          }

          // --- оценки ---
          if (path === '/api/add-rating') {
            const body = await readBody(request);
            const mid = body && parseId(body.majstor_id);
            const rating = body && Number(body.rating);
            if (!mid || !Number.isInteger(rating) || rating < 1 || rating > 5) return out({ error: 'Невалидна оценка' }, 400);
            const target = await sql`SELECT id, user_id FROM majstori WHERE id=${mid}`;
            if (!target.length) return out({ error: 'Мајсторот не постои' }, 404);
            if (target[0].user_id === userId) return out({ error: 'Не можеш да оцениш сам себе' }, 403);
            const rows = await sql`
              INSERT INTO ratings (majstor_id, user_id, rating, comment, status, created_at)
              SELECT ${mid}::int, ${userId}::text, ${rating}::int, ${clean(body.comment, 500)}::text, 'pending', NOW()
              WHERE NOT EXISTS (SELECT 1 FROM ratings WHERE majstor_id=${mid} AND user_id=${userId})
              RETURNING id`;
            if (!rows.length) return out({ error: 'Веќе си го оценил овој мајстор' }, 409);
            return out({ success: true, message: 'Оцената чека одобрување' });
          }

          // ---------- POST: само админ ----------
          const adminPaths = ['/api/admin-toggle', '/api/delete-majstor', '/api/approve-rating', '/api/partners', '/api/delete-partner'];
          if (adminPaths.includes(path)) {
            const denied = await needAdmin();
            if (denied) return denied;
            const body = (await readBody(request)) || {};

            if (path === '/api/admin-toggle') {
              const id = parseId(body.id);
              const val = body.value === true;
              if (!id) return out({ error: 'Невалидно барање' }, 400);
              if (body.field === 'is_founder') await sql`UPDATE majstori SET is_founder=${val}, updated_at=NOW() WHERE id=${id}`;
              else if (body.field === 'is_premium') await sql`UPDATE majstori SET is_premium=${val}, paid_until = CASE WHEN ${val}::boolean THEN NOW() + INTERVAL '1 year' ELSE paid_until END, payment_status = CASE WHEN ${val}::boolean THEN 'paid' ELSE payment_status END, updated_at=NOW() WHERE id=${id}`;
              else if (body.field === 'verified') await sql`UPDATE majstori SET verified=${val}, updated_at=NOW() WHERE id=${id}`;
              else return out({ error: 'Непознато поле' }, 400);
              return out({ success: true });
            }
            if (path === '/api/delete-majstor') {
              const id = parseId(body.id);
              if (!id) return out({ error: 'Невалидно барање' }, 400);
              await sql`DELETE FROM majstor_media WHERE majstor_id=${id}`;
              await sql`DELETE FROM ratings WHERE majstor_id=${id}`;
              await sql`DELETE FROM majstori WHERE id=${id}`;
              return out({ success: true });
            }
            if (path === '/api/approve-rating') {
              const id = parseId(body.id);
              if (!id || (body.action !== 'approve' && body.action !== 'reject')) return out({ error: 'Невалидно барање' }, 400);
              const status = body.action === 'approve' ? 'approved' : 'rejected';
              const rows = await sql`UPDATE ratings SET status=${status} WHERE id=${id} RETURNING majstor_id`;
              if (rows.length) {
                const mid = rows[0].majstor_id;
                await sql`
                  UPDATE majstori SET
                    rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 1) FROM ratings WHERE majstor_id=${mid} AND status='approved'), 0),
                    rating_count = (SELECT COUNT(*) FROM ratings WHERE majstor_id=${mid} AND status='approved')
                  WHERE id=${mid}`;
              }
              return out({ success: true });
            }
            if (path === '/api/partners') {
              const name = clean(body.name, 100), site = normUrl(body.website_url);
              if (!name || !site) return out({ error: 'Име и валиден вебсајт се задолжителни' }, 400);
              const logo = clean(body.logo_url, 500);
              const rows = await sql`
                INSERT INTO partners (name, description, logo_url, website_url)
                VALUES (${name}, ${clean(body.description, 300)}, ${logo && logo.startsWith('https://') ? logo : null}, ${site})
                RETURNING *`;
              return out(rows[0]);
            }
            if (path === '/api/delete-partner') {
              const id = parseId(body.id);
              if (!id) return out({ error: 'Невалидно барање' }, 400);
              await sql`DELETE FROM partners WHERE id=${id}`;
              return out({ success: true });
            }
          }
        }
      }

          // ===== РЕГИСТРАЦИЈА НА КЛИЕНТ =====
          if (path === "/api/register-client" && method === "POST") {
            const body = await request.json();
            if (!body.clerk_id || !body.email) {
              return out({ error: "Missing data" }, 400);
            }
            
            await sql`
              INSERT INTO clients (id, email, name)
              VALUES (${body.clerk_id}, ${body.email}, ${body.name || 'Клиент'})
              ON CONFLICT (id) DO NOTHING
            `;
            
            return out({ success: true });
          }
      



      
      return out({ error: 'Not Found' }, 404);
    } catch (error) {
      console.error('API error', error && error.message);
      return out({ error: 'Серверска грешка' }, 500);
    }
  },
};
