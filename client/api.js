// 請換成你 Render 的實際網址
const BASE_URL = "https://ratgame.onrender.com"; 

export async function api(path, data = {}) {
  const tg = window.Telegram.WebApp;
  
  if (!tg.initData) {
    console.error("No initData found");
    return;
  }

  try {
    const res = await fetch(BASE_URL + path, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-telegram-init-data": tg.initData  // 傳送驗證字串
      },
      body: JSON.stringify(data)
    });

    return await res.json();
  } catch (err) {
    console.error("Render 連線失敗:", err);
  }
}

