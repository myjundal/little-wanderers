'use client';
import {useState} from 'react';
export default function MembershipControls({status}:{status:string|null}){
 const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 async function change(action:string){if(action==='cancel'&&!window.confirm('Stop future renewals? Access already paid for remains available through its end date.'))return;setBusy(true);try{const r=await fetch(`/api/membership/${action}`,{method:'POST'});const j=await r.json();if(!r.ok)throw new Error(j.error);setMessage('Square updated your subscription. Refresh to see the latest status.');}catch(e){setMessage(e instanceof Error?e.message:'Unable to update subscription');}finally{setBusy(false);}}
 return <section style={{display:'grid',gap:10,marginTop:20}}><p>Square subscription: {status??'Pending verification'}. Pause and cancellation stop future renewals at the billing boundary; access already paid for remains available.</p><div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button disabled={busy} onClick={()=>change('pause')}>Pause renewals</button><button disabled={busy} onClick={()=>change('resume')}>Resume / undo pause</button><button disabled={busy} onClick={()=>change('cancel')}>Cancel renewals</button></div>{message&&<p role="status">{message}</p>}</section>;
}
