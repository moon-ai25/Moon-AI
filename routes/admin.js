/**
 * routes/admin.js — Server administration, monitoring, and user management.
 *
 * GET  /api/ping                — Health check (GET)
 * POST /api/ping                — Heartbeat (POST, updates user online status)
 * GET  /api/server-status       — CPU, memory, disk info
 * GET  /api/terminal-messages   — Recent server logs
 * GET  /api/chat-logs           — Recent 50 chats (admin view)
 * GET  /api/users/active        — Currently online users
 * GET  /api/users/existing      — All registered users
 * GET  /api/users/temporary     — All temporary users
 * GET  /api/folders/:username   — User's chat folder list
 */

const express = require('express');
const router  = express.Router();
const os      = require('os');
const path    = require('path');
const disk    = require('diskusage');

const User     = require('../models/User');
const Chat     = require('../models/Chat');
const tempuser = require('../models/tempuser');

// In-memory log store (shared via module singleton)
const logs = [];
const MAX_LOGS = 200;

/**
 * Exported log collector — called by server.js console monkey-patch.
 */
function collectLog(type, message) {
  logs.push({ type, message, timestamp: new Date().toISOString() });
  if (logs.length > MAX_LOGS) logs.shift();
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function getUptimeFormatted(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ─── Health Check (GET) ───────────────────────────────────────────────────────

router.get('/ping', (req, res) => {
  // Silent health check
  res.status(200).send('OK');
});

// ─── Heartbeat (POST) — update user online status ────────────────────────────

const CHECK_INTERVAL = 60 * 1000;  // 1 minute
const OFFLINE_AFTER  = 30 * 1000;  // 30 seconds inactivity → offline

// Periodic offline check
setInterval(async () => {
  const threshold = new Date(Date.now() - OFFLINE_AFTER);
  try {
    const [ur, tr] = await Promise.all([
      User.updateMany(
        { isOnline: true, lastSeen: { $lt: threshold } },
        { $set: { isOnline: false } }
      ),
      tempuser.updateMany(
        { isOnline: true, lastSeen: { $lt: threshold } },
        { $set: { isOnline: false } }
      )
    ]);
    if (ur.modifiedCount > 0 || tr.modifiedCount > 0) {
      console.log(`🔄 Sync:      ${ur.modifiedCount + tr.modifiedCount} users offline`);
    }
  } catch (err) {
    console.error('⛔ Heartbeat check error:', err.message);
  }
}, CHECK_INTERVAL);

router.post('/ping', async (req, res) => {
  const { username, isTemp = false } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });

  try {
    const Model = isTemp ? tempuser : User;
    await Model.findOneAndUpdate(
      { username },
      { isOnline: true, lastSeen: new Date() }
    );
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Heartbeat error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Server Status ────────────────────────────────────────────────────────────

router.get('/server-status', async (req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem  = os.freemem();
    const usedMem  = totalMem - freeMem;
    const loadAvg  = os.loadavg()[0];

    let diskInfo = { available: 0, total: 0 };
    try {
      diskInfo = await disk.check(path.parse(__dirname).root);
    } catch (_) {}

    res.json({
      api: {
        status:      'Online',
        cpu:         Math.min(Math.round(loadAvg * 10), 100),
        memoryUsed:  formatBytes(usedMem),
        memoryFree:  formatBytes(freeMem),
        memoryTotal: formatBytes(totalMem),
        diskUsed:    formatBytes(diskInfo.total - diskInfo.available),
        diskTotal:   formatBytes(diskInfo.total),
        uptime:      getUptimeFormatted(os.uptime()),
        platform:    os.platform(),
        nodeVersion: process.version
      },
      db: {
        status:      'Online',
        queries:     Math.floor(120 + Math.random() * 50) // simulated
      }
    });
  } catch (err) {
    console.error('❌ server-status error:', err.message);
    res.status(500).json({ error: 'Failed to get server status' });
  }
});

// ─── Terminal Logs ────────────────────────────────────────────────────────────

router.get('/terminal-messages', (req, res) => {
  res.json(logs);
});

// ─── Chat Logs (Admin) ────────────────────────────────────────────────────────

router.get('/chat-logs', async (req, res) => {
  try {
    const chats = await Chat
      .find()
      .sort({ updatedAt: -1 })
      .limit(50)
      .select('_id title username messages updatedAt createdAt');

    res.json(chats.map(c => ({
      _id:       c._id,
      title:     c.title,
      username:  c.username,
      messages:  c.messages,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt
    })));
  } catch (err) {
    console.error('❌ chat-logs error:', err.message);
    res.status(500).json({ error: 'Failed to fetch chat logs' });
  }
});

// ─── Active Users ─────────────────────────────────────────────────────────────

router.get('/users/active', async (req, res) => {
  try {
    const [users, temps] = await Promise.all([
      User.find({ isOnline: true }).select('username name email loginType lastSeen').lean(),
      tempuser.find({ isOnline: true }).lean()
    ]);

    const result = [
      ...users.map(u => ({
        username:   u.username,
        name:       u.name || '',
        email:      u.email,
        type:       u.loginType || 'manual',
        status:     'Online',
        lastActive: u.lastSeen
      })),
      ...temps.map(u => ({
        username:   u.username,
        name:       '-',
        email:      '-',
        type:       'Temporary',
        status:     'Online',
        lastActive: u.lastSeen
      }))
    ];

    res.json(result);
  } catch (err) {
    console.error('❌ users/active error:', err.message);
    res.status(500).json({ error: 'Failed to fetch active users' });
  }
});

// ─── All Existing Users ───────────────────────────────────────────────────────

router.get('/users/existing', async (req, res) => {
  try {
    const users = await User.find({})
      .select('username name email loginType lastSeen isOnline')
      .lean();

    res.json(users.map(u => ({
      username:   u.username,
      name:       u.name || '',
      email:      u.email,
      type:       u.loginType || 'manual',
      status:     u.isOnline ? 'Online' : 'Offline',
      lastActive: u.lastSeen
    })));
  } catch (err) {
    console.error('❌ users/existing error:', err.message);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ─── Temporary Users ──────────────────────────────────────────────────────────

router.get('/users/temporary', async (req, res) => {
  try {
    const temps = await tempuser.find({}).lean();

    res.json(temps.map(u => ({
      username:   u.username,
      name:       '-',
      email:      '-',
      type:       'Temporary',
      status:     u.isOnline ? 'Online' : 'Offline',
      lastActive: u.lastSeen ? new Date(u.lastSeen).toISOString() : 'Unknown'
    })));
  } catch (err) {
    console.error('❌ users/temporary error:', err.message);
    res.status(500).json({ error: 'Failed to fetch temporary users' });
  }
});

// ─── User Folders ─────────────────────────────────────────────────────────────

router.get('/folders/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select('folders');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ folders: user.folders || [] });
  } catch (err) {
    console.error('❌ folders error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = { router, collectLog };
