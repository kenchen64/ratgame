const mongoose = require('mongoose');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, );

    console.log('✅ MongoDB 已連線');
  } catch (err) {
    console.error('❌ MongoDB 連線失敗:', err.message);
    process.exit(1);
  }
}

module.exports = connectDB;