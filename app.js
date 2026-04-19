require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const { Telegraf, Markup } = require('telegraf');
const { ethers } = require('ethers');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

// ===== Mongo =====
mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log('✅ Mongo OK'))
.catch(err=>console.log('❌ Mongo Error', err));

// ===== Model =====
const User = mongoose.models.User || mongoose.model('User',{
  telegramId:String,
  username:String,
  balance:{type:Number,default:0},
  steal:{type:Number,default:0},
  shieldUntil:{type:Number,default:0},
  lastClick:{type:Number,default:0},
  wallet:String,
  banned:{type:Boolean,default:false},
inviteCount: { type:Number, default:0 },

tasks: {
  daily: {
    click: { type:Number, default:0 },
    steal: { type:Number, default:0 },
    invite: { type:Number, default:0 },
    login: { type:Boolean, default:false },
    rewardClaimed: { type:Boolean, default:false },
    lastReset: { type:Number, default:0 }
  },
  weekly: {
    click: { type:Number, default:0 },
    steal: { type:Number, default:0 },
    invite: { type:Number, default:0 },
    loginDays: { type:Number, default:0 },
    rewardClaimed: { type:Boolean, default:false },
    lastReset: { type:Number, default:0 }
  },
  achievement: {
    totalClick: { type:Number, default:0 },
    totalSteal: { type:Number, default:0 },
    totalInvite: { type:Number, default:0 }
  }
}
});

// ===== Web3（雙RPC防掉線🔥）=====
const provider1 = new ethers.JsonRpcProvider(process.env.RPC_URL);
const provider2 = new ethers.JsonRpcProvider(process.env.RPC_URL_2);

async function getProvider(){
  try{
    await provider1.getBlockNumber();
    return provider1;
  }catch{
    return provider2;
  }
}

// ===== 共用 =====
async function getUser(id, username='user'){
  let u = await User.findOne({telegramId:id});
  if(!u){
    u = await User.create({telegramId:id, username});
  }
  return u;
}
// ===== FSM + Timeout =====
const state = {};        // { [userId]: 'STATE_NAME' }
const stateTimer = {};   // { [userId]: timeoutId }

function setState(userId, newState, ctx) {
  // 清除舊 timer
  if (stateTimer[userId]) {
    clearTimeout(stateTimer[userId]);
    delete stateTimer[userId];
  }

  state[userId] = newState;

  // 建立 30 秒 timeout
  stateTimer[userId] = setTimeout(() => {
    delete state[userId];
    delete stateTimer[userId];

    // 👉 自動通知（可選）
    if (ctx) {
      ctx.telegram.sendMessage(userId, '⌛ 操作逾時，已自動取消');
    }
  }, 10000);
}

function clearState(userId) {
  if (stateTimer[userId]) {
    clearTimeout(stateTimer[userId]);
    delete stateTimer[userId];
  }
  delete state[userId];
}
// ===== 任務完成發獎 =====
function checkTaskReward(user){
  let reward = 0;

  // ===== 每日 =====
  if(!user.tasks.daily.rewardClaimed){
    if(
      user.tasks.daily.click >= 30 &&
      user.tasks.daily.steal >= 10 &&
      user.tasks.daily.invite >= 1 &&
      user.tasks.daily.login
    ){
      reward += 50;
      user.tasks.daily.rewardClaimed = true;
    }
  }

  // ===== 每週 =====
  if(!user.tasks.weekly.rewardClaimed){
    if(
      user.tasks.weekly.click >= 200 &&
      user.tasks.weekly.steal >= 50 &&
      user.tasks.weekly.invite >= 5 &&
      user.tasks.weekly.loginDays >= 7
    ){
      reward += 200;
      user.tasks.weekly.rewardClaimed = true;
    }
  }

  user.balance += reward;

  return reward;
}
// ===== 黑洞（修正不為0🔥）=====
app.get('/blackhole', async (req, res) => {
  try {
    const provider = await getProvider();
    const contract = new ethers.Contract(
      process.env.TOKEN_ADDRESS,
      [
        "function balanceOf(address) view returns(uint256)",
        "function totalSupply() view returns(uint256)"
      ],
      provider
    );
    const DEAD = "0x000000000000000000000000000000000000dead";
    const raw = await contract.balanceOf(DEAD);
    
    // ===== 鏈上資料 =====
    const [deadRaw, supplyRaw] = await Promise.all([
      contract.balanceOf(DEAD),
      contract.totalSupply()
    ]);

    const dead = Number(ethers.formatUnits(deadRaw, 18));
    const supply = Number(ethers.formatUnits(supplyRaw, 18));
    const remaining = supply - dead;

    // ===== CoinGecko 幣價🔥 =====
    let price = 0;

    try {
      const cg = await axios.get(
        `https://api.coingecko.com/api/v3/simple/token_price/binance-smart-chain`,
        {
          params: {
            contract_addresses: process.env.TOKEN_ADDRESS,
            vs_currencies: 'usd'
          }
        }
      );

      const addr = process.env.TOKEN_ADDRESS.toLowerCase();

      if (cg.data[addr]) {
        price = cg.data[addr].usd || 0;
      }

    } catch (e) {
      console.log('CoinGecko error:', e.message);
      price = 0; // fallback
    }

    res.json({
      dead,
      remaining,
      price
    });

  } catch (e) {
    console.log('blackhole error:', e.message);
    res.json({
      dead: 0,
      remaining: 0,
      price: 0
    });
  }
});

