const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

(async () => {
  const query = "Elon Musk";
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    agent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    }
  });
  const html = await res.text();
  console.log("HTML length:", html.length);
  const blocks = [...html.matchAll(/<a class="result__url" href="(.*?)".*?>(.*?)<\/a>.*?<a class="result__snippet[^>]*>(.*?)<\/a>/gs)];
  const results = blocks.map(b => ({
    url: decodeURIComponent(b[1].replace('//duckduckgo.com/l/?uddg=', '').split('&')[0]),
    title: b[2].replace(/<.*?>/g, '').trim(),
    snippet: b[3].replace(/<.*?>/g, '').trim()
  }));
  console.log("Results found:", results.slice(0, 2));
})();
