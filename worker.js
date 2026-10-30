import { neon } from '@neondatabase/serverless';

// ===== ПОДЕСУВАЊА =====
const ALLOWED_ORIGINS = ['https://majsto.mk', 'https://www.majsto.mk'];
const FREE_IMAGE_LIMIT = 5;      // основен пакет
const PREMIUM_IMAGE_LIMIT = 15;  // премиум пакет (смени на 50 ако сакаш)
const FREE_PREMIUM_SPOTS = 100;  // првите 100 мајстори добиваат премиум
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// ===== ПОМОШНИ ФУНКЦИИ =====
function corsFor(request) {
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
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

function clean(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

// ===== CLERK ПРОВЕРКА НА ТОКЕН =====
let jwksCache = null;
let jwksFetchedAt = 0;

async function getJwks(env, force) {
  const now = Date.now();
  if (jwksCache && !force) return jwksCache;
  // не повикувај го Clerk почесто од еднаш во 60 секунди
  if (jwksCache && now - jwksFetchedAt < 60000) return jwksCache;
  const res = await fetch('https://api.clerk.com/v1/jwks', {
    headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
  });
  if (!res.ok) throw new Error('JWKS fetch failed');
  jwksCache = await res.json();
  jwksFetchedAt = now;
  return jwksCache;
}

// Враќа Clerk userId (sub) ако токенот е валиден, инаку null
async function getUserId(request, env) {
  try {
    const auth = request.headers.get('Authorization') || '';
    const m = auth.match(/^Bearer (.+)$/i);
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

    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + '.' + parts[1])
    );
    return valid ? payload.sub : null;
  } catch (e) {
    return null;
  }
}

async function readBody(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}

