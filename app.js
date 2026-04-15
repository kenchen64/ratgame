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
.then(()=>console.log('✅ MongoDB OK'))
.catch(err=>console.log('❌ Mongo錯誤', err));

// ===== Model =====
const User = mongoose.models.User || mongoose.model('User',{
  telegramId:String,
  username:String,
  balance:{type:Number,default:0},
  steal:{type:Number,default:0},
  shieldUntil:{type:Number,default:0},
  lastClick:{type:Number,default:0},
  lastAttack:{type:Number,default:0},
  wallet:String
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

// ===== 工具 =====
async function getUser(id, username='user'){
  let u = await User.findOne({telegramId:id});
  if(!u){
    u = await User.create({telegramId:id, username});
  }
  return u;
}

// ===== 黑洞 =====
app.get('/blackhole', async (req,res)=>{
  try{
    const contract = new ethers.Contract(
      process.env.TOKEN_ADDRESS,
      ["function balanceOf(address) view returns(uint256)"],
      provider
    );

    const DEAD = "0x000000000000000000000000000000000000dead";
    const raw = await contract.balanceOf(DEAD);
    const total = ethers.formatUnits(raw, 18);

    res.json({total});
  }catch(e){
    res.json({total:"讀取失敗"});
  }
});

// ===== 偷邏輯 API🔥 =====
app.post('/attack', async (req,res)=>{
  const { attackerId, targetInput } = req.body;

  const attacker = await getUser(attackerId);

  if(Date.now() - attacker.lastAttack < 30000)
    return res.json({msg:'⏳ 冷卻中'});

  let target;

  // ===== 隨機 =====
  if(targetInput === 'random'){
    const list = await User.find({telegramId:{$ne:attackerId}});
    if(list.length === 0)
      return res.json({msg:'❌ 沒玩家可偷'});

    target = list[Math.floor(Math.random()*list.length)];
  }
  // ===== @username =====
  else if(targetInput.startsWith('@')){
    target = await User.findOne({
      username: targetInput.replace('@','')
    });
  }
  // ===== telegramId =====
  else{
    target = await User.findOne({
      telegramId: targetInput
    });
  }

  if(!target)
    return res.json({msg:'❌ 找不到玩家'});

  if(target.telegramId === attacker.telegramId)
    return res.json({msg:'❌ 不能偷自己'});

  if(target.shieldUntil > Date.now())
    return res.json({msg:'🛡️ 對方有護盾'});

  if(target.balance <= 0)
    return res.json({msg:'💸 對方沒錢'});

  const success = Math.random() > 0.4;

  if(success){
    let steal = Math.floor(target.balance * 0.2);
    steal = Math.max(1, steal);

    target.balance -= steal;
    attacker.balance += steal;
    attacker.steal += steal;

    await target.save();
    await attacker.save();

    attacker.lastAttack = Date.now();
    await attacker.save();

    return res.json({msg:`🐭 成功偷 ${steal}`});
  }else{
    let loss = Math.floor(attacker.balance * 0.1);
    attacker.balance -= loss;

    await attacker.save();

    attacker.lastAttack = Date.now();
    await attacker.save();

    return res.json({msg:`💥 失敗 -${loss}`});
  }
});

// ===== Bot =====
const bot = new Telegraf(process.env.BOT_TOKEN);

const menu = Markup.keyboard([
['🎮 開始遊戲','🖱 點擊赚起司'],
['⚔️ 偷起司','🛡️ 防護盾'],
['🌌 黑洞總量','🔗 綁定錢包'],
['💸 提領','🏆 排行榜']
]).resize();

// ===== FSM =====
const state = {};

// ===== Start =====
bot.start(ctx=>ctx.reply('🐭 Rat Game', menu));

// ===== 偷（入口🔥）=====
bot.hears('⚔️ 偷起司', ctx=>{
  state[ctx.from.id] = 'attack';

  ctx.reply(
`⚔️ 偷起司
輸入目標：

1️⃣ random（隨機）
2️⃣ @username
3️⃣ telegramId`
  );
});

// ===== FSM核心🔥 =====
bot.on('text', async (ctx, next)=>{
  const text = ctx.message.text.trim();
  const s = state[ctx.from.id];

  const isMenu = ['🎮','🖱','⚔️','🛡️','🌌','🔗','💸','🏆']
    .some(x=>text.includes(x));

  if(isMenu){
    delete state[ctx.from.id];
    return next();
  }

  // ===== 偷 =====
  if(s === 'attack'){
    const {data} = await axios.post(`http://localhost:${PORT}/attack`,{
      attackerId: ctx.from.id,
      targetInput: text
    });

    delete state[ctx.from.id];
    return ctx.reply(data.msg);
  }

  return next();
});

// ===== 其他功能（保留）=====
bot.hears('🖱 點擊赚起司', async ctx=>{
  const user = await getUser(ctx.from.id);
  user.balance++;
  await user.save();
  ctx.reply(`🆔Telegram: ${ctx.from.id}\n👤用戶名: ${ctx.from.username}\n🧀餘額: ${user.balance}`);
});

bot.hears('🏆 排行榜', async ctx=>{
  const top = await User.find().sort({balance:-1}).limit(10);
  let msg='🏆\n';
  top.forEach((u,i)=>{
    msg+=`${i+1}. ${u.username} ${u.balance}\n`;
  });
  ctx.reply(msg);
});

// ===== Webhook =====
app.use(bot.webhookCallback('/bot'));
bot.telegram.setWebhook(process.env.WEBHOOK_URL + '/bot');

app.listen(PORT, ()=>console.log('🚀 Running'));
