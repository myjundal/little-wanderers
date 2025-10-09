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

type PricingRule = {
  id: string;
  role: 'adult' | 'child' | null;
  price_cents: number;
};

type Checkin = {
  id: string;
  person: {
    name: string;
    role: string; // 'guardian' | 'child'
  };
};

export default function CheckoutPage() {
  const params = useSearchParams();
  const visitId = params.get('id');

  const [visit, setVisit] = useState<Visit | null>(null);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [visitorName, setVisitorName] = useState<string | null>(null);
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [totalCents, setTotalCents] = useState<number | null>(null);

  // Load visit
  useEffect(() => {
    if (!visitId) return;

    supabaseBrowser()
      .from('visits')
      .select('id,adult_count,child_count,created_at')
      .eq('id', visitId)
      .single()
      .then(({ data }) => {
        if (data) setVisit(data);
      });
  }, [visitId]);

  // Load checkins + guardian name
  useEffect(() => {
    if (!visitId) return;

    supabaseBrowser()
      .from('checkins')
      .select('id,person:people(name, role)')
      .eq('visit_id', visitId)
      .then(({ data }) => {
      const checkins = (data ?? []).map((c: any) => ({
    id: c.id,
    person: c.person[0], // 첫 번째 요소만 꺼냄
  })) as Checkin[];

        setCheckins(checkins);

        const guardian = checkins.find(c => c.person.role  === 'guardian');
	setVisitorName(guardian?.person.name ?? 'Unknown');
	});
}, [visitId]);

  // Load pricing rules
  useEffect(() => {
    supabaseBrowser()
      .from('pricing_rules')
      .select('id,role,price_cents')
      .then(({ data }) => setRules((data ?? []) as PricingRule[]));
  }, []);

  // Calculate total
  useEffect(() => {
    if (!visit || rules.length === 0) return;

    const adultRule = rules.find(r => r.role === 'adult');
    const childRule = rules.find(r => r.role === 'child');

    const adultTotal = (adultRule?.price_cents ?? 0) * visit.adult_count;
    const childTotal = (childRule?.price_cents ?? 0) * visit.child_count;

    setTotalCents(adultTotal + childTotal);
  }, [visit, rules]);

 // Handle payment button click
  const handlePayClick = async () => {
    if (!visit || totalCents === null) {
      alert('Visit info or total amount missing.');
      return;
    }

    try {
      const response = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: totalCents, visitId: visit.id }),
      });

      if (!response.ok) throw new Error('Failed to create checkout session');

      const data = await response.json();
      window.location.href = data.checkoutUrl;
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Payment initiation failed.');
    }
  };

  if (!visitId) return <p>Missing visit ID.</p>;
  if (!visit) return <p>Loading visit info...</p>;

  return (
    <main style={{ padding: 24 }}>
      <h1>Checkout</h1>
      <p>Visitor: {visitorName}</p>
      <p>Visit ID: {visit.id}</p>
      <p>Adults: {visit.adult_count}</p>
      <p>Children: {visit.child_count}</p>

      <hr style={{ margin: '16px 0' }} />

      {totalCents !== null && (
        <>
          <p>Total: <strong>${(totalCents / 100).toFixed(2)}</strong></p>
          <button onClick={() => alert('Square Checkout coming soon')}>
            Pay with Card
          </button>
        </>
      )}
    </main>
  );
}

