require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
app.use(express.json());

const API = process.env.API_URL;

// ===== 主選單 =====
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

// ===== 點擊 =====
bot.hears('🖱 點擊赚起司', async ctx=>{
  const res = await axios.post(`${API}/click`,{
    telegramId: ctx.from.id,
    username: ctx.from.username
  });

  ctx.reply(`🆔 ${ctx.from.id}\n💰 ${res.data.balance}`);
});

// ===== 偷 =====
bot.hears('⚔️ 偷起司', async ctx=>{
  const res = await axios.post(`${API}/steal`,{
    telegramId: ctx.from.id
  });
  ctx.reply(res.data.msg);
});

// ===== 防護盾 =====
bot.hears('🛡️ 防護盾', async ctx=>{
  const res = await axios.post(`${API}/shield`,{
    telegramId: ctx.from.id
  });
  ctx.reply(res.data.msg);
});

// ===== 黑洞 =====
bot.hears('🌌 黑洞總量', async ctx=>{
  const res = await axios.get(`${API}/blackhole`);
  ctx.reply(`🌌 ${res.data.total}`);
});

// ===== 綁定錢包 =====
bot.hears('🔗 綁定錢包', ctx=>{
  ctx.reply('輸入地址:');
});

bot.on('text', async ctx=>{
  if(ctx.message.text.startsWith('0x')){
    const res = await axios.post(`${API}/bind`,{
      telegramId: ctx.from.id,
      wallet: ctx.message.text
    });
    ctx.reply(res.data.msg);
  }
});

// ===== 提領 =====
bot.hears('💸 提領', async ctx=>{
  const res = await axios.post(`${API}/withdraw`,{
    telegramId: ctx.from.id
  });
  ctx.reply(res.data.msg);
});

// ===== 排行榜 =====
bot.hears('🏆 排行榜', async ctx=>{
  const res = await axios.get(`${API}/rank`);

  let msg = '🏆 點擊榜\n';
  res.data.topClick.forEach((u,i)=>{
    msg += `${i+1}. ${u.username} ${u.balance}\n`;
  });

  msg += '\n⚔️ 偷取榜\n';
  res.data.topSteal.forEach((u,i)=>{
    msg += `${i+1}. ${u.username} ${u.steal}\n`;
  });

  ctx.reply(msg);
});

// ===== Webhook =====
app.use(bot.webhookCallback('/bot'));

bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/bot`);

app.listen(3001, ()=>console.log('🤖 Bot Webhook OK'));
