'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import StaffToolNav from '@/components/staff/StaffToolNav';
import { useOperatorAccess } from '@/lib/use-owner-dashboard-access';

type FamilyItem = {
  household_id: string;
  household_name: string | null;
  guardian_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  location_needs_review: boolean;
  children_names: string[];
  membership_status: string;
  waiver_status: string;
};

function waiverLabel(status: string) {
  if (status === 'completed') return 'Waiver completed';
  if (status === 'expired') return 'Waiver expired / renewal needed';
  return 'Waiver required';
}

export default function StaffFamiliesPage() {
  const { role } = useOperatorAccess();
  const [counts, setCounts] = useState<{ linked: number; guests: number; children: number } | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<FamilyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [matching, setMatching] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/admin/families?q=${encodeURIComponent(query)}`, { cache: 'no-store', signal: controller.signal });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to load families. Please try again.');
        if (controller.signal.aborted) return;
        setItems(json.items);
        setTotal(json.total);
        setCounts({ linked: json.linked_families, guests: json.guest_families, children: json.families_with_children });
        setMatching(json.matching_families);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setItems([]); setTotal(null); setCounts(null); setMatching(0);
        setError(cause instanceof Error ? cause.message : 'Unable to load families. Please try again.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void run();
    return () => controller.abort();
  }, [query]);

  return (
    <main style={{ padding: 24, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Owner/Staff tools</p>
          <h1 style={{ margin: '8px 0 4px', color: '#4f3f82' }}>Family Management</h1>
          <p>Customer families: {total ?? '—'} · With a login: {counts?.linked ?? '—'} · Guest / manual: {counts?.guests ?? '—'} · With child profiles: {counts?.children ?? '—'}</p>
          <p style={{ color: '#6d6480', fontSize: 13 }}>Confirmed duplicates count as one family. Staff, owner and instructor families are excluded. Having a login does not mean the family profile is complete.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <StaffToolNav active="families" includeMembershipManagement={role === 'owner' || role === 'admin'} />
          <Link href="/staff/families/new" style={{ borderRadius: 12, border: '1px solid #d9c8f7', padding: '10px 14px', color: '#5f3da4', textDecoration: 'none', fontWeight: 700 }}>
            + New family
          </Link>
        </div>
      </div>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by last name, first name, phone, or email"
        style={{ marginTop: 14, width: '100%', border: '1px solid #d9c8f7', borderRadius: 12, padding: '11px 12px' }}
      />

      {!loading && !error && <p>Showing {items.length} of {matching} {query.trim() ? 'matching ' : ''}families.{matching > items.length && ' Search by name, phone or email to find a family.'}</p>}
      <section style={{ marginTop: 16, display: 'grid', gap: 12 }}>
        {error ? <p role="alert">{error}</p> : loading ? <p>Loading families…</p> : items.length === 0 ? <p>No families found.</p> : items.map((item) => (
          <article key={item.household_id} style={{ border: '1px solid #eadfff', borderRadius: 18, padding: 14, background: '#fff' }}>
            <h3 style={{ margin: 0, color: '#4f3f82' }}>{item.guardian_name}</h3>
            <p style={{ margin: '6px 0', color: '#6d6480' }}>Phone: {item.phone ?? '-'} · Email: {item.email ?? '-'}</p>
            <p style={{ margin: '6px 0', color: '#6d6480' }}>
              Location: {item.city || item.state ? `${item.city ?? '-'}, ${item.state ?? '-'}` : '-'}
              {item.location_needs_review && (
                <span style={{ display: 'inline-block', marginLeft: 8, border: '1px solid #f0c36a', borderRadius: 999, padding: '2px 8px', color: '#8a5d00', background: '#fff8df', fontSize: 12, fontWeight: 700 }}>
                  Review town
                </span>
              )}
            </p>
            <p style={{ margin: '6px 0', color: '#6d6480' }}>Children: {item.children_names.length ? item.children_names.join(', ') : '-'}</p>
            <p style={{ margin: '6px 0', color: '#6d6480' }}>Membership: {item.membership_status} · Waiver: {waiverLabel(item.waiver_status)}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Link href={`/staff/checkin?family=${item.household_id}`} style={{ borderRadius: 10, padding: '10px 14px', background: '#65449b', color: '#fff', textDecoration: 'none', fontWeight: 700 }}>Check in &amp; pay</Link>
              <Link href={`/staff/families/${item.household_id}`} style={{ borderRadius: 10, padding: '8px 10px', border: '1px solid #d9c8f7', textDecoration: 'none' }}>View</Link>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
