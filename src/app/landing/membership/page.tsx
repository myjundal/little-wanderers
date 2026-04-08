export const dynamic = 'force-dynamic';
export const revalidate = 0;

import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import StartSubscriptionButton from '@/components/membership/StartSubscriptionButton';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { logger } from '@/lib/logger';

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
      logger.error({ action: 'auth.membership_get_user_failed' }, userError);
      return renderError();
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
      logger.warn({ action: 'membership.household_missing', userId: user.id });
      return renderError();
    }

    const { data: membershipRow, error: membershipError } = await supabase
      .from('memberships')
      .select('id,renews_at,household_id')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<Membership>();

    if (membershipError) {
      logger.error({ action: 'membership.lookup_failed', userId: user.id, householdId }, membershipError);
      return renderError();
    }

    if (!membershipRow) {
      logger.info({ action: 'membership.lookup_empty', userId: user.id, householdId });
      return (
        <main style={{ padding: 24, maxWidth: 640 }}>
          <h1>Membership</h1>
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
    logger.error({ action: 'membership.unexpected_error' }, error);
    return renderError();
  }
}

function renderError() {
  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>Membership Error</h1>
      <p>Unable to load membership</p>
      <p><Link href="/landing">Back to App Home</Link></p>
    </main>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
