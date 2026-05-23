const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

(async () => {
  const query = "Elon Musk";
  const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&safeSearch=Active`;
  const res = await fetch(bingUrl, {
    agent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.bing.com/'
    }
  });
  const html = await res.text();
  console.log("HTML length:", html.length);
  
  const blocks = [...html.matchAll(/m=&quot;({.*?})&quot;/g)].map(m => m[1].replace(/&quot;/g, '"'));
  const images = [];
  for (const block of blocks) {
    try {
      const data = JSON.parse(block);
      if (data.murl && data.turl) {
        images.push(data.murl);
      }
    } catch(e) {}
  }
  console.log("Images found by JSON parse:", images.slice(0, 5));
  
  const murls = [...html.matchAll(/&quot;murl&quot;:&quot;(.*?)&quot;/g)].map(m => m[1]);
  console.log("Images found by regex:", murls.slice(0, 5));
})();
