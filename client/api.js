const tg = window.Telegram.WebApp;
tg.expand();

// 建議手動指定後端網址，避免前端與後端不在同一個 Domain
const BASE_URL = window.location.origin; 

export async function api(path, data = {}) {
  // 檢查 initData 是否存在 (必須在 Telegram 內開啟)
  if (!tg.initData) {
    alert("❌ 請從 Telegram 內啟動遊戲");
    return;
  }

  try {
    const res = await fetch(BASE_URL + path, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        // ✅ 必須加入這個 Header，後端才能進行 initData 驗證
        "x-telegram-init-data": tg.initData 
      },
      // ✅ 後端會從驗證資料中抓取 ID，這裡只需要傳送額外的 data 即可
      body: JSON.stringify(data)
    });

    if (res.status === 401 || res.status === 403) {
      alert("❌ 驗證失敗，請嘗試重新開啟遊戲");
      return;
    }

    return await res.json();
  } catch (err) {
    console.error("API 請求錯誤:", err);
    // 只有在真的連不到伺服器時才彈窗，避免干擾體驗
    // alert("網路連線錯誤"); 
    return null;
  }
}
