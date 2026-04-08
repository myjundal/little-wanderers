export const dynamic = 'force-dynamic';
export const revalidate = 0;

import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import StartSubscriptionButton from '@/components/membership/StartSubscriptionButton';
import { getLatestHouseholdIdForUser } from '@/lib/households';

export const metadata = { title: 'Membership — Little Wanderers' };

type Membership = {
  id: string;
  renews_at: string | null;
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

    const { data: membershipRow, error: membershipError } = await supabase
      .from('memberships')
      .select('id,renews_at,household_id')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<Membership>();

    if (membershipError) {
      console.error('[membership] memberships query error', membershipError);
      return renderError('memberships by household_id failed', membershipError.message, {
        authUserId: user.id,
        householdId,
      });
    }

    // No membership row is a normal empty state.
    if (!membershipRow) {
      return (
        <main style={{ padding: 24, maxWidth: 640 }}>
          <h1>Membership</h1>
          <p style={{ color: '#6d6480', fontSize: 12 }}>
            Debug: authUserId={user.id} householdId={householdId} membershipRow=none
          </p>
          <section style={{ marginTop: 16 }}>
            <p>You don't have an active membership right now.</p>
            <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
              <StartSubscriptionButton plan="monthly" />
            </div>
          </section>
          <section style={{ marginTop: 24 }}>
            <Link href="/landing">Back to App Home</Link>
          </section>
        </main>
      );
    }

    const nowISO = new Date().toISOString();
    const isActive = !membershipRow.renews_at || membershipRow.renews_at > nowISO;

    return (
      <main style={{ padding: 24, maxWidth: 640 }}>
        <h1>Membership</h1>

        <p style={{ color: '#6d6480', fontSize: 12 }}>
          Debug: authUserId={user.id} householdId={householdId} membershipRow={membershipRow.id}
        </p>

        <div style={{ marginTop: 8 }}>
          <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, border: '1px solid #ddd' }}>
            {(isActive ? 'ACTIVE' : 'NONE')}
          </span>{' '}

          {!isActive && (
            <section style={{ marginTop: 16 }}>
              <p>You don't have an active membership right now.</p>
              <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
                <StartSubscriptionButton plan="monthly" />
              </div>
            </section>
          )}

          {isActive && <span>Renews on {formatDate(membershipRow.renews_at)}</span>}
          {!isActive && membershipRow.renews_at && <span>Ends on {formatDate(membershipRow.renews_at)}</span>}
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
