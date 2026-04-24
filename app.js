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
      login:{type:Boolean,default:false}
    },
    weekly:{
      click:{type:Number,default:0},
      steal:{type:Number,default:0}
    },
    achievement:{
      totalClick:{type:Number,default:0},
      totalSteal:{type:Number,default:0}
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

// ===== Web3 =====
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

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
        [{text:'🌌 黑起司經濟',callback_data:'blackhole'},{text:'🔗 綁定錢包',callback_data:'wallet'}],
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
      if(users.length===0) return ctx.answerCbQuery('❌ 沒人');

      const t = users[Math.floor(Math.random()*users.length)];
      const a = await getUser(id);

      if(Date.now() < t.shieldUntil)
        return ctx.answerCbQuery('🛡️ 對方有盾');

      if(t.balance<=0)
        return ctx.answerCbQuery('💸 對方沒錢');

      const steal = Math.floor(t.balance*0.2);

      t.balance -= steal;
      a.balance += steal;

      a.steal++;
      a.tasks.daily.steal++;
      a.tasks.weekly.steal++;
      a.tasks.achievement.totalSteal++;

      await t.save();
      await a.save();

      return ctx.editMessageText(
`🐭 偷到 ${steal}
👤 對象:${t.username}

📋 任務
偷:${a.tasks.daily.steal}/10`, menu());
    }

    // ===== 防護盾 =====
    if(data==='shield'){
      const u = await getUser(id);
      const remain = u.shieldUntil > Date.now()
        ? Math.floor((u.shieldUntil - Date.now())/1000)
        : 0;

      return ctx.editMessageText(
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

      return ctx.editMessageText(`🛡️ 已開啟\n剩餘:${remain}s`, menu());
    }

    if(data==='shield_no'){
      return ctx.editMessageText('取消', menu());
    }

    // ===== 錢包（UI不消失🔥）=====
    if(data==='wallet'){
      setState(ctx,'wallet');
      const u = await getUser(id);

      return ctx.reply(
`目前:${u.wallet||'未綁定'}
輸入新地址`, menu());
    }

    // ===== 黑洞 =====
    if(data==='blackhole'){
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

    // ===== 任務 =====
    if(data==='task'){
      const u = await getUser(id);

      return ctx.editMessageText(
`📋 每日
點擊:${u.tasks.daily.click}/30
偷:${u.tasks.daily.steal}/10

📆 每週
點擊:${u.tasks.weekly.click}/200
偷:${u.tasks.weekly.steal}/50

🏆 成就
點擊:${u.tasks.achievement.totalClick}
偷:${u.tasks.achievement.totalSteal}`, menu());
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
