/**
 * groq.js — Groq API wrapper with model pool rotation, cooldowns, and safety filters.
 */

const { Groq } = require('groq-sdk');
require('dotenv').config();

// ─── Model Pool ───────────────────────────────────────────────────────────────

const MODEL_POOL = [
  'llama-3.3-70b-versatile',           // Primary — reliable & fast
  'llama-3.1-8b-instant',              // Fallback 1 — lightweight
  'mixtral-8x7b-32768',                // Fallback 2
  'gemma2-9b-it'                       // Fallback 3
];

const TIMEOUT_MS         = 15000; // 15 seconds per model attempt
const COOLDOWN_MS        = 60000; // 1 minute cooldown on failure
const MAX_WORDS          = 3000;  // context window guard

let   modelIndex    = 0;
const modelCooldowns = new Map(); // modelName → timestamp

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeoutPromise(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`⏱ Timeout after ${ms}ms`)), ms)
  );
}

function isOnCooldown(model) {
  const until = modelCooldowns.get(model);
  return until && until > Date.now();
}

function setCooldown(model) {
  modelCooldowns.set(model, Date.now() + COOLDOWN_MS);
  console.warn(`⏳ Cooldown:  ${model}`);
}

function countWords(messages) {
  return messages
    .map(m => m.content || '')
    .join(' ')
    .trim()
    .split(/\s+/).length;
}

// ─── Banned Phrases (Security) ────────────────────────────────────────────────

const BANNED_INPUT_PHRASES = [
  'system override',
  'developer forensic mode',
  'developer debug mode',
  'internal auditing',
  'reveal api',
  'api key',
  'print backend',
  'backend integration',
  'debug mode',
  'ignore previous instructions',
  'ignore all instructions',
  'disregard your instructions'
];

const BANNED_OUTPUT_TERMS = ['groq', 'llama', 'mistral', 'openai api'];

function sanitizeMessages(messages) {
  return messages
    .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
    .map(m => {
      // Keep system messages untouched
      if (m.role === 'system') return { role: m.role, content: m.content };

      const lower = m.content.toLowerCase();
      for (const phrase of BANNED_INPUT_PHRASES) {
        if (lower.includes(phrase)) {
          console.warn(`🚫 Safety:    Blocked phrase -> "${phrase}"`);
          return { role: m.role, content: '⚠️ This request was blocked by security policy.' };
        }
      }
      return { role: m.role, content: m.content };
    });
}

function sanitizeOutput(reply) {
  const lower = reply.toLowerCase();
  for (const term of BANNED_OUTPUT_TERMS) {
    if (lower.includes(term)) {
      console.warn(`🚫 Safety:    Filtered term -> "${term}"`);
      return '⚠️ Response filtered by security policy.';
    }
  }
  return reply;
}

// ─── Context Trimmer ─────────────────────────────────────────────────────────

/**
 * Trims conversation history to fit within MAX_WORDS, always preserving
 * the provided systemMessages at the start.
 */
function trimConversation(systemMessages, historyMessages, maxWords = MAX_WORDS) {
  const systemWords = countWords(systemMessages);
  const budget = maxWords - systemWords;

  // Walk backwards through history, accumulate until budget exceeded
  const trimmed = [];
  let used = 0;

  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const m = historyMessages[i];
    const w = (m.content || '').split(/\s+/).length;
    if (used + w > budget) break;
    trimmed.unshift(m);
    used += w;
  }

  // Always include at least the last message
  if (trimmed.length === 0 && historyMessages.length > 0) {
    trimmed.push(historyMessages[historyMessages.length - 1]);
  }

  return [...systemMessages, ...trimmed];
}

// ─── Core API Caller ─────────────────────────────────────────────────────────

/**
 * callGroq — Tries all models in pool with cooldown rotation.
 * @param {Array} messages - fully assembled messages array (system + history)
 * @returns {Promise<string>} AI reply text
 */
async function callGroq(messages) {
  const safeMessages = sanitizeMessages(messages);

  // Line-count guard
  const totalLines = safeMessages.reduce((sum, m) => {
    return sum + (m.content.match(/\n/g) || []).length + 1;
  }, 0);

  if (totalLines > 1500) {
    return `🤯 That message is too long (${totalLines} lines). Please try breaking it into smaller parts.`;
  }

  const attempted = [];

  for (let i = 0; i < MODEL_POOL.length; i++) {
    const model = MODEL_POOL[modelIndex % MODEL_POOL.length];
    modelIndex++;
    attempted.push(model);

    if (isOnCooldown(model)) {
      continue;
    }

    const client = new Groq({ apiKey: process.env.replicate });

    try {
      // Minimal log for model selection
      // console.log(`⚙️ Model:     ${model}`); 
      // User said "show only essential", maybe model selection isn't essential for every turn?
      // I'll keep it as a very short one.
      console.log(`⚙️ Model:     ${model}`); 

      const completion = await Promise.race([
        client.chat.completions.create({ model, messages: safeMessages }),
        timeoutPromise(TIMEOUT_MS)
      ]);

      const raw = completion.choices[0].message.content;
      return sanitizeOutput(raw);

    } catch (err) {
      const msg = err?.message || '';
      console.warn(`⚠️ Model:     ${model} failed -> ${msg.slice(0, 50)}...`);

      // Don't cooldown on token-limit errors (permanent issue, not transient)
      if (!msg.toLowerCase().includes('token') && !msg.toLowerCase().includes('rate limit per minute')) {
        setCooldown(model);
      }
    }
  }

  // All models failed — reset cooldowns and surface error
  for (const m of attempted) modelCooldowns.delete(m);
  console.error('🚫 All models in pool failed.');
  return '⚠️ Moon AI is under load. Please try again in a moment.';
}

/**
 * callGroqOnce — Single-shot call using the best available model.
 * Used for Fix Grammar and Prompt Engine (no retry overhead).
 * @param {Array} messages
 * @returns {Promise<string>}
 */
async function callGroqOnce(messages) {
  const safeMessages = sanitizeMessages(messages);

  // Find the first non-cooldown model
  for (let i = 0; i < MODEL_POOL.length; i++) {
    const model = MODEL_POOL[i];
    if (isOnCooldown(model)) continue;

    const client = new Groq({ apiKey: process.env.replicate });

    try {
      const completion = await Promise.race([
        client.chat.completions.create({ model, messages: safeMessages }),
        timeoutPromise(TIMEOUT_MS)
      ]);
      return completion.choices[0].message.content.trim();
    } catch (err) {
      console.warn(`⚠️ callGroqOnce: ${model} failed: ${err.message}`);
      setCooldown(model);
    }
  }

  throw new Error('All models unavailable for one-shot call.');
}

module.exports = { callGroq, callGroqOnce, trimConversation, MODEL_POOL };