// ===== API（略保持原本）=====
app.post('/me', async (req,res)=>{
  const user = await getUser(req.body.telegramId, req.body.username);
  res.json(user);
});

// 點擊
app.post('/click', async (req,res)=>{
  const user = await getUser(req.body.telegramId);

  if(Date.now()-user.lastClick < 3000){
    return res.json({msg:'⏳ 點擊過快', balance:user.balance});
  }

  user.lastClick = Date.now();
  user.balance += 1 ;
  
  // 👉 任務進度
user.tasks.daily.click += 1;
user.tasks.weekly.click += 1;
user.tasks.achievement.totalClick += 1;
const reward = checkTaskReward(user);
  await user.save();

  res.json(user);
  });

// 偷取 隨機或指定
app.post('/steal', async (req,res)=>{
  try{
    const user = await getUser(req.body.telegramId);
    const attacker = await getUser(attackerId);

  if(Date.now() - attacker.lastAttack < 30000)
    return res.json({msg:'⏳ 冷卻中，等等再偷'});
    let target;

    if(req.body.target){
      const t = req.body.target.replace('@','');

      // 👉 username 或 id
      target = await User.findOne({
        $or:[
          { username: t },
          { telegramId: t }
        ]
      });

      if(!target)
        return res.json({msg:'❌ 找不到這隻鼠'});
    }
    else{
      const players = await User.find({
        telegramId: { $ne: user.telegramId },
        balance: { $gt: 0 }
      });

      if(players.length === 0)
        return res.json({msg:'❌ 沒鼠可偷'});

      target = players[Math.floor(Math.random()*players.length)];
    }

    if(target.telegramId === user.telegramId)
      return res.json({msg:'❌ 不能偷自己'});

    if(Date.now() < target.shieldUntil)
      return res.json({msg:`🛡️ @${target.username} 有盾`});
    
    if(target.balance <= 0)
    return res.json({msg:'💸 對方沒錢'});

    const amount = Math.max(1, Math.floor(target.balance * 0.2));

    target.balance -= amount;
    user.balance += amount;
    user.steal += amount;
   attacker.tasks.daily.steal += 1;
   attacker.tasks.weekly.steal += 1;
   attacker.tasks.achievement.totalSteal += 1;
    const reward = checkTaskReward(attacker);
    await target.save();
    await user.save();

    return res.json({
      msg:`🐭 成功偷到 ${target.username}\n+${amount} 🧀\n ⚔️ 任務進度: ${attacker.tasks.daily.steal}/30`
    });

  }catch(e){
    res.json({msg:'error'});
  }
});

app.post('/shield', async (req,res)=>{
  const user = await getUser(req.body.telegramId);

  if(user.balance < 50)
    return res.json({msg:'❌ 不足50'});

  const now = Date.now();

  if(user.shieldUntil > now){
    user.shieldUntil += 60000;
  }else{
    user.shieldUntil = now + 60000;
  }

  user.balance -= 50;

  await user.save();

  const remain = Math.floor((user.shieldUntil-now)/1000);

  res.json({msg:`🛡️ 已開啟\n剩餘:${remain}s`});
});

// 綁定
app.post('/bind', async (req,res)=>{
  try{
    const { telegramId, wallet } = req.body;

    if(!telegramId || !wallet){
      return res.json({msg:'❌ 資料錯誤'});
    }

    if(!ethers.isAddress(wallet)){
      return res.json({msg:'❌ 地址錯誤'});
    }

    const user = await getUser(telegramId);

    user.wallet = wallet;
    await user.save();

    res.json({msg:`✅ 已綁定:\n${wallet}`});

  }catch(e){
    console.log('bind api error:', e.message);
    res.json({msg:'❌ 綁定失敗'});
  }
});

