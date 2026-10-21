export const config = {
  matcher: '/majstor.html',
};

export default async function middleware(request) {
  const url = new URL(request.url);
  
  // 1. Ако е внатрешно симнување или нема ID, пуши ја нормалната страница
  if (url.searchParams.has('internal_fetch') || !url.searchParams.has('id')) {
    return; 
  }

  const id = url.searchParams.get('id');
  const supabaseUrl = 'https://brxdimqgujhemgpfujcq.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJicnhkaW1xZ3VqaGVtZ3BmdWpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTgxMjYsImV4cCI6MjEwNDc5NDEyNn0.gh0vekUMPmzg5EbkGvaRFLfBL8SWsjGUvB1BY4H5T5Y';

  try {
    // 2. Бараме податоци за мајсторот
    const res = await fetch(`${supabaseUrl}/rest/v1/majstor_profiles?id=eq.${id}&select=name,photo_url,description,city`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    const data = await res.json();
    
    // Ако нема мајстор, пуши ја нормалната страница
    if (!data || data.length === 0) {
      return; 
    }

    const master = data[0];
    const title = `${master.name || 'Мајстор'} - Majsto.mk`;
    const desc = `Погледнете го профилот на ${master.name || 'Мајстор'} во ${master.city || 'Македонија'}.`;
    const masterImage = master.photo_url || 'https://majsto.mk/og-image.png';

    // 3. Ја симнуваме страницата со специјалниот параметар
    const fetchUrl = new URL(request.url);
    fetchUrl.searchParams.set('internal_fetch', 'true');
    
    const response = await fetch(fetchUrl.toString());
    let html = await response.text();

    // 4. Ги менуваме Open Graph таговите
    html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${title}">`);
    html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${desc}">`);
    html = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${masterImage}">`);
    
    html = html.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${title}">`);
    html = html.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${desc}">`);
    html = html.replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${masterImage}">`);

    // 5. Враќаме изменета страница
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  } catch (e) {
    // Ако нешто тргне наопаку, само пуши ја нормалната страница
    return; 
  }
}
