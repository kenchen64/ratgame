const tg = window.Telegram.WebApp;
tg.expand();

const BASE = window.location.origin;

export async function api(path, data = {}) {
  const user = tg.initDataUnsafe?.user;

  if (!user) {
    alert("❌ 無法取得 Telegram 使用者");
    return;
  }

  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      telegramId:user.id,
      username:user.username,
      ...data
    })
  });

  return res.json();
}
