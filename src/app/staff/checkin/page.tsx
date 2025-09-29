'use client';
import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

type Result = {
  ok: boolean;
  checkin_id?: string;
  membership_applied?: boolean;
  price_cents?: number;
  first_name?: string | null;
  last_name?: string | null;
  birthday?: string | null;
  error?: string;
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
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    const s = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: 250 }, false);
    scannerRef.current = s;
    s.render(async (decodedText) => {
      setLastScan(decodedText);
      setFirstName(null);
      setLastName(null);
      setBirthday(null);
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

        const price = ((data.price_cents ?? 0) / 100).toFixed(2);
        if (data.membership_applied) {
          setServerMsg(`Check-in OK ✅ (Membership covers it)`);
        } else {
          setServerMsg(`Check-in OK ✅ • Price: $${price}`);
        }
      } catch (e: React.FormEvent<HTMLFormElement>) {
        setServerMsg(`Network error`);
      }
    }, (errorMessage) => {
      // scanner failure callback (ignore noisy logs)
      // console.debug(errorMessage);
    });

    return () => {
      try {
        // @ts-expect-error
        scannerRef.current?.clear();
        // @ts-expect-error
        scannerRef.current?.stop();
      } catch {}
    };
  }, []);

return (
    <main style={{ padding: 24 }}>
      <h1>Staff Check-in</h1>
      <div id="qr-reader" style={{ width: 360, maxWidth: '100%', marginTop: 16 }} />
      <div style={{ marginTop: 16, padding: 12, border: '1px solid #ddd' }}>
        <strong>Last Scan:</strong>
        <div style={{ wordBreak: 'break-all' }}>
          {lastScan || '-'}<br />
          {(firstName && lastName) && (
            <span>Welcome {firstName} {lastName}!</span>
          )}
          {isBirthdayToday(birthday) && (
            <div style={{ color: 'green', marginTop: 4 }}>
              🎉 Happy Birthday! 🎂
            </div>
          )}
        </div>
        <div style={{ marginTop: 8 }}>{serverMsg}</div>
      </div>
    </main>
  );
}
