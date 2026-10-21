export const config = {
  matcher: '/majstor.html',
};

export default async function middleware(request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return new Response(null, { headers: { 'x-middleware-next': '1' } });
  }

  const supabaseUrl = 'https://brxdimqgujhemgpfujcq.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyeGRpbXFndWpoZW1ncGZ1amNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTgxMjYsImV4cCI6MjEwNDc5NDEyNn0.gh0vekUMPmzg5EbkGvaRFLfBL8SWsjGUvB1BY4H5T5Y';

  try {
    // 1. Бараме податоци за мајсторот од Supabase
    const res = await fetch(`${supabaseUrl}/rest/v1/majstor_profiles?id=eq.${id}&select=name,photo_url,description,city`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    const data = await res.json();
    
    if (!data || data.length === 0) {
      return new Response(null, { headers: { 'x-middleware-next': '1' } });
    }

    const master = data[0];
    const masterName = master.name || 'Мајстор';
    const masterImage = master.photo_url || 'https://majsto.mk/og-image.png';
    const title = `${masterName} - Majsto.mk`;
    const desc = `Погледнете го профилот на ${masterName} во ${master.city || 'Македонија'}.`;

    // 2. Го земаме оригиналниот HTML
    const response = await fetch(request);
    let html = await response.text();

    // 3. Ги менуваме Open Graph таговите (ВНИМАВАЈ НА > НА КРАЈ)
    html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${title}">`);
    html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${desc}">`);
    html = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${masterImage}">`);
    html = html.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${title}">`);
    html = html.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${desc}">`);
    html = html.replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${masterImage}">`);

    return new Response(html, {
      headers: response.headers,
    });
  } catch (e) {
    return new Response(null, { headers: { 'x-middleware-next': '1' } });
  }
}
