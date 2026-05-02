require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 10000;

app.use(express.json());

// ===== Mongo =====
mongoose.connect(process.env.MONGO_URI);

// ===== 玩家 Schema =====
const User = mongoose.model('User', new mongoose.Schema({
  telegramId:String,
  username:String,
  balance:{type:Number,default:0},
  level:{type:Number,default:1},
  exp:{type:Number,default:0},
  hp:{type:Number,default:100},
  maxHp:{type:Number,default:100},
  lastClick:{type:Number,default:0},
  shieldUntil:{type:Number,default:0}
}));

function calcLevel(u){
  const need = u.level * 20;
  if(u.exp >= need){
    u.exp = 0;
    u.level += 1;
    u.maxHp += 20;
    u.hp = u.maxHp;
  }
}

async function getUser(id, username){
  let u = await User.findOne({telegramId:id});
  if(!u){
    u = await User.create({
      telegramId:id,
      username:username || `user_${id}`
    });
  }
  return u;
}

// ===== API =====
app.post('/me', async (req,res)=>{
  const u = await getUser(req.body.telegramId, req.body.username);
  res.json(u);
});

// 點擊（攻擊+經驗）
app.post('/click', async (req,res)=>{
  const u = await getUser(req.body.telegramId);

  if(Date.now()-u.lastClick < 1200){
    return res.json({msg:'⏳ 太快'});
  }

  u.lastClick = Date.now();

  const dmg = Math.floor(Math.random()*5)+1;
  u.balance += dmg;
  u.exp += dmg;

  calcLevel(u);
  await u.save();

  res.json({msg:`💥 +${dmg}`});
});

// 偷（戰鬥）
app.post('/steal', async (req,res)=>{
  const attacker = await getUser(req.body.telegramId);
  const users = await User.find({telegramId:{$ne:attacker.telegramId}});

  if(users.length===0) return res.json({msg:'❌ 沒玩家'});

  const target = users[Math.floor(Math.random()*users.length)];

  if(Date.now()<target.shieldUntil){
    return res.json({msg:'🛡️ 對方有盾'});
  }

  const dmg = Math.floor(Math.random()*10)+5;
  target.hp -= dmg;

  let msg = `⚔️ 攻擊 ${target.username} -${dmg}HP`;

  if(target.hp <= 0){
    const reward = Math.max(1, Math.floor(target.balance*0.3));
    attacker.balance += reward;
    target.balance -= reward;
    target.hp = target.maxHp;
    msg += `\n💀 擊敗！+${reward}`;
  }

  await attacker.save();
  await target.save();

  res.json({msg});
});

// 護盾
app.post('/shield', async (req,res)=>{
  const u = await getUser(req.body.telegramId);

  if(u.balance<50) return res.json({msg:'❌ 不足50'});

  u.balance -= 50;

  const base = u.shieldUntil>Date.now()?u.shieldUntil:Date.now();
  u.shieldUntil = base + 60000;

  await u.save();

  res.json({msg:'🛡️ 護盾+60秒'});
});

// ===== 前端 =====
app.use(express.static(path.join(__dirname,'client')));
app.get('*',(req,res)=>{
  res.sendFile(path.join(__dirname,'client','index.html'));
});

// ===== Bot =====
bot.start((ctx)=>{
  ctx.reply('🎮 Rat Game', {
    reply_markup:{
      keyboard:[
        [{
          text:'🎮 進入遊戲',
          web_app:{ url: process.env.WEBAPP_URL }
        }]
      ],
      resize_keyboard:true
    }
  });
});

// webhook
app.use(bot.webhookCallback('/bot'));
bot.telegram.setWebhook(process.env.WEBHOOK_URL + '/bot');

app.listen(PORT,()=>console.log('🚀 Running'));
