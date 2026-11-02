import { neon } from '@neondatabase/serverless';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    const apiHeaders = { ...corsHeaders, "Content-Type": "application/json" };

    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const out = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: apiHeaders });

    if (path.startsWith('/api/')) {
      try {
        if (!env.DATABASE_URL) return out({ error: "DATABASE_URL не е поставен!" }, 500);
        const sql = neon(env.DATABASE_URL);

        // ===== МАЈСТОРИ =====
        if (path === "/api/majstori" && method === "GET") {
          const id = url.searchParams.get('id');
          const email = url.searchParams.get('email');
          if (id) return out((await sql`SELECT * FROM majstori WHERE id=${id} LIMIT 1`)[0] || null);
          if (email) return out((await sql`SELECT * FROM majstori WHERE LOWER(email)=LOWER(${email}) LIMIT 1`)[0] || null);
          return out(await sql`SELECT * FROM majstori ORDER BY is_founder DESC, is_premium DESC, id DESC`);
        }

        if (path === "/api/admin-update-majstor" && method === "POST") {
          const b = await request.json();
          await sql`UPDATE majstori SET name=${b.name}, phone=${b.phone}, city=${b.city}, category=${b.category}, description=${b.description}, rating=${b.rating}, facebook_url=${b.facebook_url}, website_url=${b.website_url} WHERE id=${b.id}`;
          return out({ success: true });
        }

        if (path === "/api/toggle-majstor" && method === "POST") {
          const b = await request.json();
          // b.field може да биде 'verified', 'featured', 'is_paused'
          const query = sql`UPDATE majstori SET ${sql(b.field)} = ${b.value} WHERE id = ${b.id}`;
          await query;
          return out({ success: true });
        }

        if (path === "/api/delete-majstor" && method === "POST") {
          const b = await request.json();
          await sql`DELETE FROM majstori WHERE id=${b.id}`;
          return out({ success: true });
        }

        // ===== КЛИЕНТИ =====
        if (path === "/api/clients" && method === "GET") {
          return out(await sql`SELECT * FROM clients ORDER BY id DESC`);
        }
        if (path === "/api/delete-client" && method === "POST") {
          const b = await request.json();
          await sql`DELETE FROM clients WHERE id=${b.id}`;
          return out({ success: true });
        }

        // ===== ОЦЕНКИ (МОДЕРАЦИЈА) =====
        if (path === "/api/pending-ratings" && method === "GET") {
          return out(await sql`SELECT r.*, m.name as majstor_name FROM ratings r JOIN majstori m ON r.majstor_id = m.id WHERE r.status = 'pending' ORDER BY r.created_at DESC`);
        }
        if (path === "/api/approve-rating" && method === "POST") {
          const b = await request.json();
          await sql`UPDATE ratings SET status = 'approved' WHERE id = ${b.id}`;
          return out({ success: true });
        }
        if (path === "/api/reject-rating" && method === "POST") {
          const b = await request.json();
          await sql`DELETE FROM ratings WHERE id = ${b.id}`;
          return out({ success: true });
        }

        // ===== ФИДБЕК =====
        if (path === "/api/feedback" && method === "GET") {
          return out(await sql`SELECT * FROM feedback ORDER BY created_at DESC`);
        }
        if (path === "/api/delete-feedback" && method === "POST") {
          const b = await request.json();
          await sql`DELETE FROM feedback WHERE id=${b.id}`;
          return out({ success: true });
        }

        // ===== ПАРТНЕРИ =====
        if (path === "/api/partners" && method === "GET") {
          return out(await sql`SELECT * FROM partners ORDER BY display_order ASC`);
        }
        if (path === "/api/save-partner" && method === "POST") {
          const b = await request.json();
          if (b.id) {
            await sql`UPDATE partners SET name=${b.name}, description=${b.description}, logo_url=${b.logo_url}, website_url=${b.website_url}, display_order=${b.display_order} WHERE id=${b.id}`;
          } else {
            await sql`INSERT INTO partners (name, description, logo_url, website_url, display_order) VALUES (${b.name}, ${b.description}, ${b.logo_url}, ${b.website_url}, ${b.display_order})`;
          }
          return out({ success: true });
        }
        if (path === "/api/delete-partner" && method === "POST") {
          const b = await request.json();
          await sql`DELETE FROM partners WHERE id=${b.id}`;
          return out({ success: true });
        }

        // ===== ФОРУМ =====
        if (path === "/api/forum" && method === "GET") {
          return out(await sql`SELECT * FROM majstor_forum ORDER BY created_at DESC`);
        }
        if (path === "/api/approve-forum" && method === "POST") {
          const b = await request.json();
          await sql`UPDATE majstor_forum SET status = 'approved' WHERE id = ${b.id}`;
          return out({ success: true });
        }
        if (path === "/api/delete-forum" && method === "POST") {
          const b = await request.json();
          await sql`DELETE FROM majstor_forum WHERE id = ${b.id}`;
          return out({ success: true });
        }

        // ===== ОСТАНАТИ (Слики, Најава, Статистика) =====
        if (path === "/api/login-user" && method === "POST") {
          const b = await request.json();
          const m = await sql`SELECT id, password FROM majstori WHERE LOWER(email)=LOWER(${b.email}) LIMIT 1`;
          if(m.length > 0 && m[0].password === b.password) return out({ success: true, isMajstor: true, id: m[0].id });
          const c = await sql`SELECT id, password FROM clients WHERE LOWER(email)=LOWER(${b.email}) LIMIT 1`;
          if(c.length > 0 && c[0].password === b.password) return out({ success: true, isMajstor: false, id: c[0].id });
          return out({ error: 'Погрешен мејл или лозинка.' }, 401);
        }

        if (path === "/api/upload" && method === "POST") {
          const fd = await request.formData();
          const file = fd.get('file');
          if (!file) return out({ error: "Нема слика" }, 400);
          const imgbb = new FormData(); imgbb.append('image', file);
          const res = await fetch(`https://api.imgbb.com/1/upload?key=${env.IMGBB_API_KEY}`, { method: 'POST', body: imgbb });
          const json = await res.json();
          return out({ url: json.data?.url || null });
        }

        return out({ error: 'Not Found' }, 404);
      } catch (error) {
        return out({ error: "Worker Грешка: " + error.message }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
