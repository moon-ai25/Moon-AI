// models/User.js

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: String,
  content: String,
  searchImages: { type: Array, default: [] },
  searchSources: { type: Array, default: [] }
}, { _id: false });

const chatSchema = new mongoose.Schema({
  title: String,
  folder: String,
  messages: [messageSchema],
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email:    { type: String, required: true },
  password: { type: String, required: function() { return this.loginType === 'manual'; } },
  name:      { type: String },
  profile:   { type: String },
  loginType: { type: String, enum: ['manual', 'google'], default: 'manual' }, 
  folders:  { type: [String], default: [] },
  chats:    { type: [chatSchema], default: [] } , // 👈 IMPORTANT
  otp: String,
  otpExpires: Date,
  isOnline:  { type: Boolean, default: false },
  lastSeen:  { type: Date, default: null }
});

module.exports = mongoose.model('User', userSchema);
