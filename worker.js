import { neon } from '@neondatabase/serverless';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Clerk Proxy
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

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    const apiHeaders = {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    if (url.pathname.startsWith('/api/')) {
      try {
        const sql = neon(env.DATABASE_URL);

        // Враќање на мајстори
        if (url.pathname === "/api/majstori") {
          const email = url.searchParams.get('email');
          const id = url.searchParams.get('id');
          if (email) {
            const rows = await sql`SELECT * FROM majstori WHERE LOWER(email)=LOWER(${email}) LIMIT 1`;
            return new Response(JSON.stringify(rows[0] || null), { headers: apiHeaders });
          }
          if (id) {
            const rows = await sql`SELECT * FROM majstori WHERE id=${id} LIMIT 1`;
            return new Response(JSON.stringify(rows[0] || null), { headers: apiHeaders });
          }
          const majstori = await sql`SELECT * FROM majstori WHERE is_premium=true OR is_founder=true ORDER BY is_founder DESC, is_premium DESC, rating DESC, id DESC LIMIT 200`;
          return new Response(JSON.stringify(majstori), { headers: apiHeaders });
        }

        // Dashboard /api/me
        if (url.pathname === "/api/me") {
          const email = url.searchParams.get('email');
          const clerkId = url.searchParams.get('clerk_id');
          if (email) {
            const rows = await sql`SELECT * FROM majstori WHERE LOWER(email)=LOWER(${email}) LIMIT 1`;
            return new Response(JSON.stringify(rows[0] || null), { headers: apiHeaders });
          }
          if (clerkId) {
            const rows = await sql`SELECT * FROM majstori WHERE user_id=${clerkId} LIMIT 1`;
            return new Response(JSON.stringify(rows[0] || null), { headers: apiHeaders });
          }
          return new Response(JSON.stringify({error: "Missing params"}), {status: 400, headers: apiHeaders});
        }

        // Медиа
        if (url.pathname === "/api/media") {
          const majstorId = url.searchParams.get('majstor_id');
          let media;
          if (majstorId) {
            media = await sql`SELECT * FROM majstor_media WHERE majstor_id=${majstorId} AND type='image' ORDER BY id DESC`;
          } else {
            media = await sql`SELECT * FROM majstor_media WHERE type='image' ORDER BY id DESC LIMIT 300`;
          }
          return new Response(JSON.stringify(media), { headers: apiHeaders });
        }

        // Оценки
        if (url.pathname === "/api/ratings") {
          const majstorId = url.searchParams.get('majstor_id');
          let ratings;
          if (majstorId) {
            ratings = await sql`SELECT * FROM ratings WHERE majstor_id=${majstorId} AND status='approved' ORDER BY created_at DESC`;
          } else {
            ratings = await sql`SELECT * FROM ratings WHERE status='approved' ORDER BY created_at DESC LIMIT 100`;
          }
          return new Response(JSON.stringify(ratings), { headers: apiHeaders });
        }

        // Качување слики
        if (url.pathname === "/api/upload" && request.method === "POST") {
          const formData = await request.formData();
          const file = formData.get('file');
          if (!file) return new Response(JSON.stringify({ error: "Нема слика" }), { status: 400, headers: apiHeaders });
          if (file.size > 8 * 1024 * 1024) return new Response(JSON.stringify({ error: "Слика >8MB" }), { status: 400, headers: apiHeaders });

          const imgbbData = new FormData();
          imgbbData.append('image', file);
          const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${env.IMGBB_API_KEY}`, { method: 'POST', body: imgbbData });
          const result = await imgbbRes.json();
          if (result.data?.url) {
            return new Response(JSON.stringify({ secure_url: result.data.url, url: result.data.url }), { headers: apiHeaders });
          } else {
            return new Response(JSON.stringify({ error: result.error?.message || "ImgBB грешка" }), { status: 500, headers: apiHeaders });
          }
        }

        // Додај слика во база
        if (url.pathname === "/api/add-media" && request.method === "POST") {
          const body = await request.json();
          if (!body.majstor_id || !body.url) return new Response(JSON.stringify({error:"Missing"}), {status:400, headers:apiHeaders});
          
          const countRows = await sql`SELECT COUNT(*) as c FROM majstor_media WHERE majstor_id=${body.majstor_id} AND type='image'`;
          if (Number(countRows[0].c) >= 50) {
            return new Response(JSON.stringify({ error: "Достигнат лимит 50 слики" }), { status: 400, headers: apiHeaders });
          }
          const result = await sql`INSERT INTO majstor_media (majstor_id, type, url, title) VALUES (${body.majstor_id}, 'image', ${body.url}, 'Слика од работа') RETURNING *`;
          return new Response(JSON.stringify(result[0]), { headers: apiHeaders });
        }

        // Избриши слика
        if (url.pathname === "/api/delete-media" && request.method === "POST") {
          const body = await request.json();
          await sql`DELETE FROM majstor_media WHERE id=${body.id}`;
          return new Response(JSON.stringify({ success: true }), { headers: apiHeaders });
        }

        // Ажурирај профил
        if (url.pathname === "/api/update-profile" && request.method === "POST") {
          const body = await request.json();
          await sql`UPDATE majstori SET name=${body.name}, phone=${body.phone}, city=${body.city}, category=${body.category}, description=${body.description||''}, facebook_url=${body.facebook_url||null}, website_url=${body.website_url||null}, updated_at=NOW() WHERE id=${body.id}`;
          return new Response(JSON.stringify({ success: true }), { headers: apiHeaders });
        }

        // Ажурирај аватар
        if (url.pathname === "/api/update-avatar" && request.method === "POST") {
          const body = await request.json();
          await sql`UPDATE majstori SET photo_url=${body.url}, updated_at=NOW() WHERE id=${body.id}`;
          return new Response(JSON.stringify({ success: true }), { headers: apiHeaders });
        }

        // Ажурирај банер
        if (url.pathname === "/api/update-cover" && request.method === "POST") {
          const body = await request.json();
          await sql`UPDATE majstori SET cover_url=${body.url}, updated_at=NOW() WHERE id=${body.id}`;
          return new Response(JSON.stringify({ success: true }), { headers: apiHeaders });
        }

        // Статистика
        if (url.pathname === "/api/track" && request.method === "POST") {
          const body = await request.json();
          const { majstor_id, type } = body;
          try {
            if(type==='view') await sql`UPDATE majstori SET views = COALESCE(views,0)+1 WHERE id=${majstor_id}`;
            if(type==='phone') await sql`UPDATE majstori SET phone_clicks = COALESCE(phone_clicks,0)+1 WHERE id=${majstor_id}`;
            await sql`INSERT INTO majstor_stats (majstor_id, event_type) VALUES (${majstor_id}, ${type})`;
          } catch(e){console.log(e.message)}
          return new Response(JSON.stringify({ success: true }), { headers: apiHeaders });
        }

        // ===== АДМИН ФУНКЦИИ =====
        if (url.pathname === "/api/admin-toggle" && request.method === "POST") {
          const body = await request.json();
          const field = body.field; // 'is_founder', 'is_premium', 'verified'
          const val = body.value;
          if(field === 'is_founder') await sql`UPDATE majstori SET is_founder=${val} WHERE id=${body.id}`;
          if(field === 'is_premium') await sql`UPDATE majstori SET is_premium=${val} WHERE id=${body.id}`;
          if(field === 'verified') await sql`UPDATE majstori SET verified=${val} WHERE id=${body.id}`;
          return new Response(JSON.stringify({ success: true }), { headers: apiHeaders });
        }

        if (url.pathname === "/api/delete-majstor" && request.method === "POST") {
          const body = await request.json();
          await sql`DELETE FROM majstor_media WHERE majstor_id=${body.id}`;
          await sql`DELETE FROM ratings WHERE majstor_id=${body.id}`;
          await sql`DELETE FROM majstori WHERE id=${body.id}`;
          return new Response(JSON.stringify({ success: true }), { headers: apiHeaders });
        }

        if (url.pathname === "/api/approve-rating" && request.method === "POST") {
          const body = await request.json();
          if(body.action === 'approve') {
            await sql`UPDATE ratings SET status='approved' WHERE id=${body.id}`;
            // Тука може да додадеме логика за ажурирање на просечната оценка
          } else {
            await sql`DELETE FROM ratings WHERE id=${body.id}`;
          }
          return new Response(JSON.stringify({ success: true }), { headers: apiHeaders });
        }

        // Регистрација со FOUNDER логика
        if (url.pathname === "/api/register-user" && request.method === "POST") {
          const body = await request.json();
          if (!body.email || !body.clerk_id) return new Response(JSON.stringify({error:"Missing"}), {status:400, headers:apiHeaders});

          const countRes = await sql`SELECT COUNT(*) as c FROM majstori`;
          const total = Number(countRes[0].c);
          
          const isFounder = total < 50;
          const founderNumber = isFounder ? total + 1 : null;

          const result = await sql`
            INSERT INTO majstori (user_id, email, name, phone, city, category, description, facebook_url, website_url, is_founder, founder_number, is_premium, paid_until, agreed_to_terms, created_at, rating, rating_count, views, phone_clicks)
            VALUES (${body.clerk_id}, ${body.email}, ${body.name}, ${body.phone}, ${body.city}, ${body.category}, ${body.description||''}, ${body.facebook_url||''}, ${body.website_url||''}, ${isFounder}, ${founderNumber}, true, ${isFounder ? null : sql`NOW() + INTERVAL '1 year'`}, true, NOW(), 0, 0, 0, 0)
            ON CONFLICT (email) DO UPDATE SET user_id=${body.clerk_id}, name=${body.name}, phone=${body.phone}, city=${body.city}, category=${body.category}, description=${body.description||''}, facebook_url=${body.facebook_url||''}, website_url=${body.website_url||''}, updated_at=NOW()
            RETURNING *;
          `;
          return new Response(JSON.stringify({ success: true, majstor: result[0], isFounder }), { headers: apiHeaders });
        }

        return new Response(JSON.stringify({error:"Not Found"}), { status: 404, headers: apiHeaders });
      } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: apiHeaders });
      }
    }

    // OG TAGS
    if (url.pathname === '/majstor.html') {
      const id = url.searchParams.get('id');
      if (!id) return Response.redirect('/', 302);
      try {
        const sql = neon(env.DATABASE_URL);
        const rows = await sql`SELECT id, name, category, city, description, photo_url FROM majstori WHERE id=${id} LIMIT 1`;
        const majstor = rows[0];
        if (!majstor) return Response.redirect('/', 302);
        const esc = (s) => String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
        const title = esc(`${majstor.name} — ${majstor.category} во ${majstor.city} | Majsto.mk`);
        const desc = esc((majstor.description||'').substring(0,160));
        const image = majstor.photo_url || 'https://majsto.mk/og-image-1200x630.png';
        const pageUrl = `https://majsto.mk/profile.html?id=${majstor.id}`;
        const html = `<!DOCTYPE html><html lang="mk"><head><meta charset="UTF-8"><title>${title}</title><meta property="og:title" content="${title}"/><meta property="og:description" content="${desc}"/><meta property="og:image" content="${image}"/><meta property="og:url" content="${pageUrl}"/><meta http-equiv="refresh" content="0;url=${pageUrl}"/><link rel="canonical" href="${pageUrl}"/></head><body><script>location.href="${pageUrl}"</script></body></html>`;
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, s-maxage=86400" } });
      } catch(e){ return Response.redirect('/profile.html?id='+id, 302); }
    }

    // За сите други, врати статични файлови
    return env.ASSETS.fetch(request);
  },
};
