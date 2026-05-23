const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

(async () => {
  const query = "Elon Musk";
  const yahooUrl = `https://images.search.yahoo.com/search/images?p=${encodeURIComponent(query)}`;
  const res = await fetch(yahooUrl, {
    agent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://images.search.yahoo.com/'
    }
  });
  const html = await res.text();
  console.log("HTML length:", html.length);
  const murls = [...html.matchAll(/imgurl=(.*?)&/g)].map(m => decodeURIComponent(m[1]));
  console.log("Images found:", murls.slice(0, 5));
})();
