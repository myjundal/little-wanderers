'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Html5QrcodeScanner } from 'html5-qrcode';


type LineItem = {
  id: string;
  name: string;
  quantity: number;
  price_cents: number;
};

type Result = {
  ok: boolean;
  checkin_id?: string;
  membership_applied?: boolean;
  price_cents?: number;
  first_name?: string | null;
  last_name?: string | null;
  birthday?: string | null;
  error?: string;
  payment_status?:string;
  lineItems?: LineItem[];
};

type Visit = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  birthday: string | null;
  lineItems: LineItem[];
  membership_applied: boolean;
  price_cents: number;
};

const navLinkStyle: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid #d9c8f7',
  padding: '10px 14px',
  color: '#5f3da4',
  textDecoration: 'none',
  fontWeight: 700,
  background: '#fff',
};


function extractPersonId(text: string): string | null {
  // Accept "lw://person/<uuid>" OR just "<uuid>"
  const lw = text.match(/lw:\/\/person\/([0-9a-fA-F-]{36})/);
  if (lw?.[1]) return lw[1];
  const uuid = text.match(/[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[1-5][0-9a-fA-F-]{3}-[89abAB][0-9a-fA-F-]{3}-[0-9a-fA-F-]{12}/);
  return uuid?.[0] ?? null;
}

function isBirthdayToday(birthday: string | null): boolean {
  if (!birthday) return false;
  const today = new Date();
  const b = new Date(birthday);
  return today.getDate() === b.getDate() && today.getMonth() === b.getMonth();
}


export default function StaffCheckinPage() {
  const [lastScan, setLastScan] = useState<string>('');
  const [serverMsg, setServerMsg] = useState<string>('');
  const [visits, setVisits] = useState<Visit[]>([]);
  const [unpaid,setUnpaid]=useState<Array<{id:string;person_id:string;price_cents:number;name:string}>>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [posBusy,setPosBusy]=useState(false);
  async function loadUnpaid(){const r=await fetch('/api/admin/admission/pos');const j=await r.json();if(r.ok)setUnpaid(j.unpaid??[]);}
  useEffect(()=>{void loadUnpaid();const raw=new URLSearchParams(window.location.search).get('data');if(!raw)return;
    let callback;try{callback=JSON.parse(raw);}catch{return;}
    window.history.replaceState({},'',window.location.pathname);
    if(callback.status!=='ok'||!callback.transaction_id||!callback.state){setServerMsg('Square did not return a verified card receipt. Check Square before starting another payment.');return;}
    setPosBusy(true);fetch('/api/admin/admission/pos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'verify',state:callback.state,transaction_id:callback.transaction_id})})
      .then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);setServerMsg('Square card payment verified. These check-ins are paid.');setSelected([]);await loadUnpaid();})
      .catch(e=>setServerMsg(e.message)).finally(()=>setPosBusy(false));
  },[]);
  async function takeCard(){setPosBusy(true);try{const r=await fetch('/api/admin/admission/pos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({checkin_ids:selected})});const j=await r.json();if(!r.ok)throw new Error(j.error);if(!j.url){setServerMsg('A Square payment is already in progress. Return to Square to finish it; contact the owner if it was cancelled.');return;}window.location.assign(j.url);}catch(e){setServerMsg(e instanceof Error?e.message:'Unable to open Square');}finally{setPosBusy(false);}}


  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const startedRef = useRef(false);

  useEffect(() => {
if (startedRef.current) return;
startedRef.current = true;    

 const el = document.getElementById('qr-reader');
    if (el) el.innerHTML = '';

const s = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: 250 }, false);

    s.render(async (decodedText) => {
      const now = Date.now();
  if (now - lastScanTimeRef.current < 2000)
    return;
 lastScanTimeRef.current = now;

      setLastScan(decodedText);
      setServerMsg('');

      const personId = extractPersonId(decodedText);
      if (!personId) {
        setServerMsg('Invalid QR payload');
        return;
      }
      // Call API
      try {
        setServerMsg('Checking in...');
        const res = await fetch('/api/checkin', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ person_id: personId, source: 'qr' })
        });
        const data: Result = await res.json();
        if (!data.ok) {
          setServerMsg(`Error: ${data.error ?? 'checkin failed'}`);
          return;
        }
        setVisits((prev) => [
          ...prev,
          {
            id: data.checkin_id ?? '',
            first_name: data.first_name ?? null,
            last_name: data.last_name ?? null,
            birthday: data.birthday ?? null,
            lineItems: data.lineItems ?? [],
            membership_applied: data.membership_applied ?? false,
            price_cents: data.price_cents ?? 0,
          },
        ]);

        void loadUnpaid();
        const price = ((data.price_cents ?? 0) / 100).toFixed(2);
        if ((data.price_cents ?? 0) === 0) {
          setServerMsg(data.payment_status==='paid'?'Check-in OK ✅ — prepaid admission verified':'Check-in OK ✅ — no payment required');
        } else {
          setServerMsg(`Check-in recorded • $${price} still due — collect payment before entry`);
        }
      } catch {
        setServerMsg(`Network error`);
      }
    }, () => {
      // scanner failure callback (ignore noisy logs)
    });

    scannerRef.current = s;

    return () => {
	s.clear().catch(() => {});
	startedRef.current = false;
    };
  }, []);

