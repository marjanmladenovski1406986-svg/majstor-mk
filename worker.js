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
          return out(await sql`SELECT * FROM majstori ORDER BY id DESC`);
        }

        if (path === "/api/admin-update-majstor" && method === "POST") {
          const b = await request.json();
          await sql`UPDATE majstori SET name=${b.name}, phone=${b.phone}, city=${b.city}, category=${b.category}, description=${b.description}, rating=${b.rating}, facebook_url=${b.facebook_url}, website_url=${b.website_url} WHERE id=${b.id}`;
          return out({ success: true });
        }

        if (path === "/api/toggle-majstor" && method === "POST") {
                  const b = await request.json();
          // Мора вака, бидејќи Neon не дозволува динамични имиња на колони
          if (b.field === 'verified') await sql`UPDATE majstori SET verified = ${b.value} WHERE id = ${b.id}`;
          if (b.field === 'featured') await sql`UPDATE majstori SET featured = ${b.value} WHERE id = ${b.id}`;
          if (b.field === 'is_paused') await sql`UPDATE majstori SET is_paused = ${b.value} WHERE id = ${b.id}`;
          return out({ success: true });
        }

        if (path === "/api/delete-majstor" && method === "POST") {
          const b = await request.json();
          await sql`DELETE FROM majstori WHERE id=${b.id}`;
          return out({ success: true });
        }

        if (path === "/api/admin-change-password" && method === "POST") {
          const b = await request.json();
          await sql`UPDATE majstori SET password = ${b.password} WHERE id = ${b.id}`;
          return out({ success: true });
        }
        

        // ===== МЕДИА (Слики) =====
        if (path === "/api/media" && method === "GET") {
          const majstorId = url.searchParams.get('majstor_id');
          let media;
          if (majstorId) {
            media = await sql`SELECT * FROM majstor_media WHERE majstor_id=${majstorId} AND type='image' ORDER BY id DESC`;
          } else {
            media = await sql`SELECT * FROM majstor_media WHERE type='image' ORDER BY id DESC LIMIT 300`;
          }
          return out(media);
        }

        if (path === "/api/add-media" && method === "POST") {
          const b = await request.json();
          const result = await sql`INSERT INTO majstor_media (majstor_id, type, url, title) VALUES (${b.majstor_id}, 'image', ${b.url}, 'Слика од работа') RETURNING *`;
          return out(result[0]);
        }

        if (path === "/api/delete-media" && method === "POST") {
          const b = await request.json();
          await sql`DELETE FROM majstor_media WHERE id=${b.id}`;
          return out({ success: true });
        }

        // ===== ОЦЕНКИ =====
        if (path === "/api/ratings" && method === "GET") {
          const majstorId = url.searchParams.get('majstor_id');
          let ratings;
          if (majstorId) {
            ratings = await sql`SELECT * FROM ratings WHERE majstor_id=${majstorId} AND status='approved' ORDER BY created_at DESC`;
          } else {
            ratings = await sql`SELECT * FROM ratings WHERE status='approved' ORDER BY created_at DESC LIMIT 100`;
          }
          return out(ratings);
        }
        
        if (path === "/api/add-rating" && method === "POST") {
          const b = await request.json();
          await sql`INSERT INTO ratings (majstor_id, user_id, rating, comment, status) VALUES (${b.majstor_id}, ${b.user_id}, ${b.rating}, ${b.comment || ''}, 'pending')`;
          return out({ success: true });
        }

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

        // ===== КЛИЕНТИ =====
        if (path === "/api/clients" && method === "GET") {
          return out(await sql`SELECT * FROM clients ORDER BY id DESC`);
        }
        if (path === "/api/delete-client" && method === "POST") {
          const b = await request.json();
          await sql`DELETE FROM clients WHERE id=${b.id}`;
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

        // ===== НАЈАВА И ПРОФИЛ =====
        if (path === "/api/login-user" && method === "POST") {
          const b = await request.json();
          const m = await sql`SELECT id, password FROM majstori WHERE LOWER(email)=LOWER(${b.email}) LIMIT 1`;
          if(m.length > 0 && m[0].password === b.password) return out({ success: true, isMajstor: true, id: m[0].id });
          const c = await sql`SELECT id, password FROM clients WHERE LOWER(email)=LOWER(${b.email}) LIMIT 1`;
          if(c.length > 0 && c[0].password === b.password) return out({ success: true, isMajstor: false, id: c[0].id });
          return out({ error: 'Погрешен мејл или лозинка.' }, 401);
        }

        if (path === "/api/register-user" && method === "POST") {
          const b = await request.json();
          const checkM = await sql`SELECT id FROM majstori WHERE LOWER(email)=LOWER(${b.email})`;
          const checkC = await sql`SELECT id FROM clients WHERE LOWER(email)=LOWER(${b.email})`;
          if(checkM.length > 0 || checkC.length > 0) return out({ error: "Овој мејл веќе постои." }, 400);
          if(b.isMajstor) await sql`INSERT INTO majstori (email, password, name, category, city) VALUES (${b.email}, ${b.password}, 'Нов Мајстор', 'opti', 'Скопје')`;
          else await sql`INSERT INTO clients (email, password, name) VALUES (${b.email}, ${b.password}, 'Клиент')`;
          return out({ success: true });
        }

        if (path === "/api/update-profile" && method === "POST") {
          const b = await request.json();
          await sql`UPDATE majstori SET name=${b.name}, phone=${b.phone}, city=${b.city}, category=${b.category}, description=${b.description||''}, facebook_url=${b.facebook_url||null}, website_url=${b.website_url||null} WHERE id=${b.id}`;
          return out({ success: true });
        }
        if (path === "/api/update-avatar" && method === "POST") {
          const b = await request.json();
          await sql`UPDATE majstori SET photo_url=${b.url} WHERE id=${b.id}`;
          return out({ success: true });
        }
        if (path === "/api/update-cover" && method === "POST") {
          const b = await request.json();
          await sql`UPDATE majstori SET cover_url=${b.url} WHERE id=${b.id}`;
          return out({ success: true });
        }

        // ===== СТАТИСТИКА =====
        if (path === "/api/track" && method === "POST") {
          const b = await request.json();
          try {
            if(b.type==='view') await sql`UPDATE majstori SET views = COALESCE(views,0)+1 WHERE id=${b.majstor_id}`;
            if(b.type==='phone') await sql`UPDATE majstori SET phone_clicks = COALESCE(phone_clicks,0)+1 WHERE id=${b.majstor_id}`;
          } catch(e){ console.log(e.message); }
          return out({ success: true });
        }

        // ===== КАЧУВАЊЕ НА СЛИКА (ImageKit) =====
        if (path === "/api/upload" && method === "POST") {
          if (!env.IMAGEKIT_PRIVATE_KEY || !env.IMAGEKIT_URL_ENDPOINT) {
            return out({ error: "ImageKit клучевите не се поставени во Cloudflare!" }, 500);
          }

          const fd = await request.formData();
          const file = fd.get('file');
          if (!file) return out({ error: "Нема слика" }, 400);

          const imagekitData = new FormData();
          imagekitData.append('file', file);
          imagekitData.append('fileName', `majsto_${Date.now()}.jpg`);

          try {
            const auth = btoa(env.IMAGEKIT_PRIVATE_KEY + ":");
            
            const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
              method: 'POST',
              headers: { 'Authorization': `Basic ${auth}` },
              body: imagekitData
            });
            
            const json = await res.json();
            
            if (!res.ok || !json.url) {
              return out({ error: json.message || "ImageKit не ја прифати сликата" }, 500);
            }
            
            return out({ secure_url: json.url, url: json.url });
          } catch (err) {
            return out({ error: "Мрежна грешка при качување: " + err.message }, 500);
          }
        }

        return out({ error: 'Not Found' }, 404);
      } catch (error) {
        return out({ error: "Worker Грешка: " + error.message }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
