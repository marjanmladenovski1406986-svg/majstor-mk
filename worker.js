import { neon } from '@neondatabase/serverless';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Clerk Proxy
    if (url.hostname === 'clerk.majsto.mk') {
      return fetch(`https://frontend-api.clerk.services${url.pathname}${url.search}`, request);
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname.startsWith('/api/')) {
      const apiHeaders = {
        ...corsHeaders, 
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
      };

      try {
        const sql = neon(env.DATABASE_URL);

        if (url.pathname === "/api/majstori") {
          const majstori = await sql`SELECT * FROM majstori ORDER BY is_premium DESC, rating DESC`;
          return new Response(JSON.stringify(majstori), { headers: apiHeaders });
        }

        if (url.pathname === "/api/media") {
          const media = await sql`SELECT * FROM majstor_media`;
          return new Response(JSON.stringify(media), { headers: apiHeaders });
        }

        if (url.pathname === "/api/ratings") {
          const ratings = await sql`SELECT * FROM ratings WHERE status = 'approved'`;
          return new Response(JSON.stringify(ratings), { headers: apiHeaders });
        }

        // ===== КАЧУВАЊЕ НА СЛИКИ НА CLOUDINARY =====
        if (url.pathname === "/api/upload" && request.method === "POST") {
          const formData = await request.formData();
          const file = formData.get('file');
          
          if (!file) {
            return new Response(JSON.stringify({ error: "Нема слика" }), { status: 400, headers: apiHeaders });
          }

          const cloudinaryData = new FormData();
          cloudinaryData.append('file', file);
          cloudinaryData.append('upload_preset', 'majsto_upload'); // Ова е стандарден preset, ќе го смениме ако треба
          cloudinaryData.append('api_key', env.CLOUDINARY_API_KEY);

          const cloudinaryRes = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`, {
            method: 'POST',
            body: cloudinaryData
          });

          const result = await cloudinaryRes.json();
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

    return env.ASSETS.fetch(request);
  },
};