// 결제가 필요한 방문자만 필터링
  const unpaidVisits = visits.filter(
    (v) => v.price_cents > 0
  );


// subtotal 계산
const totalAll = unpaidVisits.reduce((sum, visit) => {
    return sum + (visit.price_cents ?? 0);
  }, 0);

const handleResetAll = () => {
    if (confirm('Clear all scanned data?')) {
      setVisits([]);
      setServerMsg('');
      setLastScan('');
    }
  };


return (
    <main style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Staff Check-in</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/" style={navLinkStyle}>Main Homepage</Link>
          <Link href="/landing" style={navLinkStyle}>Owner/Staff Dashboard</Link>
          <Link href="/staff" style={navLinkStyle}>Operator tools</Link>
        </div>
      </div>
      {unpaid.length>0&&<section style={{marginTop:20,padding:16,border:'2px solid #d9c8f7',borderRadius:16}}><h2>Admission payments due</h2><p>Select one visiting group, then take their card payment in Square on the iPad. Keep the browser open so the receipt can be verified on return. If Square is interrupted, finish or review the existing transaction before taking another payment.</p>{unpaid.map(row=><label key={row.id} style={{display:'block',padding:8}}><input type="checkbox" checked={selected.includes(row.id)} onChange={e=>setSelected(e.target.checked?[...selected,row.id]:selected.filter(id=>id!==row.id))}/> {row.name??visits.find(v=>v.id===row.id)?.first_name??`Check-in ${row.id.slice(0,8)}`} — ${(row.price_cents/100).toFixed(2)}</label>)}<button disabled={posBusy||!selected.length} onClick={takeCard}>Take ${(unpaid.filter(row=>selected.includes(row.id)).reduce((n,row)=>n+row.price_cents,0)/100).toFixed(2)} card payment in Square</button></section>}
      <div id="qr-reader" style={{ width: 360, maxWidth: '100%', marginTop: 16 }} />
      <div style={{ marginTop: 16, padding: 12, border: '1px solid #ddd' }}>
        <strong>Last Scan:</strong>
        <div style={{ wordBreak: 'break-all' }}>{lastScan || '-'}</div>
        <div style={{ marginTop: 8 }}>{serverMsg}</div>
      </div>

	{/* 방문자 리스트 */}
		{visits.map((visit, idx) => {
	return (
	          <div key={visit.id} style={{ marginTop: 24, padding: 12, border: '1px solid #aaa' }}>
	            <h3>#{idx + 1} - {visit.first_name} {visit.last_name}</h3>
	          {isBirthdayToday(visit.birthday) && (
	            <div style={{ color: 'green', marginTop: 4 }}>
	              🎉 Happy Birthday! 🎂
            </div>
          )}
<ul>

	{visit.lineItems.map((item) =>(
                <li key={item.id}>
                  {item.name} x {item.quantity} = ${(item.price_cents * item.quantity / 100).toFixed(2)}
                </li>
              ))}
            </ul>
            <p><strong>Subtotal:</strong> ${(visit.price_cents / 100).toFixed(2)}</p>
	<p><strong>Membership:</strong> {visit.membership_applied ? '✅ Yes' : '❌ No'}</p>
	</div>
	);
})}

{/* 전체 총합 출력 */}
      {unpaidVisits.length > 0 && (
        <div style={{ marginTop: 32, padding: 16, borderTop: '2px solid #555' }}>
          <h2>Total Summary</h2>
          <p><strong>People Requiring Payment:</strong> {unpaidVisits.length}</p>
          <p><strong>Grand Total:</strong> ${(totalAll / 100).toFixed(2)}</p>
	      <p style={{ color: '#555' }}>Collect payment at the counter for unpaid visits.</p>
	    </div>
	  )}

{/* 리셋 버튼은 항상 노출 */}
      {visits.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <button onClick={handleResetAll} style={{ background: '#eee', padding: '8px 12px' 
}}>
            ♻️ Reset All Scanned Data
          </button>
        </div>
      )}

    </main>
  );
}
