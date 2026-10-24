export default async function handler(req, res) {
    const { id } = req.query;
    
    // Ако нема ID, врати обична страница
    if (!id) {
        return res.redirect('/majstor.html');
    }

    // Податоци за Supabase
    const SUPABASE_URL = 'https://brxdimqgujhemgpfujcq.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyeGRpbXFndWpoZW1ncGZ1amNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTgxMjYsImV4cCI6MjEwNDc5NDEyNn0.gh0vekUMPmzg5EbkGvaRFLfBL8SWsjGUvB1BY4H5T5Y';

    try {
        // Земaме податоци за мајсторот
        const response = await fetch(`${SUPABASE_URL}/rest/v1/majstor_profiles?id=eq.${id}&select=*`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });
        const data = await response.json();
        const majstor = data[0];

        if (!majstor) {
            return res.redirect('/majstor.html');
        }

        const title = `${majstor.name} — ${majstor.category} во ${majstor.city} | Majsto.mk`;
        const description = majstor.description ? majstor.description.substring(0, 150) + '...' : `Проверен мајстор за ${majstor.category}. Кликни за контакт.`;
        const image = majstor.photo_url || 'https://majsto.mk/icon-512.png'; // Ако нема слика, земи лого
        const url = `https://majsto.mk/majstor.html?id=${id}`;

        // HTML што Facebook ќе го види
        const html = `
            <!DOCTYPE html>
            <html lang="mk">
            <head>
                <meta charset="UTF-8">
                <meta property="og:title" content="${title}" />
                <meta property="og:description" content="${description}" />
                <meta property="og:image" content="${image}" />
                <meta property="og:url" content="${url}" />
                <meta property="og:type" content="profile" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="${title}" />
                <meta name="twitter:description" content="${description}" />
                <meta name="twitter:image" content="${image}" />
                <!-- Пренасочување за вистинските корисници кон вистинската страница -->
                <script>window.location.href = "${url}";</script>
            </head>
            <body>
                <p>Пренасочување кон профилот на ${majstor.name}...</p>
            </body>
            </html>
        `;

        res.setHeader('Content-Type', 'text/html');
        return res.status(200).send(html);

    } catch (error) {
        return res.redirect('/majstor.html');
    }
}
