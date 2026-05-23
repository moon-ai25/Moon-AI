/**
 * routes/chat.js — All chat endpoints.
 *
 * AI Messaging:
 *   POST /api/chat                   — Send message & get AI reply
 *                                      isPrivate:true → reply returned, NOTHING saved to DB
 *
 * Chat Management (DB-backed):
 *   POST /api/save-chat              — Create or update a chat session
 *   GET  /api/chats-by-username/:u  — List all chats for a user
 *   GET  /api/chat                  — Load messages (by ?username=&title=)
 *   GET  /api/chat/:username/:id    — Load chat by ID
 *   POST /api/delete-chat           — Delete a chat by title
 *   POST /api/rename-chat           — Rename a chat
 *   POST /api/delete-chat-by-title  — Alias delete
 *
 * Edit & Regenerate:
 *   POST /api/chat/edit-message     — Edit a message, truncate after it, regenerate AI reply
 *   POST /api/chat/regenerate       — Remove last assistant reply, generate a new one
 *
 * Sharing:
 *   POST /api/share-chat            — Create a shareable snapshot
 *   GET  /shared/:id                — Retrieve shared chat
 *
 * Public API:
 *   POST /api/MOONAIAPI-820211022212 — External API endpoint with minimal system prompt
 */

const express = require('express');
const router  = express.Router();

const Chat       = require('../models/Chat');
const SharedChat = require('../models/SharedChat');
const User       = require('../models/User');

const { callGroq, trimConversation }    = require('../services/groq');
const {
  getSystemMessages,
  getPublicApiSystemMessages
} = require('../services/systemPrompts');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cleanMessage({ role, content }) {
  return { role, content };
}

function isValidMessage(m) {
  return m && typeof m === 'object' &&
    typeof m.role === 'string' &&
    typeof m.content === 'string';
}

// ─── POST /api/chat ───────────────────────────────────────────────────────────

/**
 * Main chat endpoint.
 *
 * Body:
 *   messages    {Array}   — full conversation history from client
 *   isPrivate   {boolean} — if true, response is returned but NOTHING is saved to DB
 *   username    {string}  — optional, for context logging
 *
 * Response: { reply }
 */
