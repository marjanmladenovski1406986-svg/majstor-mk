import { neon } from '@neondatabase/serverless';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
        if (!env.DATABASE_URL) {
           return new Response(JSON.stringify({ error: "DATABASE_URL не е поставен во Cloudflare!" }), { status: 500, headers: apiHeaders });
        }
        
        const sql = neon(env.DATABASE_URL);

        // --- ПАРТНЕРИ ---
        if (url.pathname === "/api/partners") {
          // Ако имаш табела partners, откоментирај го ова:
          // const partners = await sql`SELECT * FROM partners`;
          // return new Response(JSON.stringify(partners), { headers: apiHeaders });
          return new Response(JSON.stringify([]), { headers: apiHeaders }); // Враќа празно
        }

        // --- МАЈСТОРИ ---
        if (url.pathname === "/api/majstori") {
          try {
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
            // Ова е барањето што пукаше (сега ќе ни покаже точна грешка ако пак пукне)
            const majstori = await sql`SELECT * FROM majstori WHERE is_premium=true OR is_founder=true ORDER BY is_founder DESC, is_premium DESC, rating DESC, id DESC LIMIT 200`;
            return new Response(JSON.stringify(majstori), { headers: apiHeaders });
          } catch (dbError) {
             return new Response(JSON.stringify({ error: "SQL ГРЕШКА: " + dbError.message }), { status: 500, headers: apiHeaders });
          }
        }

        // --- ДРУГИ РУТИ ---
        if (url.pathname === "/api/media") {
          const majstorId = url.searchParams.get('majstor_id');
          let media = majstorId 
            ? await sql`SELECT * FROM majstor_media WHERE majstor_id=${majstorId} AND type='image' ORDER BY id DESC`
            : await sql`SELECT * FROM majstor_media WHERE type='image' ORDER BY id DESC LIMIT 300`;
          return new Response(JSON.stringify(media), { headers: apiHeaders });
        }

        if (url.pathname === "/api/ratings") {
          const majstorId = url.searchParams.get('majstor_id');
          let ratings = majstorId
            ? await sql`SELECT * FROM ratings WHERE majstor_id=${majstorId} AND status='approved' ORDER BY created_at DESC`
            : await sql`SELECT * FROM ratings WHERE status='approved' ORDER BY created_at DESC LIMIT 100`;
          return new Response(JSON.stringify(ratings), { headers: apiHeaders });
        }

        if (url.pathname === "/api/upload" && request.method === "POST") {
          const formData = await request.formData();
          const file = formData.get('file');
          if (!file) return new Response(JSON.stringify({ error: "Нема слика" }), { status: 400, headers: apiHeaders });
          
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

        if (url.pathname === "/api/add-media" && request.method === "POST") {
          const body = await request.json();
          const result = await sql`INSERT INTO majstor_media (majstor_id, type, url, title) VALUES (${body.majstor_id}, 'image', ${body.url}, 'Слика од работа') RETURNING *`;
          return new Response(JSON.stringify(result[0]), { headers: apiHeaders });
        }

        if (url.pathname === "/api/delete-media" && request.method === "POST") {
          const body = await request.json();
          await sql`DELETE FROM majstor_media WHERE id=${body.id}`;
          return new Response(JSON.stringify({ success: true }), { headers: apiHeaders });
        }

        if (url.pathname === "/api/update-profile" && request.method === "POST") {
          const body = await request.json();
          await sql`UPDATE majstori SET name=${body.name}, phone=${body.phone}, city=${body.city}, category=${body.category}, description=${body.description||''}, facebook_url=${body.facebook_url||null}, website_url=${body.website_url||null}, updated_at=NOW() WHERE id=${body.id}`;
          return new Response(JSON.stringify({ success: true }), { headers: apiHeaders });
        }

        if (url.pathname === "/api/update-avatar" && request.method === "POST") {
          const body = await request.json();
          await sql`UPDATE majstori SET photo_url=${body.url}, updated_at=NOW() WHERE id=${body.id}`;
          return new Response(JSON.stringify({ success: true }), { headers: apiHeaders });
        }

        if (url.pathname === "/api/update-cover" && request.method === "POST") {
          const body = await request.json();
          await sql`UPDATE majstori SET cover_url=${body.url}, updated_at=NOW() WHERE id=${body.id}`;
          return new Response(JSON.stringify({ success: true }), { headers: apiHeaders });
        }

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

        if (url.pathname === "/api/register-user" && request.method === "POST") {
          const body = await request.json();
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
        return new Response(JSON.stringify({ error: "Worker Грешка: " + error.message }), { status: 500, headers: apiHeaders });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
