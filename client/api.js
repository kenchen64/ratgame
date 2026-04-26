const tg = window.Telegram.WebApp;
const user = tg.initDataUnsafe.user;

export async function api(path, data = {}) {
  const res = await fetch(path, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      telegramId: user.id,
      ...data
    })
  });

  return res.json();
}
