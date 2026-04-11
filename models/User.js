const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: { type: String, unique: true },

  username: String,

  balance: { type: Number, default: 0 },
  wallet: { type: String, default: null },

  clicks: { type: Number, default: 0 },

  lastClick: { type: Number, default: 0 },
  lastAttack: { type: Number, default: 0 },

  shieldUntil: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);