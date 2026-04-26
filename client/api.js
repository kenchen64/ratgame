const tg = window.Telegram.WebApp;
tg.expand();

const BASE_URL = window.location.origin;

export async function api(path, data = {}) {
  const user = tg.initDataUnsafe?.user;

  if (!user) {
    alert("❌ 無法取得 Telegram 使用者");
    return;
  }

  try {
    const res = await fetch(BASE_URL + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegramId: user.id,
        username: user.username,
        ...data
      })
    });

    return await res.json();
  } catch (err) {
    console.error(err);
    alert("API錯誤");
  }
}
