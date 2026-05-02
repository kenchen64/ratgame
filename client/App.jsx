import { useEffect, useState } from "react";
import { api } from "./api";

export default function App(){
  const [user,setUser] = useState(null);
  const [effect,setEffect] = useState("");

  async function load(){
    const u = await api('/me');
    setUser(u);
  }

  async function click(){
    console.log("CLICK"); // debug
    const res = await api('/click');
    setEffect("💥");
    setTimeout(()=>setEffect(""),300);
    load();
  }

  async function steal(){
    const res = await api('/steal');
    alert(res.msg);
    setEffect("⚔️");
    load();
  }

  async function shield(){
    const res = await api('/shield');
    alert(res.msg);
    load();
  }

  useEffect(()=>{ load(); },[]);

  if(!user) return <div>Loading...</div>;

  return (
    <div className="game">

      <div className="hud">
        👤 {user.username} | 🧀 {user.balance}
      </div>

      <div className="click-area" onClick={click}>
        🐭
        <div className="effect">{effect}</div>
      </div>

      <div className="actions">
        <button onClick={steal}>⚔️ 偷</button>
        <button onClick={shield}>🛡️ 護盾</button>
        <button onClick={load}>🔄</button>
      </div>

    </div>
  );
}