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

  // 防腳本 AI（行為偵測升級）
function antiBotAI(user){
  const now = Date.now();

  // 初始化
  if(!user.clickHistory){
    user.clickHistory = [];
  }

  // 記錄最近點擊
  user.clickHistory.push(now);

  // 保留最近10筆
  if(user.clickHistory.length > 10){
    user.clickHistory.shift();
  }

  // 👉 計算平均間隔
  if(user.clickHistory.length >= 5){
    let intervals = [];
    for(let i=1;i<user.clickHistory.length;i++){
      intervals.push(user.clickHistory[i] - user.clickHistory[i-1]);
    }

    const avg = intervals.reduce((a,b)=>a+b,0)/intervals.length;

    // 👉 太穩定 = 機器人
    if(avg < 400){
      user.banned = true;
      return true;
    }
  }

  return false;
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
    if(Date.now()-user.lastClick < 3000){
  return res.json({
    msg:'⏳ 點擊過快',
    balance:user.balance
  });
}
    user.lastClick = Date.now();
    user.balance++;
    if(antiBotAI(user)){
  await user.save();
    return res.json({msg:'🤖 偵測到腳本，已封鎖'});
    res.json(user);
  }catch(e){
    res.json({msg:'error'});
  }
}
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

    const amount = Math.max(1, Math.floor(target.balance * 0.2));

    target.balance -= amount;
    user.balance += amount;
    user.steal += amount;

    await target.save();
    await user.save();

    res.json({
      msg:`🐭 成功偷到 ${target.username}\n+${amount} 🧀`
    });

  }catch(e){
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
    const [raw, dec] = await Promise.all([
      contract.balanceOf(DEAD),
      contract.decimals()
    ]);

    const total = Number(ethers.formatUnits(raw, dec));

    res.json({total});

  }catch(e){
    console.log('blackhole error:', e.message);
    res.json({total:'讀取失敗'});
  }
});

// 綁定
app.post('/bind', async (req,res)=>{
  try{
    const user = await getUser(req.body.telegramId);

    if(!ethers.isAddress(req.body.wallet))
      return res.json({msg:'❌ 地址錯誤'});

    const old = user.wallet;

    user.wallet = req.body.wallet;
    await user.save();

    if(old){
      return res.json({
        msg:`已綁定錢包:\n${old}\n\n🔄 已更新為:\n${user.wallet}`
      });
    }

    res.json({msg:`✅ 綁定成功\n${user.wallet}`});

  }catch{
    res.json({msg:'error'});
  }
});

// 提領
app.post('/withdraw', async (req,res)=>{
  try{
    const user = await getUser(req.body.telegramId);

    if(!user.wallet)
      return res.json({msg:'❌ 未綁定錢包'});

    if(user.balance < 100)
      return res.json({msg:'❌ 最低100'});

    const tx = await contract.transfer(
      user.wallet,
      ethers.parseUnits(user.balance.toString(),18)
    );

    user.balance = 0;
    await user.save();

    res.json({msg:`✅ 提領成功\n${tx.hash}`});

  }catch(e){
    console.log('withdraw error:', e.message);
    res.json({msg:`❌ 提領失敗\n${e.message}`});
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

// 查錢包 TOKEN 數量
app.get('/walletBalance', async (req,res)=>{
  try{
    if(!req.query.wallet)
      return res.json({balance:0});

    const raw = await contract.balanceOf(req.query.wallet);
    const dec = await contract.decimals();

    const balance = Number(ethers.formatUnits(raw, dec));

    res.json({balance});

  }catch(e){
    console.log('walletBalance error:', e.message);
    res.json({balance:0});
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
     if(data.msg){
      return  ctx.reply(`${data.msg}\n🧀餘額: ${data.balance}`);
    }
    ctx.reply(`🆔Telegram: ${ctx.from.id}\n👤用戶名: ${ctx.from.username}\n🧀餘額: ${data.balance}`);
  }catch{
    ctx.reply('❌ 錯誤');
  }
});

bot.hears('⚔️ 偷起司', ctx=>{
  ctx.reply('輸入:\n/steal (隨機)\n/steal @username\n/steal id');
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

bot.hears('🔗 綁定錢包', async ctx=>{
  try{
    const {data} = await axios.post(`http://localhost:${PORT}/me`,{
      telegramId: ctx.from.id,
      username: ctx.from.username
    });

    let tokenAmount = 0;

    // 👉 有錢包才查 token
    if(data.wallet){
      try{
        const res = await axios.get(`http://localhost:${PORT}/walletBalance`,{
          params:{ wallet: data.wallet }
        });
        tokenAmount = res.data.balance;
      }catch(e){
        console.log('walletBalance error:', e.message);
      }
    }

    // 👉 開啟輸入模式
    waitWallet[ctx.from.id] = true;

    if(data.wallet){
      return ctx.reply(
`已綁定錢包:
${data.wallet}

TOKEN_ADDRESS數量:
${tokenAmount}

輸入新地址:`
      );
    }

    ctx.reply('請輸入錢包地址:');

  }catch(e){
    console.log('bind btn error:', e.message);
    ctx.reply('❌ 系統錯誤');
  }
});

bot.hears('💸 提領', async ctx=>{
  try{
    const {data} = await axios.post(`http://localhost:${PORT}/withdraw`,{
      telegramId:ctx.from.id
    });

    ctx.reply(data.msg);

  }catch(e){
    ctx.reply('❌ 提領錯誤');
  }
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
