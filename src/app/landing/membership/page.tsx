export const dynamic = 'force-dynamic';
export const revalidate = 0;

import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import StartSubscriptionButton from '@/components/membership/StartSubscriptionButton';
import { getLatestHouseholdIdForUser } from '@/lib/households';

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

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.error('[membership] auth.getUser error', userError);
      return renderError('auth.getUser failed', userError.message);
    }

    if (!user) {
      return (
        <main style={{ padding: 24 }}>
          <h1>Membership</h1>
          <p>Please <Link href="/login">log in</Link>.</p>
        </main>
      );
    }

    const householdId = await getLatestHouseholdIdForUser(supabase, user.id);
    if (!householdId) {
      return renderError('no household membership', `No household_id found for auth user ${user.id}`);
    }

    const { data: householdRow, error: householdError } = await supabase
      .from('households')
      .select('id,name')
      .eq('id', householdId)
      .maybeSingle();

    if (householdError) {
      console.error('[membership] households query error', householdError);
      return renderError('households query failed', householdError.message, {
        authUserId: user.id,
        membershipHouseholdId: householdId,
      });
    }

    const nowISO = new Date().toISOString();

    const { data: householdMemberships, error: householdMembershipsError } = await supabase
      .from('memberships')
      .select('id,status,renews_at,person_id,household_id')
      .eq('household_id', householdId);

    if (householdMembershipsError) {
      console.error('[membership] memberships by household query error', householdMembershipsError);
      return renderError('memberships by household_id failed', householdMembershipsError.message, {
        authUserId: user.id,
        membershipHouseholdId: householdId,
      });
    }

    const { data: peopleRows, error: peopleError } = await supabase
      .from('people')
      .select('id')
      .eq('household_id', householdId);

    if (peopleError) {
      console.error('[membership] people query error', peopleError);
      return renderError('people by household_id failed', peopleError.message, {
        authUserId: user.id,
        membershipHouseholdId: householdId,
      });
    }

    const personIds = (peopleRows ?? []).map((p) => p.id);
    let personMemberships: Membership[] = [];

    if (personIds.length > 0) {
      const { data: personMembershipRows, error: personMembershipsError } = await supabase
        .from('memberships')
        .select('id,status,renews_at,person_id,household_id')
        .in('person_id', personIds);

      if (personMembershipsError) {
        console.error('[membership] memberships by person query error', personMembershipsError);
        return renderError('memberships by person_id failed', personMembershipsError.message, {
          authUserId: user.id,
          membershipHouseholdId: householdId,
        });
      }

      personMemberships = (personMembershipRows ?? []) as Membership[];
    }

    const all: Membership[] = [
      ...((householdMemberships ?? []) as Membership[]),
      ...personMemberships,
    ];

    const active = all.filter((m) => m.status === 'active' && (!m.renews_at || m.renews_at > nowISO));
    const paused = all.filter((m) => m.status === 'paused');
    const canceled = all.filter((m) => m.status === 'canceled');

    let status: 'active' | 'paused' | 'canceled' | 'none' = 'none';
    let renewsAt: string | null = null;

    if (active.length) {
      status = 'active';
      const dates = active.map((m) => m.renews_at).filter(Boolean) as string[];
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

        <p style={{ color: '#6d6480', fontSize: 12 }}>
          Debug: authUserId={user.id} membershipHouseholdId={householdId} householdRowId={householdRow?.id ?? '-'}
        </p>

        <div style={{ marginTop: 8 }}>
          <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, border: '1px solid #ddd' }}>
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[membership] unexpected error', error);
    return renderError('unexpected error', message);
  }
}

function renderError(kind: string, message: string, context?: Record<string, string | null | undefined>) {
  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>Membership Error</h1>
      <p>Failed to load My Membership.</p>
      <p><strong>Kind:</strong> {kind}</p>
      <p><strong>Message:</strong> {message}</p>
      {context && (
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: 12, borderRadius: 8 }}>
          {JSON.stringify(context, null, 2)}
        </pre>
      )}
      <p><Link href="/landing">Back to App Home</Link></p>
    </main>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
