import { useEffect, useState } from "react";
import { api } from "./api";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const data = await api("/me");
    setUser(data);
  }

  async function clickCoin() {
    setLoading(true);
    await api("/click");
    await load();
    setLoading(false);
  }

  async function steal() {
    setLoading(true);
    const res = await api("/steal");
    alert(res.msg);
    await load();
    setLoading(false);
  }

  async function shield() {
    setLoading(true);
    const res = await api("/shield");
    alert(res.msg);
    await load();
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  if (!user) return <div className="loading">Loading...</div>;

  return (
    <div className="container">

      {/* HUD */}
      <div className="hud">
        <div>👤 {user.username}</div>
        <div>🧀 {user.balance}</div>
      </div>

      {/* 主按鈕 */}
      <button className="main-btn" onClick={clickCoin}>
        {loading ? "..." : "🖱 點擊賺起司"}
      </button>

      {/* 功能列 */}
      <div className="actions">
        <button onClick={steal}>⚔️ 偷</button>
        <button onClick={shield}>🛡️ 護盾</button>
        <button onClick={load}>🔄 更新</button>
      </div>

    </div>
  );
}