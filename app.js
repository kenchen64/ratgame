require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const { Telegraf, Markup } = require('telegraf');
const { ethers } = require('ethers');
const bot = new Telegraf(process.env.BOT_TOKEN);
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
        [{text:'🎮 開始遊戲',callback_data:'start'}],
        [{text:'🖱 點擊賺起司',callback_data:'click'}],
        [{text:'⚔️ 偷起司',callback_data:'steal'}],
        [{text:'🛡️ 防護盾',callback_data:'shield'}],
        [{text:'🐭 鼠經濟',callback_data:'blackhole'}],
        [{text:'🔗 綁定錢包',callback_data:'wallet'}],
        [{text:'📋 任務',callback_data:'task'}],
        [{text:'🏆 排行榜',callback_data:'rank'}]
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

  ctx.reply('🐭 Rat Game', menu());
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

      if(Date.now()-u.lastClick<2000){
        return ctx.answerCbQuery('太快');
      }

      u.lastClick=Date.now();
      u.balance+=1;
      u.tasks.daily.click+=1;

      await u.save();

      return ctx.editMessageText(
`🧀 +1
餘額:${u.balance}
任務:${u.tasks.daily.click}/30`,menu());
    }

    // ===== 偷 =====
    if(data==='steal'){
      const users = await User.find({telegramId:{$ne:id}});
      if(users.length===0) return ctx.answerCbQuery('沒人');

      const t = users[Math.floor(Math.random()*users.length)];
      const a = await getUser(id);

      if(t.balance<=0) return ctx.answerCbQuery('對方沒錢');

      const steal = Math.floor(t.balance*0.2);

      t.balance-=steal;
      a.balance+=steal;
      a.tasks.daily.steal+=1;

      await t.save();
      await a.save();

      return ctx.editMessageText(
`🐭 偷到 ${steal}
任務:${a.tasks.daily.steal}/10`,menu());
    }

    // ===== 護盾 =====
    if(data==='shield'){
      const u = await getUser(id);

      return ctx.editMessageText(
`🛡️ 開啟護盾?
消耗50`,{
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

      if(u.balance<50) return ctx.answerCbQuery('不足');

      u.balance-=50;
      const base = u.shieldUntil>Date.now()?u.shieldUntil:Date.now();
      u.shieldUntil = base + 60000;

      await u.save();

      return ctx.editMessageText('🛡️ 已開啟',menu());
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
      const DEAD="0x000000000000000000000000000000000000dead";

      const contract = new ethers.Contract(
        process.env.TOKEN_ADDRESS,
        ["function balanceOf(address) view returns(uint256)"],
        provider
      );

      const raw = await contract.balanceOf(DEAD);
      const dead = Number(ethers.formatUnits(raw,18));

      return ctx.editMessageText(`🌌 黑洞:${dead}`,menu());
    }

    // ===== 任務 =====
    if(data==='task'){
      const u = await getUser(id);

      return ctx.editMessageText(
`📋 任務
🖱 ${u.tasks.daily.click}/30
⚔️ ${u.tasks.daily.steal}/10
🎮 ${u.tasks.daily.login?'✅':'❌'}`,menu());
    }

    // ===== 排行榜 =====
    if(data==='rank'){
      const list = await User.find().sort({balance:-1}).limit(5);

      let msg='🏆\n';
      list.forEach((u,i)=>{
        msg+=`${i+1}.${u.username} ${u.balance}\n`;
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

// ===== RUN =====
bot.launch();
console.log('🚀 Bot running');
