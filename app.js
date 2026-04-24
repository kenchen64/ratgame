require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const { Telegraf } = require('telegraf');
const { ethers } = require('ethers');
const express = require('express');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 10000;

// ===== DB =====
mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log('✅ Mongo OK'))
.catch(err=>console.log(err));

// ===== Schema =====
const User = mongoose.model('User', new mongoose.Schema({
  telegramId:String,
  username:String,
  balance:{type:Number,default:0},
  steal:{type:Number,default:0},
  inviteCount:{type:Number,default:0},
  shieldUntil:{type:Number,default:0},
  lastClick:{type:Number,default:0},
  wallet:String,

  tasks:{
    daily:{
      click:{type:Number,default:0},
      steal:{type:Number,default:0},
      invite:{type:Number,default:0,claimed:false},
      rewardClaimed: { type:Boolean, default:false },
      login:{type:Boolean,default:false}
    },
    weekly:{
      click:{type:Number,default:0},
      steal:{type:Number,default:0},
      invite: { type:Number, default:0 },
      loginDays: { type:Number, default:0 },
      rewardClaimed: { type:Boolean, default:false }
    },
    achievement:{
      totalClick:{type:Number,default:0},
      totalSteal:{type:Number,default:0},
      totalInvite: { type:Number, default:0 }
    }
  }
}));

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

// ===== FSM =====
const FSM = {state:{},timer:{}};

function setState(ctx,name){
  const id = ctx.from.id;
  clearState(id);
  FSM.state[id]=name;

  FSM.timer[id]=setTimeout(()=>{
    clearState(id);
    ctx.telegram.sendMessage(id,'⌛ 已取消');
  },10000);
}

function clearState(id){
  if(FSM.timer[id]) clearTimeout(FSM.timer[id]);
  delete FSM.timer[id];
  delete FSM.state[id];
}

function getState(id){return FSM.state[id];}

// ===== UI =====
function menu(){
  return {
    reply_markup:{
      inline_keyboard:[
        [{text:'🎮 開始遊戲',callback_data:'start'},{text:'📋 任務',callback_data:'task'}],
        [{text:'🖱 點擊賺起司',callback_data:'click'},{text:'🏆 排行榜',callback_data:'rank'}],
        [{text:'⚔️ 偷起司',callback_data:'steal'},{text:'🛡️ 防護盾',callback_data:'shield'}],
        [{text:'🌌 起司經濟',callback_data:'blackhole'},{text:'🔗 綁定錢包',callback_data:'wallet'}],
      ]
    }
  };
}

// ===== 安全發送 =====
async function safeSend(ctx, text){
  try{
    return await ctx.editMessageText(text, menu());
  }catch{
    return await ctx.reply(text, menu());
  }
}