router.post('/chat', async (req, res) => {
  const { messages, isPrivate = false, username } = req.body;

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const cleanMessages = messages
      .filter(isValidMessage)
      .map(cleanMessage)
      .slice(-30); // keep last 30 messages max

    const lastMsg = cleanMessages[cleanMessages.length - 1];
    let reply = '';
    let images = [];
    let sources = [];

    async function checkWebSearchNeeded(text) {
      const q = text.toLowerCase().trim();

      // ── HARD NO: never web-search these ──────────────────────────────────────
      const hardNo = [
        // AI identity / self-referential
        /^who are (you|u)[?!.]*$/,
        /^what are you[?!.]*$/,
        /^(tell me )?about (you|yourself)[?!.]*$/,
        /^(are you|r u) (an? )?(ai|bot|robot|human|real|alive)[?!.]*$/,
        /^what('?s| is) (your )?(name|purpose|goal|job|function)[?!.]*$/,
        /^who (created|made|developed|programmed|built) (you|u|this)[?!.]*$/,
        /^who is your (creator|maker|developer|boss)[?!.]*$/,
        // Greetings & small talk
        /^(hi+|hey+|hello|hola|sup|yo|howdy|greetings)[!.,?]*$/,
        /^how are (you|u)[?!.]*$/,
        /^(good )?(morning|afternoon|evening|night)[?!.,]*$/,
        /^(what'?s up|wassup|wazzup)[?!.]*$/,
        /^(thanks|thank you|thx|ty|cheers|np)[!.,?]*$/,
        /^(ok|okay|sure|yes|no|yep|nope|alright|gotcha|got it|cool|nice|great)[!.,?]*$/,
        /^(bye|goodbye|see ya|cya|good ?bye)[!.,?]*$/,
        // Code & format requests
        /\b(write|generate|create|make|give me|show me|give).{0,30}(code|program|script|function|class|snippet|algorithm)\b/,
        /\bcode\b.{0,20}\b(in|using|with)\b/,
        /(\.json|\.xml|\.csv|\.md|\.yaml|markdown format|json format|xml format|as code)/,
        // Math / calculations
        /^[\d\s+\-*/^()=<>%.]+$/,
        /\b(calculate|compute|solve|simplify|evaluate|convert)\b/,
        /\bwhat is \d/,
        // Generic explanations / educational — AI knows from training
        /^(explain|describe|define) /,
        /^how (does|do|to) /,
        /^why (does|do|is|are) /,
        /^what (does|do) .{0,40} (mean|stand for|do)[?!.]*$/,
        /^can (you )?(explain|help|tell)/,
        /^please (explain|describe|help|tell)/,
        // Creative writing
        /\b(write|compose|draft|create).{0,20}(story|poem|essay|letter|email|article|blog|caption|song|lyrics)\b/,
        // Jokes / fun
        /\b(tell me a|give me a).{0,10}(joke|riddle|fun fact|quote|pun)\b/,
      ];

      for (const pattern of hardNo) {
        if (pattern.test(q)) {
          console.log(`🏠 [Router] Static match: "${text.slice(0, 30)}..."`);
          return false;
        }
      }

      // ── AI Router for remaining ambiguous queries ──────────────────────────────
      try {
        const decision = await callGroq([
          { 
            role: 'system', 
            content: `You are the Search Router for Moon AI. Your ONLY job is to output "YES" if a web search is needed, or "NO" if it is not.
            
CRITICAL RULES:
1. Output "NO" for AI identity questions (e.g., "who are you", "who created you").
2. Output "NO" for greetings, math, code generation, logic puzzles, or basic knowledge you already know.
3. Output "NO" for formatting requests (e.g., "give me as md file").
4. Output "YES" ONLY for:
   - Specific real-world people (actors, politicians, public figures) to get their bio/news.
   - Products, movies, companies, or recent releases.
   - Latest news, live scores, current events, weather, or real-time prices.
   - Specific requests for images/photos of real things.
   
Respond with exactly one word: "YES" or "NO".`
          },
          { role: 'user', content: text }
        ]);
        
        const needsSearch = decision.toUpperCase().includes('YES');
        console.log(`🤖 [Router] ${needsSearch ? '🌐 Search Needed' : '🏠 LLM Response'} -> "${text.slice(0, 30)}..."`);
        return needsSearch;
      } catch (e) {
        // Fallback if API fails
        const isLookupIntent = /^(who|what|where|tell me about)\b/i.test(q);
        return isLookupIntent;
      }
    }

    if (lastMsg && lastMsg.role === 'user') {
      const q = lastMsg.content;
      const isTitleGen = q.toLowerCase().includes('generate a short 3-5 word title');
      
      if (!isTitleGen) {
        const wantsSearch = await checkWebSearchNeeded(q);
        if (wantsSearch) {
          try {
            const { searchWeb } = require('../services/webSearch');
            const { getWebSearchSystemMessages } = require('../services/systemPrompts');
            const searchData = await searchWeb(q);
            
            if (searchData.results.length > 0 || searchData.images.length > 0) {
              images = searchData.images;
              sources = searchData.results;
              
              const systemMessages = getWebSearchSystemMessages(sources);
              const fullMessages = trimConversation(systemMessages, cleanMessages);
              reply = await callGroq(fullMessages);
            }
          } catch (e) {
            console.error('❌ Search:    Failed ->', e.message);
          }
        }
      }
    }

    if (!reply) {
      const { getSystemMessages } = require('../services/systemPrompts');
      const systemMessages = getSystemMessages();
      const fullMessages   = trimConversation(systemMessages, cleanMessages);
      reply = await callGroq(fullMessages);
    }

    if (isPrivate) {
      console.log(`🔒 Private:   ${username || 'Anonymous'}`);
    }

    res.json({ reply, images, sources });
  } catch (err) {
    console.error('❌ /api/chat error:', err.message);
    res.status(500).json({ error: 'Chat failed', details: err.message });
  }
});

// ─── POST /api/save-chat ─────────────────────────────────────────────────────

router.post('/save-chat', async (req, res) => {
  const { userId, username, title, folder, messages } = req.body;

  if (!username || !title || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'username, title, and messages[] are required' });
  }

  // Preserve images/sources/attachedImageUrls for rich messages
  const cleanMessages = messages
    .filter(isValidMessage)
    .filter(m => m.role !== 'system')
    .map(({ role, content, images, sources, attachedImageUrls }) => ({
      role,
      content,
      ...(images && images.length > 0 ? { images } : {}),
      ...(sources && sources.length > 0 ? { sources } : {}),
      ...(attachedImageUrls && attachedImageUrls.length > 0 ? { attachedImageUrls } : {})
    }));

  try {
    let chat = await Chat.findOne({ username, title });

    if (!chat) {
      chat = new Chat({ userId, username, title, folder: folder || 'Default', messages: cleanMessages });
      await chat.save();
    } else {
      // Overwrite entirely to ensure edits and streaming updates are saved
      chat.messages = cleanMessages;
      if (folder) chat.folder = folder;
      await chat.save();
    }

    // Ensure title appears in user's folder list
    await User.findOneAndUpdate(
      { username },
      { $addToSet: { folders: title } }
    );

    res.json({ message: 'Chat saved successfully', chatId: chat._id });
  } catch (err) {
    console.error('❌ save-chat error:', err.message);
    res.status(500).json({ error: 'Failed to save chat' });
  }
});

