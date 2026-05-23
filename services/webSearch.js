/**
 * webSearch.js — Web search service implementing the RAD model.
 *
 * Retrieve → Augment → Deliver
 *
 * Primary:  Google Custom Search JSON API (if GOOGLE_SEARCH_API_KEY is set)
 * Fallback: DuckDuckGo Instant Answer API (no key needed, limited results)
 *
 * Returns: { results: [...], images: [...] }
 *   results — top 5 text snippets  [{ title, snippet, url }]
 *   images  — 3-4 image results    [{ url, title, source }]
 */

require('dotenv').config();

const GOOGLE_API_KEY    = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_ENGINE_ID  = process.env.GOOGLE_SEARCH_ENGINE_ID;
const IMAGE_COUNT       = 6;   // increased from 4 to 6 for better coverage
const RESULT_COUNT      = 10;  // increased from 5 to 10 as requested

// ─── Google Custom Search ─────────────────────────────────────────────────────

async function googleTextSearch(query) {
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', GOOGLE_API_KEY);
  url.searchParams.set('cx',  GOOGLE_ENGINE_ID);
  url.searchParams.set('q',   query);
  url.searchParams.set('num', String(RESULT_COUNT));
  url.searchParams.set('safe', 'active');

  const res  = await fetch(url.toString());
  const data = await res.json();

  if (!res.ok) throw new Error(`Google Search API error: ${data.error?.message}`);

  const items = data.items || [];
  return items.map(item => ({
    title:   item.title   || '',
    snippet: item.snippet || '',
    url:     item.link    || ''
  }));
}

async function googleImageSearch(query) {
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key',       GOOGLE_API_KEY);
  url.searchParams.set('cx',        GOOGLE_ENGINE_ID);
  url.searchParams.set('q',         query);
  url.searchParams.set('searchType','image');
  url.searchParams.set('num',       String(IMAGE_COUNT));
  url.searchParams.set('safe',      'active');
  url.searchParams.set('imgSize',   'LARGE');

  const res  = await fetch(url.toString());
  const data = await res.json();

  if (!res.ok) throw new Error(`Google Image Search error: ${data.error?.message}`);

  const items = data.items || [];
  return items.slice(0, IMAGE_COUNT).map(item => ({
    url:    item.link                      || '',
    title:  item.title                     || '',
    source: item.displayLink               || '',
    thumb:  item.image?.thumbnailLink      || item.link || ''
  }));
}

async function ddgTextSearch(query) {
  const results = [];
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const https = require('https');
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    const res = await fetch(url, {
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    const html = await res.text();
    const blocks = [...html.matchAll(/<a class="result__url" href="(.*?)".*?>(.*?)<\/a>.*?<a class="result__snippet[^>]*>(.*?)<\/a>/gs)];
    
    for (const block of blocks.slice(0, RESULT_COUNT)) {
      let rawUrl = block[1];
      if (rawUrl.includes('//duckduckgo.com/l/?uddg=')) {
        rawUrl = decodeURIComponent(rawUrl.split('uddg=')[1].split('&')[0]);
      }
      
      results.push({
        url: rawUrl,
        title: block[2].replace(/<.*?>/g, '').trim(),
        snippet: block[3].replace(/<.*?>/g, '').trim()
      });
    }
    console.log(`🌐 DDG:      ${results.length} sources`);
  } catch (e) {
    console.error(`❌ DDG:      Failed ->`, e.message);
  }
  return results;
}

// ─── Wikimedia Image Search (100% Reliable Fallback) ──────────────────────────

async function wikiImageSearch(query) {
  const images = [];
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=10&pithumbsize=800`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.query && data.query.pages) {
      const pages = Object.values(data.query.pages);
      for (const page of pages) {
        if (page.thumbnail && page.thumbnail.source) {
          images.push({
            url: page.thumbnail.source,
            title: page.title,
            source: 'wikipedia.org',
            thumb: page.thumbnail.source
          });
        }
        if (images.length >= IMAGE_COUNT) break;
      }
    }
    
    // Proxy not strictly needed for Wiki, but keeps architecture consistent
    const PROXY_URL = 'http://192.168.29.65:3000/api/image-proxy?url=';
    return images.map(img => ({
      ...img,
      url: `${PROXY_URL}${encodeURIComponent(img.url)}&fallback=${encodeURIComponent(img.thumb)}`,
      thumb: `${PROXY_URL}${encodeURIComponent(img.thumb)}`
    }));
    
  } catch (e) {
    console.error(`❌ WikiImg:    Failed ->`, e.message);
  }
  return images;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * searchWeb — RAD Retrieve step.
 *
 * @param {string} query — the search topic/question
 * @returns {Promise<{ results: Array, images: Array }>}
 */
async function searchWeb(query) {
  let results = [];
  let images  = [];

  // Strip conversational filler to get clean search keywords
  const keywords = query.replace(/give me|the|photo|of|images|image|picture|pictures|show/gi, '').trim() || query;

  const hasGoogleKeys = GOOGLE_API_KEY && GOOGLE_ENGINE_ID;

  const mapFavicons = (list) => list.map(r => {
    try {
      const domain = new URL(r.url).hostname;
      // Using a more robust favicon service (GStatic) which is less likely to be blocked
      return { ...r, favicon: `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=64` };
    } catch (e) {
      return { ...r, favicon: '' };
    }
  });

  if (hasGoogleKeys) {
    // ── Primary: Google Custom Search ────────────────────────────────────────
    try {
      const [textRes, imgRes] = await Promise.all([
        googleTextSearch(keywords),
        googleImageSearch(keywords)
      ]);
      results = mapFavicons(textRes);
      images = imgRes;
    } catch (err) {
      console.warn(`⚠️ Google search failed: ${err.message}. Falling back…`);
      const [textRes, imgRes] = await Promise.all([
        ddgTextSearch(keywords),
        wikiImageSearch(keywords)
      ]);
      results = mapFavicons(textRes);
      images = imgRes;
    }
  } else {
    // ── Fallback: DuckDuckGo Text + Wikimedia Images ─────────────────────────
    const [textResults, imgResults] = await Promise.all([
      ddgTextSearch(keywords).catch(() => []),
      wikiImageSearch(keywords)
    ]);
    results = mapFavicons(textResults);
    images  = imgResults;
  }

  return { results, images };
}

module.exports = { searchWeb };
