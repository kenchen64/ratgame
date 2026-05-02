import { useEffect, useState } from "react";
import { api } from "./api";

export default function App(){
  const [u,setU] = useState(null);
  const [effect,setEffect] = useState("");

  async function load(){
    setU(await api('/me'));
  }

  async function click(){
    const r = await api('/click');
    setEffect("💥");
    setTimeout(()=>setEffect(""),300);
    load();
  }

  async function steal(){
    const r = await api('/steal');
    alert(r.msg);
    setEffect("⚔️");
    load();
  }

  async function shield(){
    const r = await api('/shield');
    alert(r.msg);
    load();
  }

  useEffect(()=>{load();},[]);

  if(!u) return <div>Loading...</div>;

  return (
    <div className="game">

      <div className="hud">
        👤 {u.username} | ⭐ Lv.{u.level} | 🧀 {u.balance}
      </div>

      {/* 血條 */}
      <div className="hp-bar">
        <div style={{width:`${(u.hp/u.maxHp)*100}%`}}></div>
      </div>

      {/* 經驗條 */}
      <div className="exp-bar">
        <div style={{width:`${(u.exp/(u.level*20))*100}%`}}></div>
      </div>

      <div className="click-area" onClick={click}>
        🐭
        <div className="effect">{effect}</div>
      </div>

      <div className="actions">
        <button onClick={steal}>⚔️ 攻擊</button>
        <button onClick={shield}>🛡️ 護盾</button>
        <button onClick={load}>🔄</button>
      </div>

    </div>
  );
}
