require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const { Telegraf } = require('telegraf');
const { ethers } = require('ethers');
const bot = new Telegraf(process.env.BOT_TOKEN);
const express = require('express');
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

// ===== DB =====
mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log('✅ Mongo OK'))
.catch(err=>console.log('❌ Mongo Error', err));

const userSchema = new mongoose.Schema({
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
const User = mongoose.model('User', userSchema);
async function getUser(id, username){
  let u = await User.findOne({telegramId:id});
  if(!u){
    u = await User.create({
      telegramId:id,
      username: username || `user_${id}`
    });
  }
  return u;
}

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

// ===== FSM ENGINE =====
const FSM = {
  state: {},        // userId -> stateName
  timer: {},        // userId -> main timeout
  warnTimer: {},    // userId -> 10秒提醒
  timeoutCount: {}  // userId -> 次數（防外掛）
};
// ===== 設定狀態 =====
function setState(ctx, name) {
  const userId = ctx.from.id;
  clearState(userId);
  FSM.state[userId] = name;
  // 👉 10秒提醒
  FSM.warnTimer[userId] = setTimeout(() => {
    ctx.telegram.sendMessage(userId, '⏳ 10秒後自動取消...');
  }, 10000);
  // 👉 20秒 timeout
  FSM.timer[userId] = setTimeout(() => {
    clearState(userId);
    FSM.timeoutCount[userId] = (FSM.timeoutCount[userId] || 0) + 1;
    ctx.telegram.sendMessage(userId, '⌛ 操作逾時，已取消');
    // 👉 防外掛（連續 timeout）
    if (FSM.timeoutCount[userId] >= 5) {
      ctx.telegram.sendMessage(userId, '🚫 偵測異常操作，請稍後再試');
    }
  }, 20000);
}
// ===== 清除狀態 =====
function clearState(userId) {
  if (FSM.timer[userId]) {clearTimeout(FSM.timer[userId]);
    delete FSM.timer[userId];
  }
  if (FSM.warnTimer[userId]) {clearTimeout(FSM.warnTimer[userId]);
    delete FSM.warnTimer[userId];
  }
    delete FSM.state[userId];
}
// ===== 取得狀態 =====
function getState(userId) {
  return FSM.state[userId];
}

// ===== UI =====
function menu(){
  return {
    reply_markup:{
      inline_keyboard:[
        [{text:'🎮 開始遊戲',callback_data:'start'}],[{text:'📋 任務',callback_data:'task'}],
        [{text:'🖱 點擊賺起司',callback_data:'click'}],[{text:'🏆 排行榜',callback_data:'rank'}],
        [{text:'⚔️ 偷起司',callback_data:'steal'}],[{text:'🛡️ 防護盾',callback_data:'shield'}],
        [{text:'🐭 鼠經濟',callback_data:'blackhole'}],[{text:'🔗 綁定錢包',callback_data:'wallet'}],
      ]
    }
  };
}

// ===== START =====
bot.start(async ctx=>{
  clearState(ctx.from.id);
  const user = await getUser(ctx.from.id, ctx.from.username);
  user.tasks.daily.login = true;
  await user.save();
  
    // ✅ 解析 /start 參數（關鍵修正🔥）
    const text = ctx.message?.text || '';
    const args = text.split(' ');
    const ref = args[1] ? args[1].trim() : null;

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
         }}}
  ctx.reply('🐭 歡迎回來，登入成功', menu());

});