// 排行榜
app.get('/rank', async (req,res)=>{
  try{
    const topClick = await User.find({balance:{$gt:0}}).sort({balance:-1}).limit(5);

    const topSteal = await User.find({steal:{$gt:0}}).sort({steal:-1}).limit(5);
    const inviteTop = await User.find().sort({inviteCount:-1}).limit(5);

    res.json({
      topClick: topClick || [],
      topSteal: topSteal || [],
      inviteTop: inviteTop || [],
    });

  }catch(e){
    res.json({topClick:[], topSteal:[], inviteTop:[]});
  }
});

// ===== Bot =====
const bot = new Telegraf(process.env.BOT_TOKEN);

const menu = Markup.keyboard([
['🎮 開始遊戲','📋 任務'],  
['🖱 點擊赚起司','🏆 排行榜'],
['⚔️ 偷起司','🛡️ 防護盾'],
['🐭 鼠經濟','🔗 綁定錢包'],
]).resize();

// ===== 開始 =====
bot.start(async (ctx) => {
  try {
    // ✅ 清 FSM（避免卡住）
    delete state[ctx.from.id];

    // ✅ 解析 /start 參數（關鍵修正🔥）
    const text = ctx.message?.text || '';
    const args = text.split(' ');
    const ref = args[1] ? args[1].trim() : null;

    let user = await User.findOne({ telegramId: ctx.from.id });

    // ===== 新用戶 =====
    if (!user) {
      user = await User.create({
        telegramId: ctx.from.id,
        username: ctx.from.username || `user_${ctx.from.id}`,
        referrer: ref || null
      });

      // ===== 邀請獎勵（修正 ref 未定義問題🔥）=====
      if (ref && ref !== String(ctx.from.id)) {
        const inviter = await User.findOne({ telegramId: ref });

        if (inviter) {
          inviter.balance += 20; //獎勵
          inviter.inviteCount = (inviter.inviteCount || 0) + 1;

          // 👉 任務進度（避免 undefined🔥）
          if (!inviter.tasks) inviter.tasks = {};
          if (!inviter.tasks.daily) inviter.tasks.daily = {};
          if (!inviter.tasks.weekly) inviter.tasks.weekly = {};
          if (!inviter.tasks.achievement) inviter.tasks.achievement = {};

          inviter.tasks.daily.invite = (inviter.tasks.daily.invite || 0) + 1;
          inviter.tasks.weekly.invite = (inviter.tasks.weekly.invite || 0) + 1;
          inviter.tasks.achievement.totalInvite =
            (inviter.tasks.achievement.totalInvite || 0) + 1;

          await inviter.save();
        }
      }
    }

    return ctx.reply('🐭 歡迎回來，登入成功', menu);

  } catch (err) {
    console.log('/start error:', err);
    return ctx.reply('❌ 系統錯誤');
  }
});

// ===== 開始遊戲 =====
bot.hears('🎮 開始遊戲', ctx=>{
  ctx.reply('🎮 已開始', menu);
});

// ===== 點擊 =====
bot.hears('🖱 點擊赚起司', async ctx=>{
  const {data} = await axios.post(`http://localhost:${PORT}/click`,{
    telegramId:ctx.from.id
  });
  const user = await getUser(ctx.from.id);
  if(data.msg) return ctx.reply(data.msg);

  ctx.reply(`🆔Telegram: ${ctx.from.id}\n👤用戶名: ${ctx.from.username}\n🧀餘額: ${data.balance}\n
📋 任務進度: ${user.tasks.daily.click}/30`);
});

// ===== 每日任務 =====
bot.hears('📋 任務', async ctx => {
  delete state[ctx.from.id];

  const user = await getUser(ctx.from.id);

  await user.save();

  ctx.reply(
`【每日任務】
🖱 點擊: ${user.tasks.daily.click}/30
⚔️ 偷起司: ${user.tasks.daily.steal}/10
👥 邀請: ${user.tasks.daily.invite}/1
🎮 登入: ${user.tasks.daily.login ? '✅成功' : '❌失敗'}

【每週任務】
🖱 點擊: ${user.tasks.weekly.click}/200
⚔️ 偷起司: ${user.tasks.weekly.steal}/50
👥 邀請: ${user.tasks.weekly.invite}/5
📅 登入天數: ${user.tasks.weekly.loginDays}/7

【成就】
🖱 總點擊: ${user.tasks.achievement.totalClick}
⚔️ 總偷取: ${user.tasks.achievement.totalSteal}
👥 總邀請: ${user.tasks.achievement.totalInvite}

💰 完成獎勵：
每日 +50 🧀
每週 +200 🧀
邀請每人 +20 🧀`
  );
});

