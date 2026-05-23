/**
 * routes/auth.js — Authentication & User management routes.
 *
 * POST /api/register1           — Register new user
 * POST /api/login               — Login (username or email)
 * POST /api/save-google-user    — Google OAuth user upsert
 * POST /api/save-tempuser       — Create temporary user
 * POST /api/forgot-password/send-otp
 * POST /api/forgot-password/verify-otp
 * POST /api/forgot-password/reset
 */

const express    = require('express');
const router     = express.Router();
const nodemailer = require('nodemailer');

const User     = require('../models/User');
const tempuser = require('../models/tempuser');

// ─── Email Transporter ────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'heyyy.moon.ai@gmail.com',
    pass: 'ldun glka rmxh fudq'
  }
});

// ─── Register ─────────────────────────────────────────────────────────────────

router.post('/register1', async (req, res) => {
  const { username, email, password } = req.body;
  console.log('Register attempt:', username, email);

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password are required' });
  }

  try {
    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) {
      return res.status(400).json({ error: 'User with this email or username already exists' });
    }

    const user = new User({ username, email, password, loginType: 'manual' });
    await user.save();
    console.log('✅ New user registered:', username);
    res.json({ message: 'User registered successfully!' });
  } catch (err) {
    console.error('❌ Registration error:', err.message);
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'identifier and password are required' });
  }

  try {
    const user = await User.findOne({
      $or: [{ email: identifier }, { username: identifier }]
    });

    if (!user)               return res.status(404).json({ error: 'No user found' });
    if (user.password !== password) return res.status(401).json({ error: 'Incorrect password' });

    console.log('✅ Login successful:', user.username);

    res.json({
      userId:   user._id,
      username: user.username,
      email:    user.email,
      name:     user.name || user.username,
      profile:  user.profile || null,
      folders:  user.folders || []
    });
  } catch (err) {
    console.error('❌ Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Google OAuth ─────────────────────────────────────────────────────────────

router.post('/save-google-user', async (req, res) => {
  const { name, email, picture } = req.body;

  if (!email) return res.status(400).json({ error: 'email is required' });

  try {
    const username = email.split('@')[0];
    let user = await User.findOne({ email });

    if (!user) {
      user = new User({ name, email, profile: picture, username, loginType: 'google' });
      await user.save();
      console.log('✅ New Google user saved:', username);
    } else {
      // Update profile pic if changed
      if (picture && user.profile !== picture) {
        user.profile = picture;
        await user.save();
      }
    }

    res.json({
      success:  true,
      userId:   user._id,
      username: user.username,
      email:    user.email,
      name:     user.name || user.username,
      profile:  user.profile || null,
      folders:  user.folders || []
    });
  } catch (err) {
    console.error('❌ Google user save error:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ─── Temp User ────────────────────────────────────────────────────────────────

router.post('/save-tempuser', async (req, res) => {
  const { username } = req.body;

  if (!username) return res.status(400).json({ success: false, error: 'username required' });

  try {
    const existing = await tempuser.findOne({ username });
    if (existing) {
      return res.json({ success: true, isExisting: true });
    }

    const newUser = new tempuser({ username });
    await newUser.save();
    res.json({ success: true, isExisting: false });
  } catch (err) {
    console.error('❌ Temp user save error:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ─── Forgot Password — Send OTP ───────────────────────────────────────────────

router.post('/forgot-password/send-otp', async (req, res) => {
  const { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: 'identifier is required' });

  try {
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }]
    });

    if (!user || !user.email) {
      return res.status(404).json({ error: 'User not found or no email on file' });
    }

    const otp    = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    user.otp        = otp;
    user.otpExpires = expiry;
    await user.save();

    await transporter.sendMail({
      to:      user.email,
      subject: '🌙 Moon AI — Your Password Reset Code',
      html: `
        <div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;color:#333">
          <div style="background:#6e48aa;padding:24px;text-align:center;border-radius:8px 8px 0 0">
            <h1 style="color:white;margin:0">🌙 Moon AI</h1>
          </div>
          <div style="padding:30px;background:#f9f9f9;border-radius:0 0 8px 8px;border:1px solid #e1e1e1">
            <h2 style="color:#6e48aa;margin-top:0">Password Reset</h2>
            <p>Hello <strong>${user.username || 'there'}</strong>,</p>
            <p>Your one-time reset code:</p>
            <div style="background:#f0e6ff;padding:16px;text-align:center;margin:20px 0;border-radius:6px;font-size:28px;font-weight:bold;letter-spacing:4px;color:#6e48aa">
              ${otp}
            </div>
            <p>This code expires in <strong>5 minutes</strong>. Do not share it with anyone.</p>
            <p style="font-size:13px;color:#999">© ${new Date().getFullYear()} Moon AI. All rights reserved.</p>
          </div>
        </div>
      `
    });

    console.log('✅ OTP sent to:', user.email);
    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    console.error('❌ OTP send error:', err.message);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// ─── Forgot Password — Verify OTP ────────────────────────────────────────────

router.post('/forgot-password/verify-otp', async (req, res) => {
  const { identifier, otp } = req.body;
  if (!identifier || !otp) return res.status(400).json({ error: 'identifier and otp are required' });

  try {
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }]
    });

    if (!user)   return res.status(404).json({ error: 'User not found' });

    const match   = user.otp?.toString().trim() === otp.toString().trim();
    const expired = Date.now() > new Date(user.otpExpires).getTime();

    if (!match || expired) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    res.json({ message: 'OTP verified. You may reset your password.' });
  } catch (err) {
    console.error('❌ OTP verify error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Forgot Password — Reset ──────────────────────────────────────────────────

router.post('/forgot-password/reset', async (req, res) => {
  const { identifier, newPassword } = req.body;
  if (!identifier || !newPassword) {
    return res.status(400).json({ error: 'identifier and newPassword are required' });
  }

  try {
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }]
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    user.password   = newPassword;
    user.otp        = null;
    user.otpExpires = null;
    await user.save();

    res.json({ message: 'Password changed successfully!' });
  } catch (err) {
    console.error('❌ Password reset error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
