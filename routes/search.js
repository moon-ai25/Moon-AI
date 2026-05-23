/**
 * routes/search.js — Web Search with RAD (Retrieve → Augment → Deliver) model.
 *
 * POST /api/web-search
 *   Body: { query, username?, chatTitle? }
 *   Response: { reply, images, sources, query }
 *
 * Flow:
 *   1. RETRIEVE  — fetch web results + images via webSearch service
 *   2. AUGMENT   — inject results into system prompt context
 *   3. DELIVER   — call Groq, return AI reply + image array + source list
 */

const express = require('express');
const router  = express.Router();

const { searchWeb }                = require('../services/webSearch');
const { callGroq }                 = require('../services/groq');
const { getWebSearchSystemMessages } = require('../services/systemPrompts');

/**
 * POST /api/web-search
 */
router.post('/web-search', async (req, res) => {
  const { query, username, chatTitle } = req.body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'query is required' });
  }

  const trimmedQuery = query.trim();
  console.log(`🌐 [WebSearch] Query: "${trimmedQuery}" — user: ${username || 'anon'}`);

  try {
    // ── 1. RETRIEVE ───────────────────────────────────────────────────────────
    const { results, images } = await searchWeb(trimmedQuery);

    if (results.length === 0 && images.length === 0) {
      // If retrieval fully failed, answer from model knowledge
      console.warn('⚠️ No web results found — answering from model knowledge');
      const { callGroq: groqCall } = require('../services/groq');
      const { getSystemMessages }  = require('../services/systemPrompts');
      const fallbackMessages = [
        ...require('../services/systemPrompts').getSystemMessages(),
        { role: 'user', content: trimmedQuery }
      ];
      const reply = await groqCall(fallbackMessages);
      return res.json({
        reply,
        images:  [],
        sources: [],
        query:   trimmedQuery,
        note:    'Web search unavailable — answered from training data'
      });
    }

    // ── 2. AUGMENT ────────────────────────────────────────────────────────────
    const systemMessages = getWebSearchSystemMessages(results);
    const messages = [
      ...systemMessages,
      {
        role:    'user',
        content: trimmedQuery
      }
    ];

    // ── 3. DELIVER ────────────────────────────────────────────────────────────
    const reply = await callGroq(messages);

    console.log(`✅ Web search complete — ${results.length} results, ${images.length} images`);

    res.json({
      reply,
      images:  images,   // Array<{ url, title, source, thumb }>
      sources: results,  // Array<{ title, snippet, url }>
      query:   trimmedQuery
    });

  } catch (err) {
    console.error('❌ Web search error:', err.message);
    res.status(500).json({ error: 'Web search failed. Please try again.' });
  }
});

module.exports = router;
