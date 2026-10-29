export const dynamic = 'force-dynamic';
export const revalidate = 0;

import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import MembershipControls from '@/components/membership/MembershipControls';
import StartSubscriptionButton from '@/components/membership/StartSubscriptionButton';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { logger } from '@/lib/logger';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { paymentFlowEnabled,squareConfig } from '@/lib/square-client';
import { reconcileCheckout,type CheckoutAttempt } from '@/lib/square-checkout';

export const metadata = { title: 'Membership — Little Wanderers' };

type Membership = {
  id: string;
  square_status:string|null; square_subscription_id:string|null;
  renews_at: string | null;
  household_id: string | null;
};

export default async function MembershipPage({ searchParams }: { searchParams?: Promise<{ checkout_id?: string }> }) {
  let checkoutMessage: string | null = null;
  const supabase = await createServerSupabaseClient();

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
          {checkoutMessage && <p role="status">{checkoutMessage}</p>}
          <p>Please <Link href="/login">log in</Link>.</p>
        </main>
      );
    }

    const householdId = await getLatestHouseholdIdForUser(supabase, user.id);
    if (!householdId) {
      logger.warn({ action: 'membership.household_missing', userId: user.id });
      return renderError();
    }

    const checkoutId = (await searchParams)?.checkout_id;
    if (checkoutId && paymentFlowEnabled('membership')) {
      try {
        const admin = createAdminSupabaseClient();
        const { data: attempt,error } = await admin.from('square_checkout_attempts').select('*').eq('id',checkoutId)
          .eq('household_id',householdId).eq('kind','membership').eq('environment',squareConfig().environment).maybeSingle();
        if (error) throw new Error(error.message);
        if (attempt) {
          const result = await reconcileCheckout(admin,attempt as CheckoutAttempt);
          checkoutMessage = result.status === 'completed' ? 'Your subscription is linked. Access is based on verified invoice payments.' : 'Your payment is still being verified.';
        }
      } catch {
        checkoutMessage = 'We are still verifying your subscription with Square. Please refresh shortly or contact us.';
      }
    }

    const { data: membershipRow, error: membershipError } = await supabase
      .from('memberships')
      .select('id,renews_at,household_id,square_status,square_subscription_id')
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
        <main style={{ padding: '16px clamp(12px, 4vw, 24px)', maxWidth: 640, margin: '0 auto', boxSizing: 'border-box' }}>
          <h1>Membership</h1>
          {checkoutMessage && <p role="status">{checkoutMessage}</p>}
          <section style={{ marginTop: 16, overflow: 'visible' }}>
            <p style={{ margin: 0 }}>You don&apos;t have an active membership right now.</p>
            <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
              <StartSubscriptionButton plan="monthly" enabled={paymentFlowEnabled('membership')} />
            </div>
          </section>
          <section style={{ marginTop: 24 }}>
            <Link href="/landing" style={{ display: 'inline-flex', border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 14px', color: '#5f3da4', textDecoration: 'none', fontWeight: 700 }}>
              ← Back to my dashboard
            </Link>
          </section>
        </main>
      );
    }

    const nowISO = new Date().toISOString();
    const isActive = !membershipRow.renews_at || membershipRow.renews_at > nowISO;

    return (
      <main style={{ padding: '16px clamp(12px, 4vw, 24px)', maxWidth: 640, margin: '0 auto', boxSizing: 'border-box' }}>
        <h1>Membership</h1>
          {checkoutMessage && <p role="status">{checkoutMessage}</p>}

        <div style={{ marginTop: 8 }}>
          <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, border: '1px solid #ddd' }}>
            {(isActive ? 'ACTIVE' : 'NONE')}
          </span>{' '}

          {!isActive && !membershipRow.square_subscription_id && (
            <section style={{ marginTop: 16, overflow: 'visible' }}>
              <p style={{ margin: 0 }}>You don&apos;t have an active membership right now.</p>
              <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
                <StartSubscriptionButton plan="monthly" enabled={paymentFlowEnabled('membership')} />
              </div>
            </section>
          )}

          {isActive && <span>Paid access through {formatDate(membershipRow.renews_at)}</span>}
          {!isActive && membershipRow.renews_at && <span>Ends on {formatDate(membershipRow.renews_at)}</span>}
        </div>

        {membershipRow.square_subscription_id && <MembershipControls status={membershipRow.square_status} />}
        <section style={{ marginTop: 24 }}>
          <Link href="/landing" style={{ display: 'inline-flex', border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 14px', color: '#5f3da4', textDecoration: 'none', fontWeight: 700 }}>
            ← Back to my dashboard
          </Link>
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
      <p><Link href="/landing" style={{ display: 'inline-flex', border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 14px', color: '#5f3da4', textDecoration: 'none', fontWeight: 700 }}>← Back to my dashboard</Link></p>
    </main>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
