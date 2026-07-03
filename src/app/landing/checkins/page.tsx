'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { getLatestHouseholdIdForUser } from '@/lib/households';

type HouseholdPersonRow = {
  id: string;
  first_name: string | null;
  role: 'adult' | 'child' | null;
};

type CheckinRow = {
  id: string;
  person_id: string;
  price_cents: number | null;
  membership_applied: boolean | null;
  created_at?: string | null;
  timestamp?: string | null;
};

type CheckinItem = {
  id: string;
  when: string;
  name: string;
  role: 'adult' | 'child' | null;
  covered: boolean;
  price_cents: number;
};

function dollars(cents: number) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

export default function CheckinsPage() {
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<CheckinItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;

      if (!userId) {
        setReady(true);
        return;
      }

      try {
        const householdId = await getLatestHouseholdIdForUser(supabase, userId);
        if (!householdId) {
          setReady(true);
          return;
        }

        const { data: people } = await supabase
          .from('people')
          .select('id, first_name, role')
          .eq('household_id', householdId);

        const peopleRows = (people ?? []) as HouseholdPersonRow[];
        const byId = new Map(peopleRows.map((person) => [person.id, person]));
        const personIds = peopleRows.map((person) => person.id);

        if (personIds.length === 0) {
          setReady(true);
          return;
        }

        const createdAtResult = await supabase
          .from('checkins')
          .select('id, person_id, price_cents, membership_applied, created_at')
          .in('person_id', personIds)
          .order('created_at', { ascending: false })
          .limit(100);

        let rows = (createdAtResult.data ?? []) as CheckinRow[];

        if (createdAtResult.error?.message.includes('created_at')) {
          const timestampResult = await supabase
            .from('checkins')
            .select('id, person_id, price_cents, membership_applied, timestamp')
            .in('person_id', personIds)
            .order('timestamp', { ascending: false })
            .limit(100);

          rows = (timestampResult.data ?? []) as CheckinRow[];
          if (timestampResult.error) throw timestampResult.error;
        } else if (createdAtResult.error) {
          throw createdAtResult.error;
        }

        setItems(rows.map((row) => {
          const person = byId.get(row.person_id);
          const covered = Boolean(row.membership_applied);
          return {
            id: row.id,
            when: row.created_at ?? row.timestamp ?? new Date().toISOString(),
            name: person?.first_name ?? 'Guest',
            role: person?.role ?? null,
            covered,
            price_cents: covered ? 0 : Number(row.price_cents ?? 0),
          };
        }));
      } catch {
        setError('We could not load your check-in history right now.');
      } finally {
        setReady(true);
      }
    };

    void load();
  }, []);

  if (!ready) {
    return <main style={{ padding: 24 }}>Loading...</main>;
  }

  return (
    <main style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Little Wanderers</p>
          <h1 style={{ margin: '8px 0 0', color: '#4f3f82' }}>Check-in history</h1>
        </div>
        <Link href="/landing" style={{ display: 'inline-flex', border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 14px', color: '#5f3da4', textDecoration: 'none', fontWeight: 700 }}>
          Back to dashboard
        </Link>
      </div>

      <section style={{ marginTop: 18, padding: 16, border: '1px solid #e8dfef', borderRadius: 20, background: '#fffdf9', overflowX: 'auto' }}>
        {error ? (
          <p style={{ color: '#9a3412' }}>{error}</p>
        ) : items.length === 0 ? (
          <p style={{ color: '#666' }}>No check-ins yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 4px' }}>When</th>
                <th style={{ textAlign: 'left', padding: '8px 4px' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '8px 4px' }}>Role</th>
                <th style={{ textAlign: 'right', padding: '8px 4px' }}>Price</th>
                <th style={{ textAlign: 'center', padding: '8px 4px' }}>Covered</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '8px 4px' }}>{new Date(item.when).toLocaleString()}</td>
                  <td style={{ padding: '8px 4px' }}>{item.name}</td>
                  <td style={{ padding: '8px 4px', textTransform: 'capitalize' }}>{item.role ?? '-'}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'right' }}>{dollars(item.price_cents)}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center' }}>{item.covered ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
