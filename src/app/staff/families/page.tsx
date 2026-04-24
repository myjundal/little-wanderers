'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type FamilyItem = {
  household_id: string;
  household_name: string | null;
  guardian_name: string;
  phone: string | null;
  email: string | null;
  children_names: string[];
  membership_status: string;
  waiver_status: string;
};

export default function StaffFamiliesPage() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<FamilyItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      const res = await fetch(`/api/admin/families?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
      const json = await res.json();
      setItems(json.items ?? []);
      setLoading(false);
    };
    void run();
  }, [query]);

  return (
    <main style={{ padding: 24, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Owner tools</p>
          <h1 style={{ margin: '8px 0 4px', color: '#4f3f82' }}>Family Management</h1>
        </div>
        <Link href="/staff#manual-family-registration" style={{ borderRadius: 12, border: '1px solid #d9c8f7', padding: '10px 14px', color: '#5f3da4', textDecoration: 'none', fontWeight: 700 }}>
          + New family
        </Link>
      </div>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by last name, first name, phone, or email"
        style={{ marginTop: 14, width: '100%', border: '1px solid #d9c8f7', borderRadius: 12, padding: '11px 12px' }}
      />

      <section style={{ marginTop: 16, display: 'grid', gap: 12 }}>
        {loading ? <p>Loading families…</p> : items.length === 0 ? <p>No families found.</p> : items.map((item) => (
          <article key={item.household_id} style={{ border: '1px solid #eadfff', borderRadius: 18, padding: 14, background: '#fff' }}>
            <h3 style={{ margin: 0, color: '#4f3f82' }}>{item.guardian_name}</h3>
            <p style={{ margin: '6px 0', color: '#6d6480' }}>Phone: {item.phone ?? '-'} · Email: {item.email ?? '-'}</p>
            <p style={{ margin: '6px 0', color: '#6d6480' }}>Children: {item.children_names.length ? item.children_names.join(', ') : '-'}</p>
            <p style={{ margin: '6px 0', color: '#6d6480' }}>Membership: {item.membership_status} · Waiver: {item.waiver_status}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Link href={`/staff/families/${item.household_id}`} style={{ borderRadius: 10, padding: '8px 10px', border: '1px solid #d9c8f7', textDecoration: 'none' }}>View</Link>
              <Link href={`/staff/families/${item.household_id}`} style={{ borderRadius: 10, padding: '8px 10px', border: '1px solid #d9c8f7', textDecoration: 'none' }}>Check in</Link>
              <Link href={`/staff/families/${item.household_id}`} style={{ borderRadius: 10, padding: '8px 10px', border: '1px solid #d9c8f7', textDecoration: 'none' }}>Register class</Link>
              <Link href={`/staff/families/${item.household_id}`} style={{ borderRadius: 10, padding: '8px 10px', border: '1px solid #d9c8f7', textDecoration: 'none' }}>Book party</Link>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
