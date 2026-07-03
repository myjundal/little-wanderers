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

        const price = ((data.price_cents ?? 0) / 100).toFixed(2);
        if (data.membership_applied || (data.price_cents ?? 0) === 0) {
          setServerMsg(`Check-in OK ✅ (No payment required)`);
        } else {
          setServerMsg(`Check-in OK ✅ • Price: $${price}`);
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
    (v) => !v.membership_applied && v.price_cents > 0
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
          <Link href="/staff" style={navLinkStyle}>Owner/Staff Tool</Link>
        </div>
      </div>
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
