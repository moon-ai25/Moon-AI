/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║                     Moon AI — server.js                     ║
 * ║              Backend Entry Point (Complete Rewrite)          ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Architecture:                                               ║
 * ║    routes/auth.js    — Auth, register, OTP, Google OAuth     ║
 * ║    routes/chat.js    — Chat AI, save/load, edit, regenerate  ║
 * ║    routes/tools.js   — Fix Grammar, Enhance Prompt           ║
 * ║    routes/search.js  — Web Search (RAD model) + images       ║
 * ║    routes/admin.js   — Server status, logs, user admin       ║
 * ║    routes/upload.js  — Cloudinary image upload               ║
 * ║    services/groq.js  — Model pool, fallback, safety filter   ║
 * ║    services/webSearch.js — Google/DDG search + images        ║
 * ║    services/systemPrompts.js — Single source of truth        ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';
require('dotenv').config();

const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const path      = require('path');
const http      = require('http');
const { Server: SocketIO } = require('socket.io');
const { v2: cloudinary }   = require('cloudinary');
const os        = require('os');

// ─── Route Modules ────────────────────────────────────────────────────────────

const authRouter            = require('./routes/auth');
const chatRouter            = require('./routes/chat');
const toolsRouter           = require('./routes/tools');
const searchRouter          = require('./routes/search');
const uploadRouter          = require('./routes/upload');
const { router: adminRouter, collectLog } = require('./routes/admin');

// ─── App & Server Setup ───────────────────────────────────────────────────────

