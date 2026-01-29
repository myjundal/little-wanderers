// ./src/app/landing/membership/page.tsx
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import StartSubscriptionButton from '@/components/membership/StartSubscriptionButton';

export const metadata = { title: 'Membership — Little Wanderers' };

type Membership = {
  id: string;
  status: 'active' | 'paused' | 'canceled';
  renews_at: string | null;
  person_id: string | null;
  household_id: string | null;
};

export default async function MembershipPage() {
  const supabase = createServerSupabaseClient();
  const checkoutUrl = process.env.NEXT_PUBLIC_SQUARE_MEMBERSHIP_CHECKOUT_URL ?? null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Membership</h1>
        <p>Please <Link href="/login">log in</Link>.</p>
      </main>
    );
  }

  const { data: households } = await supabase
    .from('households')
    .select('id')
    .eq('owner_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1);

  const householdId = households?.[0]?.id ?? null;
  if (!householdId) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Membership</h1>
        <p>Could not find your household.</p>
      </main>
    );
  }

  const nowISO = new Date().toISOString();

  const { data: mH } = await supabase
    .from('memberships')
    .select('id,status,renews_at,person_id,household_id')
    .eq('household_id', householdId);

  const { data: people } = await supabase
    .from('people')
    .select('id')
    .eq('household_id', householdId);

  const personIds = (people ?? []).map(p => p.id);
  const { data: mP } = personIds.length
    ? await supabase
        .from('memberships')
        .select('id,status,renews_at,person_id,household_id')
        .in('person_id', personIds)
    : ({ data: [] as Membership[] } as any);

  const all: Membership[] = [
	...((mH ?? []) as Membership[]), 
	...((mP ?? []) as Membership[]),
];

  const active = all.filter(m => m.status === 'active' && (!m.renews_at || m.renews_at > nowISO));
  const paused = all.filter(m => m.status === 'paused');
  const canceled = all.filter(m => m.status === 'canceled');

  let status: 'active' | 'paused' | 'canceled' | 'none' = 'none';
  let renewsAt: string | null = null;

  if (active.length) {
    status = 'active';
    const dates = active.map(m => m.renews_at).filter(Boolean) as string[];
    if (dates.length) renewsAt = dates.sort()[0];
  } else if (paused.length) {
    status = 'paused';
    renewsAt = paused[0].renews_at;
  } else if (canceled.length) {
    status = 'canceled';
    renewsAt = canceled[0].renews_at;
  }

  return (
    <main style={{ padding: 24, maxWidth: 640 }}>
      <h1>Membership</h1>

      <div style={{ marginTop: 8 }}>
        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, border: '1px solid #ddd' 
}}>
          {status.toUpperCase()}
        </span>{' '}

	{status !== 'active' && (
  	<section style={{ marginTop: 16 }}>
    	<p>You don't have an active membership right now.</p>
    	<div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
      	<StartSubscriptionButton plan="monthly" />
    	</div>
  	</section>
	)}
        {status === 'active' && <span>Renews on {formatDate(renewsAt)}</span>}
        {status !== 'active' && renewsAt && <span>Ends on {formatDate(renewsAt)}</span>}
      </div>

      <section style={{ marginTop: 24 }}>
        <Link href="/landing">Back to App Home</Link>
      </section>
    </main>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

