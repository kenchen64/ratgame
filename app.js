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
  banned:{type:Boolean,default:false}
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

app.post('/click', async (req,res)=>{
  const user = await getUser(req.body.telegramId);

  if(Date.now()-user.lastClick < 3000){
    return res.json({msg:'⏳ 點擊過快', balance:user.balance});
  }

  user.lastClick = Date.now();
  user.balance++;

  await user.save();
  res.json(user);
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

// ===== Bot =====
const bot = new Telegraf(process.env.BOT_TOKEN);

const menu = Markup.keyboard([
['🎮 開始遊戲','🖱 點擊赚起司'],
['⚔️ 偷起司','🛡️ 防護盾'],
['🌌 黑洞總量','🔗 綁定錢包'],
['💸 提領','🏆 排行榜']
]).resize();

// ===== FSM 狀態 =====
const state = {};

// ===== 開始 =====
bot.start(ctx=>ctx.reply('🐭 遊戲開始',menu));

// ===== 點擊 =====
bot.hears('🖱 點擊赚起司', async ctx=>{
  const {data} = await axios.post(`http://localhost:${PORT}/click`,{
    telegramId:ctx.from.id
  });

  if(data.msg) return ctx.reply(data.msg);

  ctx.reply(`🧀 ${data.balance}`);
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

// ===== 核心 FSM 修正🔥 =====
bot.on('text', async (ctx, next)=>{
  const text = ctx.message.text.trim();
  const s = state[ctx.from.id];

  // 👉 按鈕點擊直接清狀態（關鍵🔥）
  const menuText = [
    '🎮','🖱','⚔️','🛡️','🌌','🔗','💸','🏆'
  ];

  if(menuText.some(t=>text.includes(t))){
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

// ===== 提領 =====
bot.hears('💸 提領', async ctx=>{
  delete state[ctx.from.id];

  const {data} = await axios.post(`http://localhost:${PORT}/withdraw`,{
    telegramId:ctx.from.id
  });

  ctx.reply(data.msg);
});

// ===== 排行榜 =====
bot.hears('🏆 排行榜', async ctx=>{
  delete state[ctx.from.id];

  const {data} = await axios.get(`http://localhost:${PORT}/rank`);

  let msg='🏆\n';
  data.topClick.forEach((u,i)=>{
    msg+=`${i+1}. ${u.username} ${u.balance}\n`;
  });

  ctx.reply(msg);
});

// ===== Webhook =====
app.use(bot.webhookCallback('/bot'));
bot.telegram.setWebhook(process.env.WEBHOOK_URL + '/bot');

app.listen(PORT, ()=>console.log(`🚀 Running ${PORT}`));
