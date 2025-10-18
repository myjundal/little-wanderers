'use client';
import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useRouter } from 'next/navigation';


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


function extractPersonId(text: string): string | null {
  // Accept "lw://person/<uuid>" OR just "<uuid>"
  const lw = text.match(/lw:\/\/person\/([0-9a-fA-F-]{36})/);
  if (lw?.[1]) return lw[1];
  const uuid = 
text.match(/[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[1-5][0-9a-fA-F-]{3}-[89abAB][0-9a-fA-F-]{3}-[0-9a-fA-F-]{12}/);
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
  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);
  const [birthday, setBirthday] = useState<string | null>(null);
const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [reference, setReference] = useState<string>('');
  const [visits, setVisits] = useState<Visit[]>([]);
  const [visitId] = useState<string>('');
const [scannerRunning, setScannerRunning] = useState(false);

  const scannerRef = useRef<any>(null);
  const lastScanTimeRef = useRef<number>(0);
  const startedRef = useRef(false);
  const router = useRouter();

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
      setFirstName(null);
      setLastName(null);
      setBirthday(null);
     setLineItems([]);
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
	setFirstName(data.first_name ?? null);
        setLastName(data.last_name ?? null);
        setBirthday(data.birthday ?? null);
setLineItems(data.lineItems ?? []);
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
        if (data.membership_applied) {
          setServerMsg(`Check-in OK ✅ (Membership covers it)`);
        } else {
          setServerMsg(`Check-in OK ✅ • Price: $${price}`);
        }
      } catch (e: unknown) {
        setServerMsg(`Network error`);
      }
    }, (errorMessage) => {
      // scanner failure callback (ignore noisy logs)
      // console.debug(errorMessage);
    });

    scannerRef.current = s;

    return () => {
	s.clear().catch(() => {});
	startedRef.current = false;
    };
  }, []);

console.log('visits:', visits);
visits.forEach((v, i) => {
  console.log(`#${i + 1} - ${v.first_name}`, v.lineItems);
});


// subtotal 계산
const totalAll = visits.reduce((sum, visit) => {
    return sum + visit.lineItems.reduce(
	(s, item) => s + (item.price_cents ?? 0) * (item.quantity ?? 1), 0);
  }, 0);

  // 버튼 핸들러들
  const handleMarkPaid = async () => {
    try {
      const res = await fetch(`/api/visits/${visitId}/mark-paid`, { method: 'POST' });
      if (!res.ok) throw new Error('Mark paid failed');
      alert('Marked as paid (prepaid)');
      setServerMsg('Marked as paid (prepaid)');
    } catch {
      alert('Failed to mark as paid');
    }
  };

  const handleCheckoutAtPOS = async () => {
    try {
      const res = await fetch(`/api/visits/${visitId}/checkout-pos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference }),
      });
      if (!res.ok) throw new Error('Checkout at POS failed');
      alert('Checkout at POS completed');
      setServerMsg('Checkout at POS completed');
    } catch {
      alert('Failed to checkout at POS');
    }
  };

  const handleOpenOnlineCheckout = () => {
    router.push(`/checkout?visit_id=${visitId}`);
  };

const handleResetAll = () => {
    if (confirm('Clear all scanned data?')) {
      setVisits([]);
      setServerMsg('');
      setLastScan('');
      setReference('');
    }
  };


return (
    <main style={{ padding: 24 }}>
      <h1>Staff Check-in</h1>
      <div id="qr-reader" style={{ width: 360, maxWidth: '100%', marginTop: 16 }} />
      <div style={{ marginTop: 16, padding: 12, border: '1px solid #ddd' }}>
        <strong>Last Scan:</strong>
        <div style={{ wordBreak: 'break-all' }}>
          {lastScan || '-'}
</div>
        <div style={{ marginTop: 8 }}>{serverMsg}</div>
      </div>

{/* 방문자 리스트 */} 
	{visits.map((visit, idx) => { 
		const subtotal = visit.lineItems.reduce(
		(sum, item) => sum + item.price_cents * item.quantity, 0);

return (
          <div key={visit.id} style={{ marginTop: 24, padding: 12, border: '1px solid #aaa' }}>
            <h3>#{idx + 1} - {visit.first_name} {visit.last_name}</h3>
          {isBirthdayToday(birthday) && (
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
            <p>
              <strong>Subtotal:</strong> ${(subtotal / 100).toFixed(2)}
            </p>
	</div>
	);
})}

{/* 전체 총합 출력 */}
      {visits.length > 0 && (
        <div style={{ marginTop: 32, padding: 16, borderTop: '2px solid #555' }}>
          <h2>Total Summary</h2>
          <p><strong>People Scanned:</strong> {visits.length}</p>
          <p><strong>Grand Total:</strong> ${(totalAll / 100).toFixed(2)}</p>
              
          <button onClick={handleResetAll} style={{ marginTop: 12 }}>
            Reset All
          </button>
        
      {/* 버튼들 */}
      <div style={{ marginTop: 12 }}>
        <button onClick={handleMarkPaid} style={{ marginRight: 12 }}>
          Mark as Paid (Prepaid)
        </button>

        <div style={{ display: 'inline-block', marginRight: 12 }}>
          <input
            type="text"
            placeholder="Reference from POS"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            style={{ marginRight: 6 }}
          />
          <button onClick={handleCheckoutAtPOS}>Checkout at POS</button>
        </div>

        <button onClick={handleOpenOnlineCheckout}>Open Online Checkout</button>
      </div>
    </div>
  )}

    </main>
  );
}