// ─── GET /api/chats-by-username/:username ────────────────────────────────────

router.get('/chats-by-username/:username', async (req, res) => {
  try {
    const chats = await Chat
      .find({ username: req.params.username })
      .sort({ updatedAt: -1 })
      .select('_id title folder createdAt updatedAt'); // Metadata only, no messages

    res.json({ chats });
  } catch (err) {
    console.error('❌ chats-by-username error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/chat?username=&title= ─────────────────────────────────────────

router.get('/chat', async (req, res) => {
  const { username, title } = req.query;
  if (!username || !title) {
    return res.status(400).json({ error: 'username and title are required' });
  }

  try {
    const chat = await Chat.findOne({ username, title });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat.messages);
  } catch (err) {
    console.error('❌ GET chat error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/chat/:username/:id ─────────────────────────────────────────────

router.get('/chat/:username/:id', async (req, res) => {
  const { username, id } = req.params;
  try {
    const chat = await Chat.findOne({ _id: id, username });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/delete-chat ───────────────────────────────────────────────────

router.post('/delete-chat', async (req, res) => {
  const { username, title } = req.body;
  if (!username || !title) {
    return res.status(400).json({ error: 'username and title are required' });
  }

  try {
    await Chat.findOneAndDelete({ username, title });
    await User.findOneAndUpdate({ username }, { $pull: { folders: title } });
    res.json({ message: 'Chat deleted successfully' });
  } catch (err) {
    console.error('❌ delete-chat error:', err.message);
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

// ─── POST /api/delete-chat-by-title (alias) ──────────────────────────────────

router.post('/delete-chat-by-title', async (req, res) => {
  const { username, title } = req.body;
  try {
    await Chat.deleteMany({ username, title });
    await User.findOneAndUpdate({ username }, { $pull: { folders: title } });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ─── POST /api/rename-chat ───────────────────────────────────────────────────

router.post('/rename-chat', async (req, res) => {
  const { username, oldTitle, newTitle } = req.body;
  if (!username || !oldTitle || !newTitle) {
    return res.status(400).json({ error: 'username, oldTitle, and newTitle are required' });
  }

  try {
    const existing = await Chat.findOne({ username, title: newTitle });
    if (existing) {
      return res.status(400).json({ error: 'A chat with this title already exists' });
    }

    const updated = await Chat.findOneAndUpdate(
      { username, title: oldTitle },
      { $set: { title: newTitle } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    // Update user folders list
    await User.updateOne({ username }, { $pull:    { folders: oldTitle } });
    await User.updateOne({ username }, { $addToSet: { folders: newTitle } });

    res.json({ message: 'Chat renamed successfully' });
  } catch (err) {
    console.error('❌ rename-chat error:', err.message);
    res.status(500).json({ error: 'Failed to rename chat' });
  }
});

// ─── POST /api/chat/edit-message ─────────────────────────────────────────────

/**
 * Edit a specific message in a saved chat, truncate all messages after it,
 * then call AI to generate a new reply from the edited point.
 *
 * Body: { username, title, msgIndex, newContent }
 *   msgIndex  — 0-based index of the message to edit (must be a user message)
 *   newContent — the new content for that message
 *
 * Response: { reply, updatedMessages }
 */
router.post('/chat/edit-message', async (req, res) => {
  const { username, title, msgIndex, newContent } = req.body;

  if (!username || !title || msgIndex === undefined || !newContent) {
    return res.status(400).json({ error: 'username, title, msgIndex, and newContent are required' });
  }

  try {
    const chat = await Chat.findOne({ username, title });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const idx = parseInt(msgIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= chat.messages.length) {
      return res.status(400).json({ error: `Invalid msgIndex: ${msgIndex}` });
    }

    // ── Edit the message ──────────────────────────────────────────────────────
    chat.messages[idx].content = newContent;
    chat.messages[idx].edited  = true;

    // ── Truncate everything after the edited message ──────────────────────────
    chat.messages = chat.messages.slice(0, idx + 1);

    // ── Build history for AI call ─────────────────────────────────────────────
    const history        = chat.messages.map(cleanMessage);
    const systemMessages = getSystemMessages();
    const fullMessages   = trimConversation(systemMessages, history);

    // ── Get AI reply ──────────────────────────────────────────────────────────
    const reply = await callGroq(fullMessages);

    // ── Append AI reply to chat ───────────────────────────────────────────────
    chat.messages.push({ role: 'assistant', content: reply });
    await chat.save();

    console.log(`✏️ Message edited at index ${idx} for chat "${title}" (${username})`);

    res.json({
      reply,
      updatedMessages: chat.messages
    });
  } catch (err) {
    console.error('❌ edit-message error:', err.message);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// ─── POST /api/chat/regenerate ────────────────────────────────────────────────

/**
 * Regenerate the last assistant message in a saved chat.
 *
 * Body: { username, title }
 *
 * Response: { reply, updatedMessages }
 */
router.post('/chat/regenerate', async (req, res) => {
  const { username, title } = req.body;

  if (!username || !title) {
    return res.status(400).json({ error: 'username and title are required' });
  }

  try {
    const chat = await Chat.findOne({ username, title });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    if (chat.messages.length === 0) {
      return res.status(400).json({ error: 'Chat is empty — nothing to regenerate' });
    }

    // ── Remove last assistant message (if any) ────────────────────────────────
    const lastMsg = chat.messages[chat.messages.length - 1];
    if (lastMsg.role === 'assistant') {
      chat.messages.pop();
    }

    if (chat.messages.length === 0) {
      return res.status(400).json({ error: 'No user message to respond to' });
    }

    // ── Build history and call AI ─────────────────────────────────────────────
    const history        = chat.messages.map(cleanMessage);
    const systemMessages = getSystemMessages();
    const fullMessages   = trimConversation(systemMessages, history);

    const reply = await callGroq(fullMessages);

    // ── Append new reply ──────────────────────────────────────────────────────
    chat.messages.push({ role: 'assistant', content: reply });
    await chat.save();

    console.log(`🔄 Regenerated reply for chat "${title}" (${username})`);

    res.json({
      reply,
      updatedMessages: chat.messages
    });
  } catch (err) {
    console.error('❌ regenerate error:', err.message);
    res.status(500).json({ error: 'Failed to regenerate reply' });
  }
});

// ─── POST /api/chat/feedback ─────────────────────────────────────────────────

/**
 * Store per-message like/dislike feedback.
 *
 * Body: { username, chatId, messageIndex, feedback }
 *   feedback — 'like' | 'dislike' | null (null = remove)
 *
 * Response: { success }
 */
router.post('/chat/feedback', async (req, res) => {
  const { username, chatId, messageIndex, feedback } = req.body;

  if (!username || !chatId || messageIndex === undefined) {
    return res.status(400).json({ error: 'username, chatId, and messageIndex are required' });
  }

  const allowed = ['like', 'dislike', null];
  if (!allowed.includes(feedback)) {
    return res.status(400).json({ error: 'feedback must be "like", "dislike", or null' });
  }

  try {
    const chat = await Chat.findOne({ _id: chatId, username });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const idx = parseInt(messageIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= chat.messages.length) {
      return res.status(400).json({ error: `Invalid messageIndex: ${messageIndex}` });
    }

    chat.messages[idx].feedback = feedback;
    await chat.save();

    console.log(`👍 Feedback "${feedback}" recorded at index ${idx} for chat "${chat.title}" (${username})`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ feedback error:', err.message);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// ─── POST /api/share-chat ─────────────────────────────────────────────────────

router.post('/share-chat', async (req, res) => {
  const { username, title } = req.body;
  if (!username || !title) {
    return res.status(400).json({ error: 'username and title are required' });
  }

  try {
    const chat = await Chat.findOne({ username, title });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const shared = new SharedChat({
      title,
      username,
      messages: chat.messages
        .filter(m => m.role !== 'system')
        .map(({ role, content }) => ({ role, content }))
    });

    await shared.save();
    res.json({ shareId: shared._id });
  } catch (err) {
    console.error('❌ share-chat error:', err.message);
    res.status(500).json({ error: 'Failed to share chat' });
  }
});

// ─── GET /shared/:id ─────────────────────────────────────────────────────────

router.get('/shared/:id', async (req, res) => {
  try {
    const shared = await SharedChat.findById(req.params.id);
    if (!shared) return res.status(404).json({ error: 'Shared chat not found' });
    res.json(shared);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Public API endpoint ─────────────────────────────────────────────────────

router.post('/MOONAIAPI-820211022212', async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const cleanMessages  = messages.filter(isValidMessage).map(cleanMessage);
    const systemMessages = getPublicApiSystemMessages();
    const fullMessages   = [...systemMessages, ...cleanMessages.slice(-20)];

    const reply = await callGroq(fullMessages);
    res.json({ reply });
  } catch (err) {
    console.error('❌ Public API error:', err.message);
    res.status(500).json({ error: 'All models failed', details: err.message });
  }
});

module.exports = router;
