const mongoose = require('mongoose');

const tempUserSchema = new mongoose.Schema({
  username: { type: String, required: true},
  createdAt: { type: Date, default: Date.now },
  isOnline:  { type: Boolean, default: false },
  lastSeen:  { type: Date, default: null }
});

module.exports = mongoose.model('tempuser', tempUserSchema);
