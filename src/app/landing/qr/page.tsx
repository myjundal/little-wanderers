'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseClient';
import QRCode from 'qrcode';

type Person = { id: string; first_name: string; role: 'adult'|'child' };

export default function QRPage() {
  const supabase = supabaseBrowser;
  const [people, setPeople] = useState<Person[]>([]);
  const [qrMap, setQrMap] = useState<Record<string, string>>({}); // personId -> dataURL

  useEffect(() => {
    const load = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return;

      const { data: hs } = await supabase
        .from('households')
        .select('id')
        .eq('owner_user_id', uid)
        .maybeSingle();

      if (!hs) return;

      const { data: ppl } = await supabase
        .from('people')
        .select('id, first_name, role')
        .eq('household_id', hs.id)
        .order('created_at', { ascending: true });

      const arr = (ppl ?? []) as Person[];
      setPeople(arr);

      // QR 생성
      const map: Record<string, string> = {};
      for (const p of arr) {
        const payload = `lw://person/${p.id}`;
        map[p.id] = await QRCode.toDataURL(payload, { width: 224, margin: 1 });
      }
      setQrMap(map);
    };
    load();
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>My QR Codes</h1>
      <p>Please scan everyone's QR codes upon entrance, including child and adult.</p>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', marginTop: 16 
}}>
        {people.map(p => (
          <div key={p.id} style={{ border: '1px solid #ddd', padding: 12, textAlign: 'center' }}>
            <h3 style={{ margin: '8px 0' }}>{p.first_name} ({p.role})</h3>
            {qrMap[p.id] ? <img src={qrMap[p.id]} alt="qr" /> : <div>Creating…</div>}
            <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>lw://person/{p.id}</p>
          </div>
        ))}
      </div>
    </main>
  );
}