// ===== ГЛАВЕН WORKER =====
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Clerk Proxy (за најава) - непроменето
    if (url.hostname === 'clerk.majsto.mk') {
      return fetch(`https://frontend-api.clerk.services${url.pathname}${url.search}`, request);
    }

    // 2. CORS
    const cors = corsFor(request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // 3. API
    if (url.pathname.startsWith('/api/')) {
      const headers = {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      };
      const path = url.pathname;
      const method = request.method;

      try {
        const sql = neon(env.DATABASE_URL);

        // ---------- ЈАВНО ЧИТАЊЕ ----------
        if (path === '/api/majstori' && method === 'GET') {
          const rows = await sql`SELECT * FROM majstori ORDER BY is_premium DESC, rating DESC`;
          return json(rows, 200, headers);
        }

        if (path === '/api/media' && method === 'GET') {
          const rows = await sql`SELECT * FROM majstor_media`;
          return json(rows, 200, headers);
        }

        if (path === '/api/ratings' && method === 'GET') {
          const rows = await sql`SELECT * FROM ratings WHERE status = 'approved'`;
          return json(rows, 200, headers);
        }

        // ---------- ОD ОВДЕ НАДОЛУ Е ПОТРЕБНА НАЈАВА ----------
        const protectedPaths = [
          '/api/upload',
          '/api/add-media',
          '/api/delete-media',
          '/api/update-majstor',
          '/api/register-majstor',
        ];
        if (protectedPaths.includes(path)) {
          if (method !== 'POST') {
            return json({ error: 'Методот не е дозволен' }, 405, headers);
          }
          const userId = await getUserId(request, env);
          if (!userId) {
            return json({ error: 'Мора да бидеш најавен' }, 401, headers);
          }

          // ===== КАЧУВАЊЕ НА СЛИКА НА IMGBB =====
          if (path === '/api/upload') {
            const formData = await request.formData();
            const file = formData.get('file');
            if (!file || typeof file === 'string') {
              return json({ error: 'Нема слика' }, 400, headers);
            }
            if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
              return json({ error: 'Дозволени се само JPG, PNG, WEBP и GIF слики' }, 400, headers);
            }
            if (file.size > MAX_UPLOAD_BYTES) {
              return json({ error: 'Сликата е преголема (максимум 5 MB)' }, 413, headers);
            }

            const imgbbData = new FormData();
            imgbbData.append('image', file);
            const imgbbRes = await fetch(
              `https://api.imgbb.com/1/upload?key=${env.IMGBB_API_KEY}`,
              { method: 'POST', body: imgbbData }
            );
            const result = await imgbbRes.json();

            if (result.data && result.data.url) {
              return json(
                { secure_url: result.data.url, delete_url: result.data.delete_url || null },
                200,
                headers
              );
            }
            console.error('ImgBB error', JSON.stringify(result.error || {}));
            return json({ error: 'Грешка при качување на сликата' }, 502, headers);
          }

          // ===== ЗАПИШУВАЊЕ НА ЛИНК ВО БАЗАТА =====
          if (path === '/api/add-media') {
            const body = await readBody(request);
            if (!body) return json({ error: 'Невалидно барање' }, 400, headers);

            const mediaUrl = clean(body.url, 500);
            if (!mediaUrl || !mediaUrl.startsWith('https://i.ibb.co/')) {
              return json({ error: 'Невалиден линк на слика' }, 400, headers);
            }

            // само сопственикот на профилот
            const owner = await sql`
              SELECT id, is_premium FROM majstori
              WHERE id = ${body.majstor_id} AND user_id = ${userId}
            `;
            if (owner.length === 0) {
              return json({ error: 'Немаш дозвола за овој профил' }, 403, headers);
            }

            const limit = owner[0].is_premium ? PREMIUM_IMAGE_LIMIT : FREE_IMAGE_LIMIT;
            const cnt = await sql`
              SELECT COUNT(*)::int AS n FROM majstor_media
              WHERE majstor_id = ${owner[0].id} AND type = 'image'
            `;
            if (cnt[0].n >= limit) {
              return json({ error: `Го достигна лимитот од ${limit} слики` }, 403, headers);
            }

            const result = await sql`
              INSERT INTO majstor_media (majstor_id, type, url, title, delete_url)
              VALUES (${owner[0].id}, 'image', ${mediaUrl}, 'Слика од работа', ${clean(body.delete_url, 500)})
              RETURNING *
            `;
            return json(result, 200, headers);
          }

          // ===== БРИШЕЊЕ НА СЛИКА =====
          if (path === '/api/delete-media') {
            const body = await readBody(request);
            if (!body || !body.id) return json({ error: 'Невалидно барање' }, 400, headers);

            const deleted = await sql`
              DELETE FROM majstor_media
              WHERE id = ${body.id}
                AND majstor_id IN (SELECT id FROM majstori WHERE user_id = ${userId})
              RETURNING id
            `;
            if (deleted.length === 0) {
              return json({ error: 'Сликата не е пронајдена или не е твоја' }, 403, headers);
            }
            return json({ success: true }, 200, headers);
          }

          // ===== АЖУРИРАЊЕ НА СОПСТВЕН ПРОФИЛ =====
          if (path === '/api/update-majstor') {
            const body = await readBody(request);
            if (!body) return json({ error: 'Невалидно барање' }, 400, headers);

            const name = clean(body.name, 100);
            const phone = clean(body.phone, 30);
            const city = clean(body.city, 60);
            const category = clean(body.category, 60);
            if (!name || !phone || !city || !category) {
              return json({ error: 'Име, телефон, град и категорија се задолжителни' }, 400, headers);
            }

            const result = await sql`
              UPDATE majstori
              SET name = ${name},
                  phone = ${phone},
                  city = ${city},
                  category = ${category},
                  description = ${clean(body.description, 2000)},
                  facebook_url = ${clean(body.facebook_url, 300)},
                  website_url = ${clean(body.website_url, 300)}
              WHERE user_id = ${userId}
              RETURNING *
            `;
            if (result.length === 0) {
              return json({ error: 'Профилот не е пронајден' }, 404, headers);
            }
            return json(result, 200, headers);
          }

          // ===== РЕГИСТРАЦИЈА НА МАЈСТОР =====
          if (path === '/api/register-majstor') {
            const body = await readBody(request);
            if (!body) return json({ error: 'Невалидно барање' }, 400, headers);

            const name = clean(body.name, 100);
            const phone = clean(body.phone, 30);
            const city = clean(body.city, 60);
            const category = clean(body.category, 60);
            if (!name || !phone || !city || !category) {
              return json({ error: 'Име, телефон, град и категорија се задолжителни' }, 400, headers);
            }

            // една сметка = еден профил; премиум се одлучува во истата SQL команда
            const result = await sql`
              INSERT INTO majstori (
                user_id, name, phone, city, category, description,
                facebook_url, website_url, is_premium, rating, rating_count
              )
              SELECT
                ${userId}, ${name}, ${phone}, ${city}, ${category}, ${clean(body.description, 2000)},
                ${clean(body.facebook_url, 300)}, ${clean(body.website_url, 300)},
                (SELECT COUNT(*) FROM majstori) < ${FREE_PREMIUM_SPOTS}, 0, 0
              WHERE NOT EXISTS (SELECT 1 FROM majstori WHERE user_id = ${userId})
              RETURNING *
            `;
            if (result.length === 0) {
              return json({ error: 'Веќе имаш профил' }, 409, headers);
            }
            return json(
              { success: true, majstor: result[0], isFree: result[0].is_premium },
              200,
              headers
            );
          }
        }

        return json({ error: 'API Not Found' }, 404, headers);
      } catch (error) {
        console.error('API error', error && error.message);
        return json({ error: 'Серверска грешка' }, 500, headers);
      }
    }

    // 4. Статични страници (index.html, profile.html ...)
    return env.ASSETS.fetch(request);
  },
};