const app        = express();
const httpServer = http.createServer(app);
const io         = new SocketIO(httpServer, {
  cors: {
    origin: [
      'https://moon-ai-rust.vercel.app',
      'https://moon-ai.info',
      'https://www.zylapse.in',
      'https://moonai.zylapse.com',
      'https://moonai.phynex.in',
      'http://localhost:5173',
      'http://localhost:5174'
    ],
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// ─── Cloudinary Config ────────────────────────────────────────────────────────

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ─── Console Log Collector (for /api/terminal-messages) ──────────────────────

['log', 'error', 'warn', 'info'].forEach(type => {
  const original = console[type];
  console[type] = (...args) => {
    const message = args.map(a => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch { return '[object]'; }
      }
      return String(a);
    }).join(' ');

    collectLog(type, message);
    original.apply(console, args);
  };
});

// ─── CORS ─────────────────────────────────────────────────────────────────────

app.use(cors({
  origin: [
    'https://moon-ai-rust.vercel.app',
    'https://moon-ai.info',
    'https://www.zylapse.in',
    'https://moonai.zylapse.com',
    'https://moonai.phynex.in',
    'http://localhost:5173',
    'http://localhost:5174'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// ─── Body Parsing & Static ────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── MongoDB ──────────────────────────────────────────────────────────────────

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('📁 Database:   Connected'))
  .catch(err => console.error('❌ Database:   Error ->', err.message));

// Watch for user folder changes → broadcast via Socket.IO
const User = require('./models/User');

mongoose.connection.once('open', () => {
  try {
    const changeStream = User.watch();
    changeStream.on('change', async change => {
      if (change.operationType === 'update') {
        const updated = change.updateDescription?.updatedFields;
        if (updated && 'folders' in updated) {
          const userId = change.documentKey._id;
          const user   = await User.findById(userId).select('folders').lean();
          if (user) {
            io.emit('folders-updated', {
              userId:  userId.toString(),
              folders: user.folders || []
            });
          }
        }
      }
    });
    console.log('👁️  Streams:    Active');
  } catch (err) {
    console.warn('⚠️ Streams:    Disabled (Replica Set required)');
  }
});

// ─── API Routes ───────────────────────────────────────────────────────────────

// Auth — /api/register1, /api/login, /api/save-google-user, /api/save-tempuser, /api/forgot-password/*
app.use('/api', authRouter);

// Chat — /api/chat, /api/save-chat, /api/chats-by-username/*, /api/delete-chat, /api/rename-chat,
//        /api/chat/edit-message, /api/chat/regenerate, /api/share-chat, /api/MOONAIAPI-*
app.use('/api', chatRouter);
app.use('/',    chatRouter);  // for /shared/:id route

// Utility Tools — /api/fix-grammar, /api/enhance-prompt  (NO history saved)
app.use('/api', toolsRouter);

// Web Search — /api/web-search  (RAD model, returns images + sources)
app.use('/api', searchRouter);

// Admin — /api/ping, /api/server-status, /api/terminal-messages, /api/users/*, /api/chat-logs, /api/folders/*
app.use('/api', adminRouter);

// Upload — /upload-image, /images/:id
app.use('/api', uploadRouter);

// ─── Image Proxy (Bypass slow CDNs) ───────────────────────────────────────────
app.get('/api/image-proxy', async (req, res) => {
  const imageUrl = req.query.url;
  const fallbackUrl = req.query.fallback;
  if (!imageUrl) return res.status(400).send('URL is required');

  try {
    const https = require('https');
    const agent = new https.Agent({ rejectUnauthorized: false });

    async function tryFetch(url, headers = {}) {
      try {
        const response = await fetch(url, {
          agent,
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ...headers
          }
        });
        return response;
      } catch (e) {
        return { ok: false, status: 500, statusText: e.message };
      }
    }

    // Attempt 1: Standard
    let response = await tryFetch(imageUrl, { 'Referer': 'https://www.bing.com/' });

    // Attempt 2: No Referer
    if (!response.ok && (response.status === 403 || response.status === 401)) {
      console.log(`⚠️ [Proxy] 403, retrying without referer: ${imageUrl}`);
      response = await tryFetch(imageUrl);
    }

    // Attempt 3: Self Referer
    if (!response.ok && (response.status === 403 || response.status === 401)) {
      console.log(`⚠️ [Proxy] Still 403, retrying with self-referer: ${imageUrl}`);
      const domain = new URL(imageUrl).origin;
      response = await tryFetch(imageUrl, { 'Referer': domain + '/' });
    }

    // Attempt 4: Fallback to Thumbnail if provided
    if (!response.ok && fallbackUrl) {
      console.log(`🔄 [Proxy] All attempts failed, using fallback thumbnail: ${fallbackUrl}`);
      response = await tryFetch(fallbackUrl);
    }

    if (!response.ok) {
      console.error(`❌ Proxy Final Failure [${response.status}]: ${imageUrl}`);
      return res.status(response.status || 500).send(`Failed to fetch image`);
    }

    const contentType = response.headers.get('content-type');
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('❌ Proxy Exception:', err.message);
    res.status(500).send('Error proxying image');
  }
});

app.get('/view/shared/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'shared.html'));
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────

io.on('connection', socket => {
  socket.on('disconnect', () => {});
});

// ─── Groq Connection Test ─────────────────────────────────────────────────────

async function testGroqConnection() {
  try {
    const { callGroqOnce }      = require('./services/groq');
    const { getSystemMessages } = require('./services/systemPrompts');
    await callGroqOnce([
      ...getSystemMessages(),
      { role: 'user', content: 'Say "online" in one word.' }
    ]);
    console.log('🤖 Groq AI:    Online');
  } catch (err) {
    console.error('❌ Groq AI:    Offline ->', err.message);
  }
}

function getLocalIP() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
  } catch (_) {}
  return 'localhost';
}

// ─── Start Server ─────────────────────────────────────────────────────────────

httpServer.listen(PORT, '0.0.0.0', async () => {
  const ip = getLocalIP();
  console.log('\n🌙 Moon AI Backend — Status:');
  console.log(`📡 Server:     http://localhost:${PORT}`);
  console.log(`🌐 Network:    http://${ip}:${PORT}`);
  
  await testGroqConnection();
});

// ─── Unhandled Rejection Guard ────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception:', err.message);
});
