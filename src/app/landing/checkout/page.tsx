'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseClient';

type Visit = {
  id: string;
  adult_count: number;
  child_count: number;
  created_at: string;
};

export default function CheckoutPage() {
  const params = useSearchParams();
  const visitId = params.get('id');

  const [visit, setVisit] = useState<Visit | null>(null);

  useEffect(() => {
    if (!visitId) return;
    supabaseBrowser()
      .from('visits')
      .select('id,adult_count,child_count,created_at')
      .eq('id', visitId)
      .single()
      .then(({ data }) => setVisit(data));
  }, [visitId]);

  if (!visitId) return <p>Missing visit ID.</p>;
  if (!visit) return <p>Loading visit info...</p>;

  return (
    <main style={{ padding: 24 }}>
      <h1>Checkout</h1>
      <p>Visit ID: {visit.id}</p>
      <p>Adults: {visit.adult_count}</p>
      <p>Children: {visit.child_count}</p>
      <hr style={{ margin: '16px 0' }} />
      <button disabled>Calculate & Checkout</button>
    </main>
  );
}

