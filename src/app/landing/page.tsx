'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

type RecentItem = {
  id: string;
  when: string; // ISO
  name: string;
  role: 'adult' | 'child' | null;
  covered: boolean;
  price_cents: number;
};

type MembershipStatus = 'active' | 'paused' | 'canceled' | 'none';

function dollars(cents: number) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function Badge({ status }: { status: MembershipStatus }) {
  const styleMap: Record<MembershipStatus, any> = {
    active:   { background: '#e6ffed', border: '1px solid #abf5c0', color: '#137333', padding: '2px 8px', borderRadius: 6, fontSize: 12 },
    paused:   { background: '#fffbe6', border: '1px solid #ffe58f', color: '#614700', padding: '2px 8px', borderRadius: 6, fontSize: 12 },
    canceled: { background: '#ffeaea', border: '1px solid #ffb3b3', color: '#7a1212', padding: '2px 8px', borderRadius: 6, fontSize: 12 },
    none:     { background: '#f0f0f0', border: '1px solid #ddd',    color: '#444',    padding: '2px 8px', borderRadius: 6, fontSize: 12 },
  };
  return <span style={styleMap[status] as any}>{status.toUpperCase()}</span>;
}

export default function AppHome() {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

 // user first name
  const [firstName, setFirstName] = useState<string | null>(null);

  // household
  const [householdId, setHouseholdId] = useState<string | null>(null);

  // widgets
  const [membership, setMembership] = useState<{ status: MembershipStatus; renews_at: string | null }>({ status: 'none', renews_at: null });
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  useEffect(() => {
    const run = async () => {
      const supabase = createBrowserSupabaseClient();

      // session
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      setEmail(user?.email ?? null);
      if (!user) { setReady(true); return; }

	// 2) Ensure household (by owner_user_id)
    const { data: found, error: findErr } = await supabase
      .from('households')
      .select('id')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (findErr) console.warn('households find error:', findErr);

    let householdId: string | null = null;

    if (!found || found.length === 0) {
      const { data: up, error: upErr } = await supabase
        .from('households')
        .upsert(
          {
            owner_user_id: user.id,
            name: (user.email ?? 'My Household').split('@')[0],
          },
          { onConflict: 'owner_user_id' }
        )
        .select('id')
        .maybeSingle();

      if (upErr) console.warn('households upsert error:', upErr);
      householdId = up?.id ?? null;
      setHouseholdId(householdId);
    } else {
      householdId = found[0].id;
      setHouseholdId(householdId);
    }


	 // 3) Fetch adult's first_name in that household → use as greeting
    if (householdId) {
      const { data: person, error: personErr } = await supabase
        .from('people')
        .select('first_name, role')
        .eq('household_id', householdId)
        .eq('role', 'adult')
        .limit(1)
        .single();

      if (personErr) {
        // 두 명 이상 있거나 없을 때 single 에러가 날 수 있음 → 로그만 남기고 fallback 사용
        console.warn('people fetch error:', personErr);
      }

      const displayName =
        person?.first_name ||
        user.email?.split('@')[0] ||
        'there';

      setEmail(displayName);
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

      const { data: mH } = await supabase
        .from('memberships')
        .select('id,status,renews_at')
        .eq('household_id', householdId);

      const all = (mH ?? []) as { id: string; status: 'active' | 'paused' | 'canceled'; renews_at: string | null }[];
      const active = all.filter(m => m.status === 'active' && (!m.renews_at || m.renews_at > nowISO));
      const paused = all.filter(m => m.status === 'paused');
      const canceled = all.filter(m => m.status === 'canceled');

      let s: MembershipStatus = 'none';
      let r: string | null = null;
      if (active.length) {
        s = 'active';
        const dates = active.map(m => m.renews_at).filter(Boolean) as string[];
        if (dates.length) r = dates.sort()[0];
      } else if (paused.length) {
        s = 'paused';
        r = paused[0].renews_at;
      } else if (canceled.length) {
        s = 'canceled';
        r = canceled[0].renews_at;
      }
      setMembership({ status: s, renews_at: r });
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

      const byId = new Map(
        (ppl ?? []).map((p: any) => [
          p.id,
          { first_name: (p.first_name ?? null) as string | null, role: (p.role ?? null) as 'adult' | 'child' | null }
        ])
      );
      const personIds = (ppl ?? []).map((p: any) => p.id);
      if (personIds.length === 0) { setRecent([]); setLoadingRecent(false); return; }

      // 2) pull checkins by those person_ids (limit 5, newest first)
      let rows: any[] | null = null;

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

      const items: RecentItem[] = (rows ?? []).map((row: any) => {
        const meta = (byId.get(row.person_id) as any) ?? { first_name: 'Guest', role: null };
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

  if (!email) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Please login</h1>
        <p><Link href="/">Back to Homepage</Link></p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 920, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 4 }}>Hello, {email} 👋</h1>

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
    <Link href="/landing/myclasses" style={{ display: 'block' }}>My Classes</Link>
    <Link href="/landing/classschedule" style={{ display: 'block' }}>View Class Schedule</Link>
    <Link href="/landing/party" style={{ display: 'block' }}>My Party Bookings</Link>
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

