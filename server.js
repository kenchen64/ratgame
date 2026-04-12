require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { ethers } = require('ethers');

const app = express();
app.use(express.json());

// ===== RPC（雙節點防掛）=====
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const providerBackup = new ethers.JsonRpcProvider(process.env.RPC_URL_2);

function getProvider() {
  return provider;
}

// ===== Web3 =====
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, getProvider());

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

// ===== DB =====
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  ssl: true,
  tls: true,
})
.then(()=>console.log('✅ MongoDB 連線成功'))
.catch(err=>console.log('❌ Mongo錯誤:', err));

const User = mongoose.model('User', {
  telegramId: String,
  username: String,
  balance: { type: Number, default: 0 },
  steal: { type: Number, default: 0 },
  shieldUntil: { type: Number, default: 0 },
  lastClick: { type: Number, default: 0 },
  wallet: String,
  banned: { type: Boolean, default: false }
});

// ===== 共用 =====
async function getUser(id, username='user'){
  let user = await User.findOne({telegramId:id});
  if(!user){
    user = await User.create({telegramId:id, username});
  }
  return user;
}

// ===== AI 防外掛 =====
function antiBot(user){
  if(Date.now() - user.lastClick < 300){
    user.banned = true;
  }
}

// ===== 點擊 =====
app.post('/click', async (req,res)=>{
  const user = await getUser(req.body.telegramId, req.body.username);

  if(user.banned)
    return res.json({msg:'🚫 已封鎖'});

  if(Date.now() - user.lastClick < 1000)
    return res.json({msg:'⏳ 冷卻中', balance:user.balance});

  antiBot(user);

  user.lastClick = Date.now();
  user.balance += 1;

  await user.save();

  res.json({
    id:user.telegramId,
    balance:user.balance
  });
});

// ===== 偷起司 =====
app.post('/steal', async (req,res)=>{
  const user = await getUser(req.body.telegramId);

  const target = await User.findOne({
    telegramId: { $ne: user.telegramId }
  });

  if(!target) return res.json({msg:'❌ 無玩家'});

  if(Date.now() < target.shieldUntil)
    return res.json({msg:'🛡️ 對方有盾'});

  const amount = Math.min(10, target.balance);

  target.balance -= amount;
  user.balance += amount;
  user.steal += amount;

  await target.save();
  await user.save();

  res.json({msg:`🧀 偷到 ${amount}`});
});

// ===== 防護盾（累加）=====
app.post('/shield', async (req,res)=>{
  const user = await getUser(req.body.telegramId);

  if(user.balance < 50)
    return res.json({msg:'❌ 不足50'});

  user.balance -= 50;

  user.shieldUntil =
    Math.max(user.shieldUntil, Date.now()) + 60000;

  await user.save();

  res.json({
    msg:`🛡️ 啟動\n剩餘 ${Math.floor((user.shieldUntil - Date.now())/1000)} 秒`
  });
});

// ===== 黑洞（鏈上）=====
app.get('/blackhole', async (req,res)=>{
  const raw = await contract.balanceOf(DEAD);
  const dec = await contract.decimals();

  res.json({
    total: Number(raw)/(10**dec)
  });
});

// ===== 綁定錢包 =====
app.post('/bind', async (req,res)=>{
  const user = await getUser(req.body.telegramId);

  if(user.wallet)
    return res.json({msg:`已綁定: ${user.wallet}`});

  if(!ethers.isAddress(req.body.wallet))
    return res.json({msg:'❌ 地址錯誤'});

  user.wallet = req.body.wallet;
  await user.save();

  res.json({msg:'✅ 綁定成功'});
});

// ===== 提領 =====
app.post('/withdraw', async (req,res)=>{
  const user = await getUser(req.body.telegramId);

  if(!user.wallet)
    return res.json({msg:'❌ 未綁定'});

  if(user.balance < 100)
    return res.json({msg:'❌ 最低100'});

  try{
    const tx = await contract.transfer(
      user.wallet,
      ethers.parseUnits(user.balance.toString(),18)
    );

    user.balance = 0;
    await user.save();

    res.json({msg:`成功\n${tx.hash}`});

  }catch(e){
    res.json({msg:'❌ 失敗'});
  }
});

// ===== 排行榜 =====
app.get('/rank', async (req,res)=>{
  const topClick = await User.find().sort({balance:-1}).limit(5);
  const topSteal = await User.find().sort({steal:-1}).limit(5);

  res.json({topClick, topSteal});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Server OK'));
