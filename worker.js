import { neon } from '@neondatabase/serverless';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        const sql = neon(env.DATABASE_URL);

        if (url.pathname === "/api/majstori") {
          const majstori = await sql`SELECT * FROM majstori ORDER BY is_premium DESC, rating DESC`;
          return new Response(JSON.stringify(majstori), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (url.pathname === "/api/media") {
          const media = await sql`SELECT * FROM majstor_media`;
          return new Response(JSON.stringify(media), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (url.pathname === "/api/ratings") {
          const ratings = await sql`SELECT * FROM ratings WHERE status = 'approved'`;
          return new Response(JSON.stringify(ratings), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response("API Not Found", { status: 404, headers: corsHeaders });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