// ===== 偷起司 =====
bot.hears('⚔️ 偷起司', ctx=>{
  ctx.reply('輸入:\n/steal (隨機)\n/steal username\n/steal id');
});
bot.command('steal', async ctx=>{
  try{
    await ctx.reply('🐭 潛入中...');

    setTimeout(async ()=>{
      const {data} = await axios.post(`http://localhost:${PORT}/steal`,{
        telegramId: ctx.from.id,
        target: ctx.message.text.split(' ')[1] || null
      });

      ctx.reply(data.msg);

    }, 1500);

  }catch{
    ctx.reply('❌ 錯誤');
  }
});

// ===== 防護盾 =====
bot.hears('🛡️ 防護盾', async ctx=>{
  const {data} = await axios.post(`http://localhost:${PORT}/me`,{
    telegramId:ctx.from.id
  });

  const now = Date.now();
  const remain = data.shieldUntil > now
    ? Math.floor((data.shieldUntil-now)/1000)
    : 0;

  state[ctx.from.id] = 'shield';

  await ctx.reply(
'開啟🛡️ 防護盾需要 50 🧀
剩餘時間: ${remain}s
是否開啟？(y/n)`
  );
    setState(telegramId, 'WAIT_SHIELD_CONFIRM', ctx);
});

// ===== 黑洞 =====
bot.hears('🐭 鼠經濟', async ctx=>{
  delete state[ctx.from.id];

  const {data} = await axios.get(`http://localhost:${PORT}/blackhole`);

  ctx.reply(
`🌌 起司黑洞: ${data.dead}
🐭 鼠重量: $${data.price}
🧀 剩餘起司: ${data.remaining}`
  );
});

// ===== 綁定 =====
bot.hears('🔗 綁定錢包', async ctx=>{
  const {data} = await axios.post(`http://localhost:${PORT}/me`,{
    telegramId:ctx.from.id
  });

  state[ctx.from.id] = 'wallet';

  if(data.wallet){
    return ctx.reply(`已綁定:\n${data.wallet}\n輸入新地址:`);
  }

  ctx.reply('輸入錢包地址:');
});

// ===== FSM核心🔥 =====
bot.on('text', async (ctx, next)=>{
  const text = ctx.message.text.trim();
    if (text.startsWith('/')) {
    delete state[ctx.from.id];
    return next();
  }

  const s = state[ctx.from.id];

  const isMenu = ['🎮','🖱','⚔️','🛡️','🐭','🔗','🏆','📋']
    .some(x=>text.includes(x));

  if(isMenu){
    delete state[ctx.from.id];
    return next();
  }

  // ===== 防護盾 =====
  if(s === 'shield'){
    if(text === 'n'){
      delete state[ctx.from.id];
      return ctx.reply('❌ 已取消');
    }

    if(text !== 'y'){
      return ctx.reply('請輸入 y 或 n');
    }

    const {data} = await axios.post(`http://localhost:${PORT}/shield`,{
      telegramId:ctx.from.id
    });

    delete state[ctx.from.id];
    return ctx.reply(data.msg);
  }

  // ===== 綁定 =====
  if(s === 'wallet'){
    if(!ethers.isAddress(text)){
      delete state[ctx.from.id];
      return ctx.reply('❌ 地址錯誤');
    }

    const {data} = await axios.post(`http://localhost:${PORT}/bind`,{
      telegramId:ctx.from.id,
      wallet:text
    });

    delete state[ctx.from.id];
    return ctx.reply(data.msg);
  }

  return next();
});

// ===== 排行榜 =====
bot.hears('🏆 排行榜', async ctx=>{
  delete state[ctx.from.id];

  const {data} = await axios.get(`http://localhost:${PORT}/rank`);

  let msg='🏆 點擊榜\n';
  data.topClick.forEach((u,i)=>{
    msg+=`${i+1}. 👤:${u.username} 🧀:${u.balance}\n`;
  });

  msg+='\n⚔️ 偷取榜\n';
  data.topSteal.forEach((u,i)=>{
    msg+=`${i+1}. 👤:${u.username} 🧀:${u.balance}\n`;
  });

  msg+='\n👥 邀請榜\n';
  data.inviteTop.forEach((u,i)=>{
    msg+=`${i+1}. ${u.username} 👤:${u.inviteCount}\n`;
  });

  ctx.reply(msg);
});

// ===== Webhook =====
app.use(bot.webhookCallback('/bot'));
bot.telegram.setWebhook(process.env.WEBHOOK_URL + '/bot');

app.listen(PORT, ()=>console.log(`🚀 Running ${PORT}`));
