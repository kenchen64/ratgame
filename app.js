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
tasks: {
  daily: {
    click: { type: Number, default: 0 },
    steal: { type: Number, default: 0 },
    login: { type: Boolean, default: false },
    lastReset: { type: Number, default: 0 }
  },
  weekly: {
    click: { type: Number, default: 0 },
    steal: { type: Number, default: 0 },
    loginDays: { type: Number, default: 0 },
    lastReset: { type: Number, default: 0 }
  },
  achievement: {
    totalClick: { type: Number, default: 0 },
    totalSteal: { type: Number, default: 0 }
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
// ===== 任務重置系統 =====
function resetTasks(user) {
  const now = Date.now();

  const today = new Date().setHours(0,0,0,0);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0,0,0,0);
  // ===== Daily =====
  if (!user.tasks.daily.lastReset || user.tasks.daily.lastReset < today) {
    user.tasks.daily = {
      click: 0,
      steal: 0,
      login: false,
      lastReset: today
    };
  }
  // ===== Weekly =====
  if (!user.tasks.weekly.lastReset || user.tasks.weekly.lastReset < weekStart) {
    user.tasks.weekly = {
      click: 0,
      steal: 0,
      loginDays: 0,
      lastReset: weekStart
    };
  }
}
// ===== 黑洞（修正不為0🔥）=====
app.get('/blackhole', async (req,res)=>{
  try{
    const provider = await getProvider();
    const contract = new ethers.Contract(
      process.env.TOKEN_ADDRESS,
      ["function balanceOf(address) view returns(uint256)"],
      provider
    );
    const DEAD = "0x000000000000000000000000000000000000dead";
    const raw = await contract.balanceOf(DEAD);

    if(raw === 0n){
      return res.json({total:"0"});
    }
    const total = ethers.formatUnits(raw, 18);
    res.json({total});

  }catch(e){
    console.log('blackhole error:', e.message);
    res.json({total:"讀取失敗"});
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

  await user.save();

  res.json(user);
  });

// 偷取 隨機或指定
app.post('/steal', async (req,res)=>{
  try{
    const user = await getUser(req.body.telegramId);

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
        return res.json({msg:'❌ 找不到玩家'});
    }
    else{
      const players = await User.find({
        telegramId: { $ne: user.telegramId },
        balance: { $gt: 0 }
      });

      if(players.length === 0)
        return res.json({msg:'❌ 沒人可偷'});

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
    const topClick = await User.find({balance:{$gt:0}})
      .sort({balance:-1})
      .limit(5);

    const topSteal = await User.find({steal:{$gt:0}})
      .sort({steal:-1})
      .limit(5);

    res.json({
      topClick: topClick || [],
      topSteal: topSteal || []
    });

  }catch(e){
    res.json({topClick:[], topSteal:[]});
  }
});

// ===== Bot =====
const bot = new Telegraf(process.env.BOT_TOKEN);

const menu = Markup.keyboard([
['🎮 開始遊戲','📋 任務'],  
['🖱 點擊赚起司','🏆 排行榜'],
['⚔️ 偷起司','🛡️ 防護盾'],
['🌌 黑洞總量','🔗 綁定錢包'],
]).resize();

// ===== FSM 狀態 =====
const state = {};

// ===== 開始 =====
bot.start(async (ctx) => {
  delete state[ctx.from.id];

  const user = await getUser(ctx.from.id, ctx.from.username);

  resetTasks(user);

  // ===== 每日登入 =====
  if (!user.tasks.daily.login) {
    user.tasks.daily.login = true;
    user.tasks.weekly.loginDays += 1;
  }

  await user.save();

  ctx.reply('🐭 歡迎回來，登入成功', menu);
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

  resetTasks(user);
  await user.save();

  ctx.reply(
`【每日任務】
🖱 點擊: ${user.tasks.daily.click}/30
⚔️ 偷起司: ${user.tasks.daily.steal}/10
🎮 登入: ${user.tasks.daily.login ? '✅成功' : '❌失敗'}

【每週任務】
🖱 點擊: ${user.tasks.weekly.click}/200
⚔️ 偷起司: ${user.tasks.weekly.steal}/50
📅 登入天數: ${user.tasks.weekly.loginDays}/7

【成就】
🖱 總點擊: ${user.tasks.achievement.totalClick}
⚔️ 總偷取: ${user.tasks.achievement.totalSteal}`
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

  ctx.reply(
`🛡️ 防護盾
剩餘:${remain}s
是否開啟(y/n)`
  );
});

// ===== 黑洞 =====
bot.hears('🌌 黑洞總量', async ctx=>{
  const {data} = await axios.get(`http://localhost:${PORT}/blackhole`);
  ctx.reply(`🌌 ${data.total}`);
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

  const isMenu = ['🎮','🖱','⚔️','🛡️','🌌','🔗','🏆','📋']
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
  ctx.reply(msg);
});

// ===== Webhook =====
app.use(bot.webhookCallback('/bot'));
bot.telegram.setWebhook(process.env.WEBHOOK_URL + '/bot');

app.listen(PORT, ()=>console.log(`🚀 Running ${PORT}`));
