const mongoose = require('mongoose');

const sharedSchema = new mongoose.Schema({
  title: String,
  username: String,
  messages: [{ role: String, content: String }]
}, { timestamps: true });

module.exports = mongoose.model('SharedChat', sharedSchema);
