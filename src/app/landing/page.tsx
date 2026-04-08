'use client';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import CrowdLevelCard from '@/components/crowd/CrowdLevelCard';
import { ensureHouseholdForUser, getLatestHouseholdIdForUser } from '@/lib/households';

type RecentItem = {
  id: string;
  when: string; // ISO
  name: string;
  role: 'adult' | 'child' | null;
  covered: boolean;
  price_cents: number;
};

type MembershipStatus = 'active' | 'none';

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

function dollars(cents: number) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function Badge({ status }: { status: MembershipStatus }) {
  const styleMap: Record<MembershipStatus, CSSProperties> = {
    active:   { background: '#e6ffed', border: '1px solid #abf5c0', color: '#137333', padding: '2px 8px', borderRadius: 6, fontSize: 12 },
    none:     { background: '#f0f0f0', border: '1px solid #ddd',    color: '#444',    padding: '2px 8px', borderRadius: 6, fontSize: 12 },
  };
  return <span style={styleMap[status]}>{status === 'none' ? 'No membership' : status.toUpperCase()}</span>;
}

export default function AppHome() {
  const [ready, setReady] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [appRole, setAppRole] = useState<string | null>(null);


  // household
  const [householdId, setHouseholdId] = useState<string | null>(null);

  // widgets
  const [membership, setMembership] = useState<{ status: MembershipStatus; renews_at: string | null }>({ status: 'none', renews_at: null });
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  useEffect(() => {
    const run = async () => {
      const supabase = createBrowserSupabaseClient();

      // session (server-validated user payload from Supabase Auth)
      await supabase.auth.getSession();
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user ?? null;

      setDisplayName(user?.email ?? user?.phone ?? null);
      setIsAuthenticated(Boolean(user));
      if (!user) { setReady(true); return; }

      const { data: roleRow } = await supabase.from('roles').select('role').eq('id', user.id).maybeSingle();
      setAppRole(roleRow?.role ?? null);

      // 2) Resolve household from household_members first (source of truth)
      let householdId: string | null = null;

      try {
        const membershipHouseholdId = await getLatestHouseholdIdForUser(supabase, user.id);
        householdId = membershipHouseholdId;

        if (!householdId) {
          householdId = await ensureHouseholdForUser(supabase, user.id, (user.email ?? user.phone ?? 'My Household').split('@')[0]);
        }

      } catch {
      }

      setHouseholdId(householdId);

      // 3) Fetch adult's first_name in that household → use as greeting
    if (householdId) {
      const { data: person } = await supabase
        .from('people')
        .select('first_name, role')
        .eq('household_id', householdId)
        .eq('role', 'adult')
        .limit(1)
        .single();


      const displayName =
        person?.first_name ||
        user.email?.split('@')[0] ||
        'there';

      setDisplayName(displayName);
    }

      setReady(true);
    };
    run();
  }, []);

  // membership widget
  useEffect(() => {
    if (!householdId) return;
    (async () => {
      const supabase = createBrowserSupabaseClient();
      const nowISO = new Date().toISOString();

      const { data: mH, error: mErr } = await supabase
        .from('memberships')
        .select('id,renews_at')
        .eq('household_id', householdId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (mErr) {
        setMembership({ status: 'none', renews_at: null });
        return;
      }

      const row = (mH ?? [])[0] as { id: string; renews_at: string | null } | undefined;
      if (!row) {
        setMembership({ status: 'none', renews_at: null });
        return;
      }

      const isActive = !row.renews_at || row.renews_at > nowISO;
      setMembership({ status: isActive ? 'active' : 'none', renews_at: row.renews_at });
    })();
  }, [householdId]);

  // recent visits widget (last 5 check-ins for this household)
  useEffect(() => {
    if (!householdId) return;
    (async () => {
      setLoadingRecent(true);
      const supabase = createBrowserSupabaseClient();

      // 1) find people in this household
      const { data: ppl } = await supabase
        .from('people')
        .select('id, first_name, role')
        .eq('household_id', householdId);

      const peopleRows = (ppl ?? []) as HouseholdPersonRow[];
      const byId = new Map(peopleRows.map((p) => [p.id, { first_name: p.first_name, role: p.role }]));
      const personIds = peopleRows.map((p) => p.id);
      if (personIds.length === 0) { setRecent([]); setLoadingRecent(false); return; }

      // 2) pull checkins by those person_ids (limit 5, newest first)
      let rows: CheckinRow[] | null = null;

      // try created_at
      const r1 = await supabase
        .from('checkins')
        .select('id, person_id, price_cents, membership_applied, created_at')
        .in('person_id', personIds as string[])
        .order('created_at', { ascending: false })
        .limit(5);

      if (r1.error && r1.error.message && r1.error.message.includes('created_at')) {
        // fallback to timestamp
        const r2 = await supabase
          .from('checkins')
          .select('id, person_id, price_cents, membership_applied, timestamp')
          .in('person_id', personIds as string[])
          .order('timestamp', { ascending: false })
          .limit(5);
        rows = r2.data ?? [];
      } else {
        rows = r1.data ?? [];
      }

      const items: RecentItem[] = (rows ?? []).map((row) => {
        const meta = byId.get(row.person_id) ?? { first_name: 'Guest', role: null };
        const when = (row.created_at ?? row.timestamp ?? new Date().toISOString()) as string;
        const covered = !!row.membership_applied;
        return {
          id: row.id,
          when,
          name: meta.first_name ?? 'Guest',
          role: meta.role ?? null,
          covered,
          price_cents: covered ? 0 : Number(row.price_cents ?? 0),
        };
      });

      setRecent(items);
      setLoadingRecent(false);
    })();
  }, [householdId]);

  if (!ready) return <main style={{ padding: 24 }}>Loading…</main>;

  if (!isAuthenticated) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Please login</h1>
        <p><Link href="/">Back to Homepage</Link></p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, alignItems: 'stretch', marginBottom: 20 }}>
        <div style={{ padding: 20, borderRadius: 24, border: '1px solid #e3d0fb', background: 'linear-gradient(180deg,#fff,#f7efff)', boxShadow: '0 18px 30px rgba(120,87,177,0.08)', minHeight: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Little Wanderers</p>
          <h1 style={{ margin: '10px 0 6px', color: '#4f3f82' }}>Hello, {displayName ?? 'there'} 👋</h1>
          <p style={{ margin: 0, color: '#6d6480', lineHeight: 1.6 }}>Check your household details, classes, party bookings, and today’s approximate studio flow from one calm landing page.</p>
        </div>

        <CrowdLevelCard compact style={{ maxWidth: '100%', minHeight: '100%', height: '100%' }} />
      </section>

      {/* Membership badge + CTA */}
      <section style={{ marginTop: 8, padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', }}>
	<div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Badge status={membership.status} />
          {membership.status === 'active' && membership.renews_at && (
            <span style={{ color: '#555' }}>Renews on {new Date(membership.renews_at).toLocaleDateString()}</span>
          )} </div>
          {membership.status !== 'active' && (
            <Link href="/landing/membership" 
 		style={{
              display: 'inline-block',
              padding: '8px 16px',
              borderRadius: 16,
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              cursor: 'pointer',
              textAlign: 'center',
              fontWeight: 500,
              transition: 'box-shadow 0.2s ease',
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.08)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)')
            }
          >Start Membership</Link>
          )}
        </div>
      </section>

{/* Quick actions */}
<section style={{ marginTop: 24, marginBottom: 32 }}>
  <h3 style={{ marginBottom: 12, fontSize: 18, fontWeight: 500 }}>Quick Actions</h3>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <Link href="/landing/people" style={{ display: 'block' }}>My People</Link>
    <Link href="/landing/qr" style={{ display: 'block' }}>My QR Codes</Link>
    <Link href="/landing/membership" style={{ display: 'block' }}>My Membership</Link>
    <Link href="/landing/classschedule" style={{ display: 'block' }}>View Class Schedule / My Classes</Link>
    <Link href="/landing/party" style={{ display: 'block' }}>My Party Bookings</Link>
    {(appRole === 'owner' || appRole === 'staff' || appRole === 'admin') && (
      <Link href="/staff" style={{ display: 'block', color: '#5f3da4', fontWeight: 700 }}>Operator Dashboard</Link>
    )}
    {/* 내부 운영/개발용 문서 미리보기 */}
    <Link href="/flows" style={{ display: 'block', color: '#777', fontStyle: 'italic' }}>
      UX Flows (preview)
    </Link>

</div>
</section>

      {/* Recent visits */}
      <section style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3 style={{ margin: 0 }}>Recent visits</h3>
          <Link href="/landing/checkins" style={{ marginLeft: 'auto' }}>View all</Link>
        </div>
        {loadingRecent ? (
          <p style={{ color: '#666' }}>Loading…</p>
        ) : recent.length === 0 ? (
          <p style={{ color: '#666' }}>No recent check-ins.</p>
        ) : (
          <table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>When</th>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Role</th>
                <th style={{ textAlign: 'right', padding: '6px 4px' }}>Price</th>
                <th style={{ textAlign: 'center', padding: '6px 4px' }}>Covered</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '6px 4px' }}>{new Date(r.when).toLocaleString()}</td>
                  <td style={{ padding: '6px 4px' }}>{r.name}</td>
                  <td style={{ padding: '6px 4px', textTransform: 'capitalize' }}>{r.role ?? '-'}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{dollars(r.price_cents)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>{r.covered ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
