import { neon } from '@neondatabase/serverless';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 1. CORS и API Headers
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

    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // 2. Помошна функција за JSON одговор
    const out = (data, status = 200) => {
      return new Response(JSON.stringify(data), { status, headers: apiHeaders });
    };

    // 3. API Routes
    if (path.startsWith('/api/')) {
      try {
        if (!env.DATABASE_URL) return out({ error: "DATABASE_URL не е поставен!" }, 500);
        const sql = neon(env.DATABASE_URL);

        // ===== МАЈСТОРИ (GET) =====
        if (path === "/api/majstori" && method === "GET") {
          const email = url.searchParams.get('email');
          const id = url.searchParams.get('id');
          
          if (email) {
            const rows = await sql`SELECT * FROM majstori WHERE LOWER(email)=LOWER(${email}) LIMIT 1`;
            return out(rows[0] || null);
          }
          if (id) {
            const rows = await sql`SELECT * FROM majstori WHERE id=${id} LIMIT 1`;
            return out(rows[0] || null);
          }
          const majstori = await sql`SELECT * FROM majstori ORDER BY is_founder DESC, is_premium DESC, id DESC`;
          return out(majstori);
        }

        // ===== БРИШЕЊЕ НА МАЈСТОР (ЗА АДМИН) =====
        if (path === "/api/delete-majstor" && method === "POST") {
          const body = await request.json();
          await sql`DELETE FROM majstori WHERE id=${body.id}`;
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

        // ===== ОЦЕНКИ (GET) =====
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

        // ===== НАЈАВА (POST) =====
        if (path === "/api/login-user" && method === "POST") {
          const body = await request.json();
          
          // Проверка за Мајстор
          const majstor = await sql`SELECT id, password FROM majstori WHERE LOWER(email)=LOWER(${body.email}) LIMIT 1`;
          if(majstor.length > 0) {
            if(majstor[0].password === body.password) {
              return out({ success: true, isMajstor: true, id: majstor[0].id });
            } else {
              return out({ error: 'Погрешна лозинка за мајстор.' }, 401);
            }
          }
          
          // Проверка за Клиент
          const client = await sql`SELECT id, password FROM clients WHERE LOWER(email)=LOWER(${body.email}) LIMIT 1`;
          if(client.length > 0) {
            if(client[0].password === body.password) {
              return out({ success: true, isMajstor: false, id: client[0].id });
            } else {
              return out({ error: 'Погрешна лозинка за клиент.' }, 401);
            }
          }
          
          return out({ error: 'Мејлот не постои во базата.' }, 401);
        }

        // ===== РЕГИСТРАЦИЈА (POST) =====
        if (path === "/api/register-user" && method === "POST") {
          const body = await request.json();
          
          // Проверка дали мејлот веќе постои
          const checkM = await sql`SELECT id FROM majstori WHERE LOWER(email)=LOWER(${body.email})`;
          const checkC = await sql`SELECT id FROM clients WHERE LOWER(email)=LOWER(${body.email})`;
          if(checkM.length > 0 || checkC.length > 0) {
            return out({ error: "Овој мејл веќе постои." }, 400);
          }

          if(body.isMajstor) {
            await sql`INSERT INTO majstori (email, password, name, category, city) VALUES (${body.email}, ${body.password}, 'Нов Мајстор', 'opti', 'Скопје')`;
          } else {
            await sql`INSERT INTO clients (email, password, name) VALUES (${body.email}, ${body.password}, 'Клиент')`;
          }
          return out({ success: true });
        }

        // ===== ДОДАВАЊЕ НА ОЦЕНКА (POST) =====
        if (path === "/api/add-rating" && method === "POST") {
          const body = await request.json();
          if (!body.majstor_id || !body.user_id || !body.rating) {
            return out({ error: "Missing data" }, 400);
          }
          await sql`
            INSERT INTO ratings (majstor_id, user_id, rating, comment, status)
            VALUES (${body.majstor_id}, ${body.user_id}, ${body.rating}, ${body.comment || ''}, 'pending')
          `;
          return out({ success: true });
        }

        // ===== ЗЕМИ ОЦЕНКИ НА ЧЕКАЊЕ (ЗА АДМИН) =====
        if (path === "/api/pending-ratings" && method === "GET") {
          const ratings = await sql`
            SELECT r.*, m.name as majstor_name 
            FROM ratings r 
            JOIN majstori m ON r.majstor_id = m.id 
            WHERE r.status = 'pending' 
            ORDER BY r.created_at DESC
          `;
          return out(ratings);
        }

        // ===== ОДОБРИ ОЦЕНКА (ЗА АДМИН) =====
        if (path === "/api/approve-rating" && method === "POST") {
          const body = await request.json();
          await sql`UPDATE ratings SET status = 'approved' WHERE id = ${body.id}`;
          return out({ success: true });
        }

        // ===== КАЧУВАЊЕ НА СЛИКА (ImgBB) =====
        if (path === "/api/upload" && method === "POST") {
          const formData = await request.formData();
          const file = formData.get('file');
          if (!file) return out({ error: "Нема слика" }, 400);
          
          const imgbbData = new FormData();
          imgbbData.append('image', file);
          const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${env.IMGBB_API_KEY}`, { method: 'POST', body: imgbbData });
          const result = await imgbbRes.json();
          
          if (result.data?.url) {
            return out({ secure_url: result.data.url, url: result.data.url });
          } else {
            return out({ error: result.error?.message || "ImgBB грешка" }, 500);
          }
        }

        // ===== ЗАЧУВУВАЊЕ НА СЛИКА ВО БАЗА =====
        if (path === "/api/add-media" && method === "POST") {
          const body = await request.json();
          const result = await sql`INSERT INTO majstor_media (majstor_id, type, url, title) VALUES (${body.majstor_id}, 'image', ${body.url}, 'Слика од работа') RETURNING *`;
          return out(result[0]);
        }

        // ===== БРИШЕЊЕ НА СЛИКА =====
        if (path === "/api/delete-media" && method === "POST") {
          const body = await request.json();
          await sql`DELETE FROM majstor_media WHERE id=${body.id}`;
          return out({ success: true });
        }

        // ===== АЖУРИРАЊЕ НА ПРОФИЛ =====
        if (path === "/api/update-profile" && method === "POST") {
          const body = await request.json();
          await sql`UPDATE majstori SET name=${body.name}, phone=${body.phone}, city=${body.city}, category=${body.category}, description=${body.description||''}, facebook_url=${body.facebook_url||null}, website_url=${body.website_url||null} WHERE id=${body.id}`;
          return out({ success: true });
        }

        // ===== АЖУРИРАЊЕ НА АВАТАР =====
        if (path === "/api/update-avatar" && method === "POST") {
          const body = await request.json();
          await sql`UPDATE majstori SET photo_url=${body.url} WHERE id=${body.id}`;
          return out({ success: true });
        }

        // ===== АЖУРИРАЊЕ НА БАНЕР =====
        if (path === "/api/update-cover" && method === "POST") {
          const body = await request.json();
          await sql`UPDATE majstori SET cover_url=${body.url} WHERE id=${body.id}`;
          return out({ success: true });
        }

        // ===== СТАТИСТИКА =====
        if (path === "/api/track" && method === "POST") {
          const body = await request.json();
          try {
            if(body.type==='view') await sql`UPDATE majstori SET views = COALESCE(views,0)+1 WHERE id=${body.majstor_id}`;
            if(body.type==='phone') await sql`UPDATE majstori SET phone_clicks = COALESCE(phone_clicks,0)+1 WHERE id=${body.majstor_id}`;
          } catch(e){ console.log(e.message); }
          return out({ success: true });
        }

        return out({ error: 'Not Found' }, 404);
      } catch (error) {
        return out({ error: "Worker Грешка: " + error.message }, 500);
      }
    }

    // 4. Ако не е API, врати статични файлови
    return env.ASSETS.fetch(request);
  },
};
