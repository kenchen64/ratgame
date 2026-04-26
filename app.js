require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { Telegraf } = require('telegraf');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 10000;

app.use(cors({
    origin: '*', // 允許所有來源連線
    allowedHeaders: ['Content-Type', 'x-telegram-init-data'] // ⚠️ 必須明確允許這個自定義 Header
}));
app.use(express.json());

// ===== MongoDB 連線 =====
mongoose.connect(process.env.MONGO_URI);

const UserSchema = new mongoose.Schema({
    telegramId: { type: String, unique: true, index: true },
    username: String,
    balance: { type: Number, default: 0, min: 0 }, // 修正1: 防止負數
    lastClick: { type: Number, default: 0 },
    shieldUntil: { type: Number, default: 0 }
});
const User = mongoose.model('User', UserSchema);

// ===== 核心：Telegram InitData 驗證 Middleware (修正2) =====
function verifyTelegramWebAppData(req, res, next) {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ msg: '未授權' });

    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    const dataCheckString = Array.from(urlParams.entries())
        .filter(([key]) => key !== 'hash')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
    const _hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (_hash !== hash) return res.status(403).json({ msg: '數據驗證失敗' });

    // 將解碼後的用戶資訊放入 req 供後續使用
    const user = JSON.parse(urlParams.get('user'));
    req.tgUser = user;
    next();
}

// 輔助函式：確保用戶存在，加入邀請獎勵邏輯
async function ensureUser(tgUser, referrerId = null) {
    let u = await User.findOne({ telegramId: tgUser.id.toString() });
    
    if (!u) {
        // 這是新玩家
        u = await User.create({
            telegramId: tgUser.id.toString(),
            username: tgUser.username || `user_${tgUser.id}`,
            balance: 0 
        });

        // 如果有邀請人，且邀請人不是自己
        if (referrerId && referrerId !== tgUser.id.toString()) {
            await User.updateOne(
                { telegramId: referrerId },
                { $inc: { balance: 100 } } // 邀請獎勵：100 💰
            );
            console.log(`用戶 ${referrerId} 獲得邀請獎勵`);
        }
    }
    return u;
}

// ===== API 路由 =====

// 獲取玩家資料 + 計算排名
app.post('/me', verifyTelegramWebAppData, async (req, res) => {
    const u = await ensureUser(req.tgUser);
    
    // 計算有多少人的 balance 比自己高
    const rank = await User.countDocuments({ balance: { $gt: u.balance } }) + 1;

    // 將排名資訊併入回傳結果 (不影響資料庫)
    const userData = u.toObject();
    userData.rank = rank;
    
    res.json(userData);
});


// 點擊 (修正3: 使用原子操作)
app.post('/click', verifyTelegramWebAppData, async (req, res) => {
    const now = Date.now();
    // 檢查冷卻
    const u = await User.findOne({ telegramId: req.tgUser.id.toString() });
    if (u && now - u.lastClick < 1500) return res.json({ msg: '太快了' });

    const updated = await User.findOneAndUpdate(
        { telegramId: req.tgUser.id.toString() },
        { 
            $inc: { balance: 1 }, 
            $set: { lastClick: now } 
        },
        { new: true }
    );
    res.json({ msg: '+1', balance: updated.balance });
});

// 偷取 (修正1 & 4: 隨機採樣與防止負數)
app.post('/steal', verifyTelegramWebAppData, async (req, res) => {
    const attackerId = req.tgUser.id.toString();
    
    // 使用 $sample 隨機抽取一名非本人的玩家
    const targets = await User.aggregate([
        { $match: { telegramId: { $ne: attackerId }, balance: { $gt: 10 } } },
        { $sample: { size: 1 } }
    ]);

    if (targets.length === 0) return res.json({ msg: '沒人可偷' });
    const target = targets[0];

    // 檢查護盾
    if (Date.now() < target.shieldUntil) return res.json({ msg: '對方有盾' });

    const stealAmount = Math.max(1, Math.floor(target.balance * 0.2));

    // 原子扣除被偷者的錢 (確保餘額夠扣)
    const victim = await User.findOneAndUpdate(
        { telegramId: target.telegramId, balance: { $gte: stealAmount } },
        { $inc: { balance: -stealAmount } }
    );

    if (!victim) return res.json({ msg: '偷取失敗(餘額變動)' });

    // 增加攻擊者的錢
    await User.updateOne({ telegramId: attackerId }, { $inc: { balance: stealAmount } });

    res.json({ msg: `偷到 ${stealAmount}` });
});

// 護盾 (修正3: 使用原子操作扣款)
app.post('/shield', verifyTelegramWebAppData, async (req, res) => {
    const now = Date.now();
    const u = await User.findOne({ telegramId: req.tgUser.id.toString() });
    if (!u || u.balance < 50) return res.json({ msg: '餘額不足50' });

    const base = u.shieldUntil > now ? u.shieldUntil : now;
    const newShieldTime = base + 60000;

    const result = await User.findOneAndUpdate(
        { telegramId: req.tgUser.id.toString(), balance: { $gte: 50 } },
        { 
            $inc: { balance: -50 },
            $set: { shieldUntil: newShieldTime }
        },
        { new: true }
    );

    if (!result) return res.json({ msg: '購買失敗' });
    res.json({ msg: '護盾+60秒', balance: result.balance });
});

// 排行榜 API：抓取前 10 名
app.post('/leaderboard', verifyTelegramWebAppData, async (req, res) => {
    try {
        const topPlayers = await User.find({})
            .sort({ balance: -1 }) // 按餘額由高到低排序
            .limit(10)            // 只取前 10 名
            .select('username balance'); // 只回傳名稱與餘額，保護隱私

        res.json(topPlayers);
    } catch (err) {
        res.status(500).json({ msg: '無法獲取排行榜' });
    }
});

// ===== 前端 & Bot =====
app.use(express.static(path.join(__dirname, 'client')));

bot.start(async (ctx) => {
    // 取得邀請人的 ID (來自連結中的 start_param)
    const referrerId = ctx.startPayload; // 如果連結是 t.me/bot?start=123, 這裡會拿到 "123"

    // 建立新玩家時傳入邀請人 ID
    await ensureUser(ctx.from, referrerId);

    ctx.reply('🎮 進入鼠鼠大作戰', {
        reply_markup: {
            inline_keyboard: [[{ 
                text: '🎮 開始遊戲', 
                web_app: { url: process.env.WEBAPP_URL } 
            }]]
        }
    });
});

// Webhook (修正5: 建議在啟動後設置)
app.use(bot.webhookCallback('/bot'));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.listen(PORT, async () => {
    console.log('🚀 Server running on', PORT);
    // 設定 Webhook
    await bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/bot`);
});