// ===== START =====
bot.start(async ctx=>{
  clearState(ctx.from.id);
  const user = await getUser(ctx.from.id, ctx.from.username);
  user.tasks.daily.login = true;
  await user.save();
  
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
        return ctx.answerCbQuery('⏳ 太快');
      }

      u.lastClick = Date.now();
      u.balance += 1;

      u.tasks.daily.click++;
      u.tasks.weekly.click++;
      u.tasks.achievement.totalClick++;
      
      await u.save();

      return ctx.editMessageText(
`🆔 ${id}
👤 ${u.username}
🧀 ${u.balance}

📋 任務
每日點擊:${u.tasks.daily.click}/30`, menu());
    }

    // ===== 偷起司（修正無反應🔥）=====
    if(data==='steal'){
      const users = await User.find({telegramId:{$ne:id}});
      if(users.length===0) return ctx.answerCbQuery('❌ 沒老鼠可偷');

      const attacker = await getUser(id);
      const target = users[Math.floor(Math.random()*users.length)];
      if(Date.now() < target.shieldUntil){
        return ctx.answerCbQuery('🛡️ 對方有盾');
      }
      if(target.balance<=0){
        return ctx.answerCbQuery('💸 對方沒錢');
      }
      const steal = Math.max(1, Math.floor(target.balance * 0.2));
      target.balance -= steal;
      attacker.balance += steal;

      attacker.steal++;
      attacker.tasks.daily.steal++;
      attacker.tasks.weekly.steal++;
      attacker.tasks.achievement.totalSteal++;

      await target.save();
      await attacker.save();

      return safeSend(ctx,
`🐭 偷成功！
🎯 ${target.username}
🧀 +${steal}

📋 任務:${attacker.tasks.daily.steal}/10`);
    }

    // ===== 防護盾 =====
    if(data==='shield'){
      const u = await getUser(id);
      const remain = u.shieldUntil > Date.now()
        ? Math.floor((u.shieldUntil - Date.now())/1000)
        : 0;

      return ctx.reply(
`🛡️ 護盾
剩餘:${remain}s
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

      if(u.balance<50) return ctx.answerCbQuery('不足50');

      u.balance -= 50;

      const base = u.shieldUntil > Date.now()
        ? u.shieldUntil
        : Date.now();

      u.shieldUntil = base + 60000;

      await u.save();

      const remain = Math.floor((u.shieldUntil - Date.now())/1000);

      return ctx.reply(`🛡️ 已開啟\n剩餘:${remain}s`, menu());
    }

    if(data==='shield_no'){
      return ctx.editMessageText('取消', menu());
    }

    // ===== 錢包（UI不消失🔥）=====
    if(data==='wallet'){
      setState(ctx,'wallet');
      const u = await getUser(id);

      return ctx.editMessageText(
`目前錢包:${u.wallet||'未綁定'}
輸入新地址`, menu());
    }

    // ===== 黑洞 =====
    if(data==='blackhole'){
      const provider = await getProvider();
      const contract = new ethers.Contract(
        process.env.TOKEN_ADDRESS,
        [
          "function balanceOf(address) view returns(uint256)",
          "function totalSupply() view returns(uint256)"
        ],
        provider
      );

      const DEAD="0x000000000000000000000000000000000000dead";

      const [deadRaw, supplyRaw] = await Promise.all([
        contract.balanceOf(DEAD),
        contract.totalSupply()
      ]);

      const dead = Number(ethers.formatUnits(deadRaw,18));
      const supply = Number(ethers.formatUnits(supplyRaw,18));
      const remain = supply - dead;

      let price = 0;
      try{
        const cg = await axios.get(
          `https://api.coingecko.com/api/v3/simple/token_price/binance-smart-chain`,
          {params:{
            contract_addresses:process.env.TOKEN_ADDRESS,
            vs_currencies:'usd'
          }}
        );
        const addr = process.env.TOKEN_ADDRESS.toLowerCase();
        price = cg.data[addr]?.usd || 0;
      }catch{}

      return ctx.editMessageText(
`🌌 黑洞數量:${dead}
💰 目前價值:$${price}
🧀 起司總量:${remain}`, menu());
    }

    // ===== 任務 + 獎勵 =====
    if(data==='task'){
      const u = await getUser(id);
      let rewardMsg = '';

      // 每日任務完成
      if(u.tasks.daily.click >= 30 &&
      u.tasks.daily.steal >= 10 &&
      u.tasks.daily.invite >= 1 &&
      u.tasks.daily.login &&
      !u.tasks.daily.rewardClaimed){
      u.balance+=50;
      u.tasks.daily.rewardClaimed = true;
        rewardMsg+='🎁 每日任務完成 +50\n';
      }
      // 每周任務完成
      if(u.tasks.weekly.click >= 200 &&
      u.tasks.weekly.steal >= 50 &&
      u.tasks.weekly.invite >= 5 &&
      u.tasks.weekly.loginDays >= 7 &&
      !u.tasks.weekly.rewardClaimed){
      u.balance+=200;
      u.tasks.weekly.rewardClaimed = true;
        rewardMsg+='🎁 每周任務完成 +200\n';
      }

      await u.save();

      return safeSend(ctx,
`📋 【每日任務】
🖱 點擊:${u.tasks.daily.click}/30
⚔️ 偷起司:${u.tasks.daily.steal}/10
👥 邀請:${u.tasks.daily.invite}/1
🎮 登入:${u.tasks.daily.login?'✅':'❌'}
📆 【每週任務】
🖱 點擊:${u.tasks.weekly.click}/200
⚔️ 偷起司:${u.tasks.weekly.steal}/50
👥 邀請:${u.tasks.weekly.invite}/5
📅 登入天數:${u.tasks.weekly.loginDays}/7
🏆 【成就】
🖱 總點擊:${u.tasks.achievement.totalClick}
⚔️ 總偷取:${u.tasks.achievement.totalSteal}
👥 總邀請:${u.tasks.achievement.totalInvite}
${rewardMsg}`);
    }

    // ===== 排行榜（3榜🔥）=====
    if(data==='rank'){
      const clickTop = await User.find().sort({balance:-1}).limit(5);
      const stealTop = await User.find().sort({steal:-1}).limit(5);
      const inviteTop = await User.find().sort({inviteCount:-1}).limit(5);

      let msg='🏆 點擊榜\n';
      clickTop.forEach((u,i)=>{
        msg+=`${i+1}.${u.username} ${u.balance}\n`;
      });

      msg+='\n⚔️ 偷取榜\n';
      stealTop.forEach((u,i)=>{
        msg+=`${i+1}.${u.username} ${u.steal}\n`;
      });

      msg+='\n👥 邀請榜\n';
      inviteTop.forEach((u,i)=>{
        msg+=`${i+1}.${u.username} ${u.inviteCount}\n`;
      });

      return ctx.editMessageText(msg, menu());
    }

  }catch(e){
    console.log(e);
    clearState(id);
    ctx.reply('錯誤');
  }
});

// ===== FSM =====
bot.on('text', async ctx=>{
  const id = ctx.from.id;
  const s = getState(id);
  if(!s) return;

  if(s==='wallet'){
    clearState(id);

    if(!/^0x[a-fA-F0-9]{40}$/.test(ctx.message.text)){
      return ctx.reply('地址錯誤');
    }

    await User.updateOne({telegramId:id},{wallet:ctx.message.text});

    return ctx.reply('✅ 綁定成功', menu());
  }
});

// ===== Webhook =====
app.use(bot.webhookCallback('/bot'));
bot.telegram.setWebhook(process.env.WEBHOOK_URL + '/bot');

app.get('/',(req,res)=>res.send('OK'));
app.listen(PORT,()=>console.log('🚀 Running'));
