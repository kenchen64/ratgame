'use client';
import { useEffect, useState } from 'react';

export default function Home(){
  const [data,setData]=useState({});

  useEffect(()=>{
    fetch(process.env.NEXT_PUBLIC_API+'/blackhole')
      .then(r=>r.json())
      .then(setData);
  },[]);

  return (
    <div style={{padding:20}}>
      <h1>🐭 Rat Game DApp</h1>
      <p>🌌 黑洞總量: {data.total}</p>
    </div>
  );
}