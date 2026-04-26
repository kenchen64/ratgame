const tg = window.Telegram.WebApp;
const user = tg.initDataUnsafe.user;
app.use(express.static('client'));
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