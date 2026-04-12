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

// 防止 model 重複
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

// ===== Web3 =====
let provider;
try{
  provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
}catch{
  provider = new ethers.JsonRpcProvider(process.env.RPC_URL_2);
}

const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const contract = new ethers.Contract(
  process.env.TOKEN_ADDRESS,
  [
    "function transfer(address,uint256)",
    "function balanceOf(address) view returns(uint256)",
    "function decimals() view returns(uint8)"
  ],
  wallet
);

const DEAD = "0x000000000000000000000000000000000000dead";

// ===== 共用 =====
async function getUser(id, username='user'){
  let u = await User.findOne({telegramId:id});
  if(!u){
    u = await User.create({telegramId:id, username});
  }
  return u;
}

// ===== API =====

// 取得自己（前端用）
app.post('/me', async (req,res)=>{
  const user = await getUser(req.body.telegramId, req.body.username);
  res.json(user);
});

// 點擊
app.post('/click', async (req,res)=>{
  try{
    const user = await getUser(req.body.telegramId, req.body.username);

    if(Date.now()-user.lastClick < 3000)
      return res.json({msg:'⏳ 冷卻', balance:user.balance});

    user.lastClick = Date.now();
    user.balance++;

    await user.save();

    res.json(user);
  }catch(e){
    res.json({msg:'error'});
  }
});

// 偷
app.post('/steal', async (req,res)=>{
  try{
    const user = await getUser(req.body.telegramId);

    const target = await User.findOne({telegramId:{$ne:user.telegramId}});

    if(!target) return res.json({msg:'❌ 無玩家'});

    if(Date.now()<target.shieldUntil)
      return res.json({msg:'🛡️ 對方有盾'});

    const amount = Math.min(10,target.balance);

    target.balance -= amount;
    user.balance += amount;
    user.steal += amount;

    await target.save();
    await user.save();

    res.json({msg:`🧀 偷到 ${amount}`});
  }catch{
    res.json({msg:'error'});
  }
});

// 防護盾（累加）
app.post('/shield', async (req,res)=>{
  try{
    const user = await getUser(req.body.telegramId);

    if(user.balance < 50)
      return res.json({msg:'❌ 不足50'});

    user.balance -= 50;

    user.shieldUntil =
      Math.max(user.shieldUntil, Date.now()) + 60000;

    await user.save();

    res.json({
      msg:`🛡️ 剩餘 ${Math.floor((user.shieldUntil-Date.now())/1000)} 秒`
    });
  }catch{
    res.json({msg:'error'});
  }
});

// 黑洞
app.get('/blackhole', async (req,res)=>{
  try{
    const raw = await contract.balanceOf(DEAD);
    const dec = await contract.decimals();

    res.json({total:Number(raw)/(10**dec)});
  }catch{
    res.json({total:0});
  }
});

// 綁定
app.post('/bind', async (req,res)=>{
  try{
    const user = await getUser(req.body.telegramId);

    if(!ethers.isAddress(req.body.wallet))
      return res.json({msg:'❌ 地址錯誤'});

    user.wallet = req.body.wallet;
    await user.save();

    res.json({msg:`已綁定: ${user.wallet}`});
  }catch{
    res.json({msg:'error'});
  }
});

// 提領
app.post('/withdraw', async (req,res)=>{
  try{
    const user = await getUser(req.body.telegramId);

    if(!user.wallet)
      return res.json({msg:'❌ 未綁定'});

    if(user.balance < 100)
      return res.json({msg:'❌ 最低100'});

    const tx = await contract.transfer(
      user.wallet,
      ethers.parseUnits(user.balance.toString(),18)
    );

    user.balance = 0;
    await user.save();

    res.json({msg:`成功\n${tx.hash}`});
  }catch{
    res.json({msg:'❌ 失敗'});
  }
});

// 排行榜
app.get('/rank', async (req,res)=>{
  const topClick = await User.find().sort({balance:-1}).limit(5);
  const topSteal = await User.find().sort({steal:-1}).limit(5);
  res.json({topClick, topSteal});
});

// ===== Bot =====
const bot = new Telegraf(process.env.BOT_TOKEN);

const menu = Markup.keyboard([
['🎮 開始遊戲','🖱 點擊赚起司'],
['⚔️ 偷起司','🛡️ 防護盾'],
['🌌 黑洞總量','🔗 綁定錢包'],
['💸 提領','🏆 排行榜']
]).resize();

// ===== 開始 =====
bot.start(ctx=>{
  ctx.reply('🐭 遊戲開始', menu);
});

bot.hears('🎮 開始遊戲', ctx=>{
  ctx.reply('🎮 已開始', menu);
});

bot.hears('🖱 點擊赚起司', async ctx=>{
  try{
    const {data} = await axios.post(`http://localhost:${PORT}/click`,{
      telegramId:ctx.from.id,
      username:ctx.from.username
    });
    ctx.reply(`🆔Telegram: ${ctx.from.id}\n👤用戶名: ${ctx.from.username}\n🧀餘額: ${data.balance}`);
  }catch{
    ctx.reply('❌ 錯誤');
  }
});

bot.hears('⚔️ 偷起司', async ctx=>{
  const {data} = await axios.post(`http://localhost:${PORT}/steal`,{
    telegramId:ctx.from.id
  });
  ctx.reply(data.msg);
});

bot.hears('🛡️ 防護盾', async ctx=>{
  const {data} = await axios.post(`http://localhost:${PORT}/shield`,{
    telegramId:ctx.from.id
  });
  ctx.reply(data.msg);
});

bot.hears('🌌 黑洞總量', async ctx=>{
  const {data} = await axios.get(`http://localhost:${PORT}/blackhole`);
  ctx.reply(`🌌 ${data.total}`);
});

bot.hears('🔗 綁定錢包', ctx=>{
  ctx.reply('輸入地址:');
});

bot.on('text', async ctx=>{
  if(ctx.message.text.startsWith('0x')){
    const {data} = await axios.post(`http://localhost:${PORT}/bind`,{
      telegramId:ctx.from.id,
      wallet:ctx.message.text
    });
    ctx.reply(data.msg);
  }
});

bot.hears('💸 提領', async ctx=>{
  const {data} = await axios.post(`http://localhost:${PORT}/withdraw`,{
    telegramId:ctx.from.id
  });
  ctx.reply(data.msg);
});

bot.hears('🏆 排行榜', async ctx=>{
  const {data} = await axios.get(`http://localhost:${PORT}/rank`);

  let msg='🏆 點擊榜\n';
  data.topClick.forEach((u,i)=>{
    msg+=`${i+1}. ${u.username} ${u.balance}\n`;
  });

  msg+='\n⚔️ 偷取榜\n';
  data.topSteal.forEach((u,i)=>{
    msg+=`${i+1}. ${u.username} ${u.steal}\n`;
  });

  ctx.reply(msg);
});

// ===== Webhook =====
app.use(bot.webhookCallback('/bot'));
bot.telegram.setWebhook(process.env.WEBHOOK_URL + '/bot');

// ===== 啟動 =====
app.listen(PORT, ()=>console.log(`🚀 Running ${PORT}`));
