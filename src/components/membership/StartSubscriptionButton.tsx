'use client';
import {useEffect,useState} from 'react';
export default function StartSubscriptionButton({enabled=false}:{plan?:string;enabled?:boolean}){
 const [quote,setQuote]=useState<{current?:{id:string;payment_url:string|null}|null;amount_cents:number;children:Array<{id:string;first_name:string}>}|null>(null);
 const [error,setError]=useState('');const [loading,setLoading]=useState(false);
 useEffect(()=>{let active=true;fetch('/api/checkout/subscribe').then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);if(active)setQuote(j);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false};},[enabled]);
 async function cancel(){if(!quote?.current)return;setLoading(true);try{const r=await fetch('/api/checkout/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'cancel',checkout_id:quote.current.id})});const j=await r.json();if(!r.ok)throw new Error(j.error);window.location.reload();}catch(e){setError(e instanceof Error?e.message:'Unable to cancel checkout');setLoading(false);}}
 async function start(){if(!quote||loading)return;setLoading(true);setError('');try{
  const r=await fetch('/api/checkout/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({quoted_amount_cents:quote.amount_cents})});const j=await r.json();if(!r.ok||!j.url)throw new Error(j.error||'Unable to open checkout');window.location.assign(j.url);
 }catch(e){setError(e instanceof Error?e.message:'Unable to open checkout');setLoading(false);}}
 return <div style={{display:'grid',gap:10}}>
  {quote?.current&&<section><p>Finish your existing membership checkout before starting another.</p>{quote.current.payment_url&&<a href={quote.current.payment_url}>Continue Square checkout</a>} <button disabled={loading} onClick={cancel}>Cancel unpaid checkout</button></section>}
  {quote&&<><p>Includes: {quote.children.map(c=>c.first_name).join(', ')}.</p><p>${(quote.amount_cents/100).toFixed(2)} per month. Renews automatically until paused or cancelled. First child $60; each sibling 6 months or older $20. A baby sibling adds $20 starting with the first renewal on or after turning 6 months. Children added later must be enrolled with staff.</p></>}
  <button onClick={start} disabled={!enabled||!quote||!!quote.current||loading} style={{padding:12,borderRadius:12,background:'#7b6aa8',color:'white',border:0,fontWeight:700}}>{!enabled?'Contact us about membership':loading?'Opening Square…':quote?`Subscribe for $${quote.amount_cents/100}/month`:'Loading membership price…'}</button>
  {error&&<p role="alert">{error}</p>}
 </div>;
}