// ===== CALLBACK =====
bot.on('callback_query', async ctx=>{
  await ctx.answerCbQuery();
  const id = ctx.from.id;
  const data = ctx.callbackQuery.data;

  try{

    // ===== 開始 =====
    if(data==='start'){
      clearState(id);
      return ctx.editMessageText('🎮 遊戲開始',menu());
    }

    // ===== 點擊 =====
    if(data==='click'){
      const u = await getUser(id);

      if(Date.now()-u.lastClick<3000){
        return ctx.answerCbQuery('⏳ 點擊過快');
      }

      u.lastClick=Date.now();
      u.balance+=1;
      u.tasks.daily.click+=1;
      u.tasks.weekly.click += 1;
      u.tasks.achievement.totalClick += 1;
      const reward = checkTaskReward(user);
      await u.save();

      return ctx.editMessageText(
`🆔Telegram: ${id}\n👤用戶名: ${username}\n🧀餘額: ${u.balance}\n🧀 +1
📋 任務進度:${u.tasks.daily.click}/30`,menu());
    }

    // ===== 偷 =====
    if(data==='steal'){
      const users = await User.find({telegramId:{$ne:id}});
      if(users.length===0) return ctx.answerCbQuery('❌ 沒鼠可偷');

      const t = users[Math.floor(Math.random()*users.length)];
      const a = await getUser(id);
      if(Date.now() < target.shieldUntil)
      return res.json({msg:`🛡️ @${t.username} 有盾`});
      if(t.balance<=0) return ctx.answerCbQuery('💸 對方沒錢');

      const steal = Math.floor(t.balance*0.2);

      t.balance-=steal;
      a.balance+=steal;
      a.tasks.daily.steal+=1;

      await t.save();
      await a.save();

      return ctx.editMessageText(
`🐭 成功偷到  ${t.username}\n+🧀${steal}
⚔️ 任務進度:${a.tasks.daily.steal}/10`,menu());
    }

    // ===== 護盾 =====
    if(data==='shield'){
      const u = await getUser(id);
      const remain = Math.floor((user.shieldUntil-now)/1000);
      return ctx.editMessageText(
`🛡️ 開啟護盾?剩餘:${remain}s
消耗50🧀`,{
        reply_markup:{
          inline_keyboard:[
            [{text:'✅ 開啟',callback_data:'shield_yes'}],
            [{text:'❌ 取消',callback_data:'shield_no'}]
          ]
        }
      });
    }

    if(data==='shield_yes'){
      const u = await getUser(id);

      if(u.balance<50) return ctx.answerCbQuery('❌ 🧀不足50');

      u.balance-=50;
      const base = u.shieldUntil>Date.now()?u.shieldUntil:Date.now();
      u.shieldUntil = base + 60000;

      await u.save();

      return ctx.editMessageText('🛡️ 已開啟\n剩餘:${remain}s',menu());
    }

    if(data==='shield_no'){
      return ctx.editMessageText('取消',menu());
    }

    // ===== 錢包 =====
    if(data==='wallet'){
      setState(ctx,'wallet');
      const u = await getUser(id);

      return ctx.editMessageText(
`目前錢包:${u.wallet||'未綁定'}
請輸入新地址`);
    }

    // ===== 黑洞 =====
    if(data==='blackhole'){
      const provider = await getProvider();
      const contract = new ethers.Contract(
        process.env.TOKEN_ADDRESS,
        ["function balanceOf(address) view returns(uint256)",
         "function totalSupply() view returns(uint256)"],
        provider
      );
      const DEAD="0x000000000000000000000000000000000000dead";
      const raw = await contract.balanceOf(DEAD);
          
    // ===== 鏈上資料 =====
      const [deadRaw, supplyRaw] = await Promise.all([
      contract.balanceOf(DEAD),
      contract.totalSupply()
    ]);
      const dead = Number(ethers.formatUnits(raw,18));
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

    catch (e) {
    console.log('blackhole error:', e.message);
    res.json({
      dead: 0,
      remaining: 0,
      price: 0
    });
  }
      return ctx.editMessageText(`🌌 起司黑洞:${dead}/n🐭 鼠重量: $${price}/n🧀 剩餘起司: ${remaining}`,menu());
    }

    // ===== 任務 =====
    if(data==='task'){
      const u = await getUser(id);

      return ctx.editMessageText(
`📋 【每日任務】
🖱 點擊: ${u.tasks.daily.click}/30
⚔️ 偷起司: ${u.tasks.daily.steal}/10
👥 邀請: ${u.tasks.daily.invite}/1
🎮 登入: ${u.tasks.daily.login?'✅':'❌'}

【每週任務】
🖱 點擊: ${u.tasks.weekly.click}/200
⚔️ 偷起司: ${u.tasks.weekly.steal}/50
👥 邀請: ${u.tasks.weekly.invite}/5
📅 登入天數: ${u.tasks.weekly.loginDays}/7

【成就】
🖱 總點擊: ${u.tasks.achievement.totalClick}
⚔️ 總偷取: ${u.tasks.achievement.totalSteal}
👥 總邀請: ${u.tasks.achievement.totalInvite}

💰 完成獎勵：
每日 +50 🧀
每週 +200 🧀
邀請每人 +20 🧀`,menu());
    }

    // ===== 排行榜 =====
    if(data==='rank'){
      const list = await User.find().sort({balance:-1}).limit(5);
      const topClick = await User.find({balance:{$gt:0}}).sort({balance:-1}).limit(5);
      const topSteal = await User.find({steal:{$gt:0}}).sort({steal:-1}).limit(5);
      const inviteTop = await User.find().sort({inviteCount:-1}).limit(5);
      
      let msg='🏆 點擊榜\n';
      list.forEach((u,i)=>{
        msg+=`${i+1}.👤:${u.username} 🧀:${u.balance}\n`;
      });
      
       msg+='\n⚔️ 偷取榜\n';
       data.topSteal.forEach((u,i)=>{
       msg+=`${i+1}. 👤:${u.username} 🧀:${u.balance}\n`;
      });

      msg+='\n👥 邀請榜\n';
      data.inviteTop.forEach((u,i)=>{
      msg+=`${i+1}. ${u.username} 👤:${u.inviteCount}\n`;
      });

      return ctx.editMessageText(msg,menu());
    }

  }catch(e){
    console.log(e);
    clearState(id);
    ctx.reply('錯誤');
  }
});

// ===== FSM TEXT =====
bot.on('text', async ctx=>{
  const id = ctx.from.id;
  const s = getState(id);
  if(!s) return;

  if(s==='wallet'){
    clearState(id);

    if(!/^0x[a-fA-F0-9]{40}$/.test(ctx.message.text)){
      return ctx.reply('地址錯誤');
    }

    await User.updateOne(
      {telegramId:id},
      {wallet:ctx.message.text}
    );

    return ctx.reply('✅ 綁定成功',menu());
  }
});

// ===== Webhook =====
app.use(bot.webhookCallback('/bot'));
bot.telegram.setWebhook(process.env.WEBHOOK_URL + '/bot');
app.listen(PORT, ()=>console.log(`🚀 Running ${PORT}`));
