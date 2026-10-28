import { neon } from '@neondatabase/serverless';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 1. Clerk Proxy (За најава)
    if (url.hostname === 'clerk.majsto.mk') {
      return fetch(`https://frontend-api.clerk.services${url.pathname}${url.search}`, request);
    }

    // 2. CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 3. API Routes
    if (url.pathname.startsWith('/api/')) {
      const apiHeaders = {
        ...corsHeaders, 
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
      };

      try {
        const sql = neon(env.DATABASE_URL);

        // Враќање на сите мајстори
        if (url.pathname === "/api/majstori") {
          const majstori = await sql`SELECT * FROM majstori ORDER BY is_premium DESC, rating DESC`;
          return new Response(JSON.stringify(majstori), { headers: apiHeaders });
        }

        // Враќање на сите слики/видеа
        if (url.pathname === "/api/media") {
          const media = await sql`SELECT * FROM majstor_media`;
          return new Response(JSON.stringify(media), { headers: apiHeaders });
        }

        // Враќање на оценки
        if (url.pathname === "/api/ratings") {
          const ratings = await sql`SELECT * FROM ratings WHERE status = 'approved'`;
          return new Response(JSON.stringify(ratings), { headers: apiHeaders });
        }

        // ===== КАЧУВАЊЕ НА СЛИКИ НА IMGBB =====
        if (url.pathname === "/api/upload" && request.method === "POST") {
          const formData = await request.formData();
          const file = formData.get('file');
          
          if (!file) {
            return new Response(JSON.stringify({ error: "Нема слика" }), { status: 400, headers: apiHeaders });
          }

          const imgbbData = new FormData();
          imgbbData.append('image', file);

          const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${env.IMGBB_API_KEY}`, {
            method: 'POST',
            body: imgbbData
          });

          const result = await imgbbRes.json();
          
          if (result.data && result.data.url) {
            return new Response(JSON.stringify({ secure_url: result.data.url }), { headers: apiHeaders });
          } else {
            return new Response(JSON.stringify({ error: result.error?.message || "Грешка при качување" }), { status: 500, headers: apiHeaders });
          }
        }

        // ===== ЗАЧУВУВАЊЕ НА ЛИНКОТ ВО NEON БАЗАТА =====
        if (url.pathname === "/api/add-media" && request.method === "POST") {
          const body = await request.json();
          const result = await sql`
            INSERT INTO majstor_media (majstor_id, type, url, title) 
            VALUES (${body.majstor_id}, ${body.type}, ${body.url}, 'Слика од работа') 
            RETURNING *
          `;
          return new Response(JSON.stringify(result), { headers: apiHeaders });
        }

        return new Response("API Not Found", { status: 404, headers: corsHeaders });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: apiHeaders,
        });
      }
    }

    // 4. Ако не е API, отвори ги обичните HTML страници (index.html, profile.html...)
    return env.ASSETS.fetch(request);
  },
};
