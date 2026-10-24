export default async function handler(req, res) {
    const { id } = req.query;
    
    // Ако нема ID, врати обична страница (или пренасочи кон почетна)
    if (!id) {
        return res.redirect('/');
    }

    // Твоите Supabase податоци
    const SUPABASE_URL = 'https://brxdimqgujhemgpfujcq.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyeGRpbXFndWpoZW1ncGZ1amNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTgxMjYsImV4cCI6MjEwNDc5NDEyNn0.gh0vekUMPmzg5EbkGvaRFLfBL8SWsjGUvB1BY4H5T5Y';

    try {
        // 1. Земaме податоци за мајсторот од базата
        const response = await fetch(`${SUPABASE_URL}/rest/v1/majstor_profiles?id=eq.${id}&select=*`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });
        
        const data = await response.json();
        const majstor = data[0];

        // Ако не најде таков мајстор, пренасочи кон почетна
        if (!majstor) {
            return res.redirect('/');
        }

        // 2. Ги подготвуваме текстовите и сликата за Facebook
        const title = `${majstor.name} — ${majstor.category} во ${majstor.city} | Majsto.mk`;
        const description = majstor.description 
            ? majstor.description.substring(0, 150) + '...' 
            : `Проверен мајстор за ${majstor.category}. Кликни за контакт.`;
        
        // Ако мајсторот има слика, земи ја. Ако не, земи го логото на сајтот.
        const image = majstor.photo_url || 'https://majsto.mk/icon-512.png';
        
        // ВАЖНО: Овде линкот останува на majstor.html за Facebook да го чита овој код
        const url = `https://majsto.mk/majstor.html?id=${id}`;

        // 3. HTML кодот што Facebook ќе го види
        const html = `
            <!DOCTYPE html>
            <html lang="mk">
            <head>
                <meta charset="UTF-8">
                
                <!-- Meta тагови за Facebook, Viber, WhatsApp -->
                <meta property="og:title" content="${title}" />
                <meta property="og:description" content="${description}" />
                <meta property="og:image" content="${image}" />
                <meta property="og:url" content="${url}" />
                <meta property="og:type" content="profile" />
                
                <!-- Meta тагови за Twitter -->
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="${title}" />
                <meta name="twitter:description" content="${description}" />
                <meta name="twitter:image" content="${image}" />
                
                <!-- Ова го пренасочува вистинскиот клиент кон вистинската страница -->
                <script>window.location.href = "https://majsto.mk/profile.html?id=${id}";</script>
            </head>
            <body>
                <p>Пренасочување кон профилот на ${majstor.name}...</p>
            </body>
            </html>
        `;

        // 4. Му враќаме на Facebook дека е успешно
        res.setHeader('Content-Type', 'text/html');
        return res.status(200).send(html);

    } catch (error) {
        // Ако има некаква грешка, врати го на почетна
        return res.redirect('/');
    }
}
