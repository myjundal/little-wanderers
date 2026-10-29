import { onlinePaymentsUnavailable } from '@/lib/online-payment-access';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { startSquareCheckout, reconcileCheckout, cancelUnpaidClassCheckout, type CheckoutAttempt } from '@/lib/square-checkout';
import { squareConfig, assertSquarePaymentUrl } from '@/lib/square-client';

export async function POST(req: Request) {
  const unavailable = onlinePaymentsUnavailable('class');
  if (unavailable) return unavailable;
  try {
    const body = await req.json();
    const server = await createServerSupabaseClient();
    const { data: { user } } = await server.auth.getUser();
    if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const admin = createAdminSupabaseClient();
    const householdId = await getLatestHouseholdIdForUser(admin,user.id);
    if (!householdId) return Response.json({ ok: false, error: 'household not found' }, { status: 404 });
    if (body.mode === 'current') {
      const {data,error} = await admin.from('square_checkout_attempts').select('id,payment_url,expected_amount_cents')
        .eq('household_id',householdId).eq('kind','class').eq('environment',squareConfig().environment)
        .in('status',['creating','open']).maybeSingle();
      if (error) throw new Error(error.message);
      return Response.json({ok:true,checkout:data ? {...data,payment_url:data.payment_url ? assertSquarePaymentUrl(data.payment_url) : null} : null});
    }
    if (body.mode === 'finalize' || body.mode === 'cancel') {
      if (!body.checkout_id) return Response.json({ ok: false, error: 'checkout_id is required' }, { status: 400 });
      const { data, error } = await admin.from('square_checkout_attempts').select('*').eq('id',body.checkout_id)
        .eq('household_id',householdId).eq('kind','class').eq('environment',squareConfig().environment).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return Response.json({ ok: false, error: 'Checkout not found' }, { status: 404 });
      return Response.json({ ok: true, ...await (body.mode === 'cancel'
        ? cancelUnpaidClassCheckout(admin,data as CheckoutAttempt) : reconcileCheckout(admin,data as CheckoutAttempt)) });
    }
    if (body.mode && body.mode !== 'create_payment_link') return Response.json({ ok: false, error: 'Invalid action' }, { status: 400 });
    const items = body.items ?? (body.class_ids ?? []).map((class_id: string) => ({ class_id, quantity: 1 }));
    const result = await startSquareCheckout(admin, { householdId, userId:user.id, role:'customer', kind:'class',
      personId:body.person_id,items,email:user.email,returnPath:'/landing/classschedule?checkout=success' });
    return Response.json({ ok:true,checkout_id:result.id,payment_url:result.url,total_price_cents:result.total });
  } catch (error) {
    return Response.json({ ok:false,error:error instanceof Error ? error.message : 'Unable to verify checkout' }, { status: 409 });
  }
}
