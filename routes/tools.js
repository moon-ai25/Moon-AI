/**
 * routes/tools.js — Stateless AI utility tools.
 *
 * IMPORTANT: These routes NEVER save anything to the database.
 *            They are one-shot Groq calls for UI-level tools.
 *
 * POST /api/fix-grammar    — Fix grammar/spelling of user input
 * POST /api/enhance-prompt — Enhance user prompt with role-based detail
 */

const express = require('express');
const router  = express.Router();

const { callGroqOnce }          = require('../services/groq');
const {
  getFixGrammarMessages,
  getEnhancePromptMessages
} = require('../services/systemPrompts');

// ─── Fix Grammar ──────────────────────────────────────────────────────────────

/**
 * POST /api/fix-grammar
 * Body: { text: string }
 * Response: { corrected: string }
 *
 * Flow: user types text in input box → clicks "Fix Grammar"
 *       → server fixes it → client replaces input box content.
 * NOT saved to chat history.
 */
router.post('/fix-grammar', async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }

  if (text.trim().length > 5000) {
    return res.status(400).json({ error: 'Text too long (max 5000 characters)' });
  }

  try {
    const messages  = getFixGrammarMessages(text.trim());
    const corrected = await callGroqOnce(messages);

    console.log('✍️  Grammar:    Applied');
    res.json({ corrected });
  } catch (err) {
    console.error('❌ Fix Grammar error:', err.message);
    res.status(500).json({ error: 'Grammar fix failed. Please try again.' });
  }
});

// ─── Enhance Prompt ───────────────────────────────────────────────────────────

/**
 * POST /api/enhance-prompt
 * Body: { text: string }
 * Response: { enhanced: string }
 *
 * Flow: user types rough idea in input box → clicks "Prompt Engine"
 *       → server enhances it → client replaces input box content.
 * NOT saved to chat history.
 */
router.post('/enhance-prompt', async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }

  if (text.trim().length > 3000) {
    return res.status(400).json({ error: 'Text too long (max 3000 characters)' });
  }

  try {
    const messages = getEnhancePromptMessages(text.trim());
    const enhanced = await callGroqOnce(messages);

    console.log('🧠 Prompt:     Enhanced');
    res.json({ enhanced });
  } catch (err) {
    console.error('❌ Enhance Prompt error:', err.message);
    res.status(500).json({ error: 'Prompt enhancement failed. Please try again.' });
  }
});

module.exports = router;
