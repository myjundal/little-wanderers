'use client';
import Link from 'next/link';
import {useCallback,useEffect,useState} from 'react';
import {getPartyDateKey} from '@/lib/party-config';
type Person={id:string;first_name:string;role:string;birthdate:string|null};
type Data={enabled:boolean;people:Person[];passes:Array<{id:string;person_id:string;visit_date:string;status:string}>;current:{id:string;payment_url:string|null}|null};
export default function AdmissionPage(){
 const [data,setData]=useState<Data|null>(null),[selected,setSelected]=useState<string[]>([]),[date,setDate]=useState(getPartyDateKey(new Date()));
 const [quote,setQuote]=useState<number|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{const r=await fetch('/api/admission');const j=await r.json();if(!r.ok)throw new Error(j.error);setData(j);},[]);
 useEffect(()=>{void load().catch(e=>setMessage(e.message));},[load]);
 useEffect(()=>{setQuote(null);},[date,selected]);
 useEffect(()=>{
  const id=new URLSearchParams(window.location.search).get('checkout_id');if(!id)return;let active=true,count=0;let timer:ReturnType<typeof setTimeout>;
  async function verify(){try{const r=await fetch('/api/admission',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'finalize',checkout_id:id})});const j=await r.json();if(!active)return;if(!r.ok)throw new Error(j.error);if(j.status==='completed'){setMessage('Payment verified. Bring your family QR codes for check-in on your visit date.');await load();}else if(count++<12){setMessage('Verifying your payment with Square…');timer=setTimeout(verify,5000);}else setMessage('Payment is still being verified. Please contact us before paying again.');}catch(e){if(active)setMessage(e instanceof Error?e.message:'Payment verification is pending');}}
  void verify();return()=>{active=false;clearTimeout(timer);};
 },[load]);
 async function checkout(mode:'quote'|'start'|'cancel'){
  setBusy(true);setMessage('');try{const r=await fetch('/api/admission',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode,visit_date:date,person_ids:selected,quoted_amount_cents:quote,checkout_id:data?.current?.id})});const j=await r.json();if(!r.ok)throw new Error(j.error);if(mode==='quote')setQuote(j.amount_cents);else if(mode==='cancel'){setMessage(j.status==='completed'?'Payment was already completed. Your admission has been saved.':'Unpaid checkout cancelled.');await load();}else window.location.assign(j.payment_url);}catch(e){setMessage(e instanceof Error?e.message:'Unable to open admission checkout');}finally{setBusy(false);}}
 return <main style={{maxWidth:720,margin:'0 auto',padding:24}}><h1>Open Play admission</h1><p>$16 for the first child over 6 months, $10 for an infant 0–6 months or each additional sibling. Two accompanying adults included; additional adults $5 each.</p><p>Choose your family and visit date. Payment does not reserve a time or guarantee immediate entry. Check in during regular Open Play hours, subject to capacity. No re-entry. Contact us for changes or refunds.</p>{message&&<p role="status">{message}</p>}
 {!data?<p>Loading your family…</p>:<>{data.current&&<section style={{padding:16,background:'#f5efff'}}><p>You have an unfinished checkout. Please complete it within 30 minutes, or cancel it before starting another. Unpaid checkouts may be cancelled after that.</p>{data.current.payment_url&&<a href={data.current.payment_url}>Continue Square checkout</a>} <button disabled={busy} onClick={()=>checkout('cancel')}>Cancel unpaid checkout</button></section>}
 <label>Visit date <input type="date" value={date} min={getPartyDateKey(new Date())} max={getPartyDateKey(new Date(Date.now()+90*86400000))} onChange={e=>setDate(e.target.value)}/></label><fieldset style={{marginTop:20}}><legend>Family members attending</legend>{data.people.map(p=><label key={p.id} style={{display:'block',padding:8}}><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>setSelected(e.target.checked?[...selected,p.id]:selected.filter(id=>id!==p.id))}/> {p.first_name} ({p.role})</label>)}</fieldset><p><Link href="/landing/people">Add or update family members</Link></p>
 {!data.enabled?<p>Online admission is not available yet. Pay at the counter when you visit.</p>:!data.current&&<><button disabled={busy||!selected.length} onClick={()=>checkout('quote')}>Check admission price</button>{quote!==null&&<p>{quote===0?'No payment is needed. Please check in with staff.':<button disabled={busy} onClick={()=>checkout('start')}>Pay ${(quote/100).toFixed(2)} with Square</button>}</p>}</>}
 {data.passes.length>0&&<section><h2>Your admission</h2>{data.passes.map(p=><p key={p.id}>{p.visit_date} · {data.people.find(person=>person.id===p.person_id)?.first_name??'Family member'} · {p.status==='available'?'Paid — ready for check-in':p.status==='used'?'Checked in':'Contact staff'}</p>)}</section>}</>}
 <p><Link href="/landing/qr">Family QR codes</Link> · <Link href="/landing">Back to dashboard</Link></p></main>;
}
