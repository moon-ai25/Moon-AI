const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  edited: {
    type: Boolean,
    default: false
  },
  // For web search results attached to an assistant message
  images: [{
    url:    { type: String, default: '' },
    title:  { type: String, default: '' },
    source: { type: String, default: '' },
    thumb:  { type: String, default: '' }
  }],
  sources: [{
    title:   { type: String, default: '' },
    url:     { type: String, default: '' },
    snippet: { type: String, default: '' },
    favicon: { type: String, default: '' }
  }],
  // User-attached image URLs (after upload to Cloudinary)
  attachedImageUrls: [{ type: String }],
  // User feedback on assistant messages
  feedback: { type: String, enum: ['like', 'dislike', null], default: null }
});

const chatSchema = new mongoose.Schema({
  userId:   { type: String },
  username: { type: String, required: true },
  title:    { type: String, default: 'Untitled Chat' },
  folder:   { type: String, default: 'Default' },
  messages: [messageSchema]
}, { timestamps: true });

module.exports = mongoose.model('Chat', chatSchema, 'chats');
