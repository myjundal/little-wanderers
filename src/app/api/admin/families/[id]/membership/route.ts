import { requireOwnerContext } from '@/lib/authz';
import { onlinePaymentsUnavailable } from '@/lib/online-payment-access';
import { startSquareCheckout, reconcileCheckout, changeSquareMembership, type CheckoutAttempt } from '@/lib/square-checkout';
import { squareConfig } from '@/lib/square-client';

type Params = { params: Promise<{ id: string }> };
export async function POST(req: Request, { params }: Params) {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const unavailable = onlinePaymentsUnavailable('membership');
  if (unavailable) return unavailable;
  try {
    const householdId = (await params).id;
    const body = await req.json();
    if (body.action === 'create_payment_link') {
      const { data: household, error } = await context.admin.from('households').select('email').eq('id',householdId).single();
      if (error) throw new Error(error.message);
      const result = await startSquareCheckout(context.admin, { householdId, userId: context.user.id, role: context.role,
        kind: 'membership', email: household.email, returnPath: `/staff/families/${householdId}/membership?membership_checkout=success` });
      return Response.json({ ok: true, url: result.url, checkout_id: result.id });
    }
    if (body.action === 'finalize_start') {
      if (!body.checkout_id) return Response.json({ ok: false, error: 'checkout_id is required' }, { status: 400 });
      const { data, error } = await context.admin.from('square_checkout_attempts').select('*').eq('id',body.checkout_id)
        .eq('household_id', householdId).eq('kind','membership').eq('environment',squareConfig().environment).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return Response.json({ ok: false, error: 'Checkout not found' }, { status: 404 });
      const result = await reconcileCheckout(context.admin, data as CheckoutAttempt);
      return Response.json({ ok: true, ...result });
    }
    if (['pause','resume','end'].includes(body.action)) {
      const result = await changeSquareMembership(context.admin, householdId, body.action === 'end' ? 'cancel' : body.action);
      return Response.json({ ok: true, ...result });
    }
    return Response.json({ ok: false, error: 'Unsupported action' }, { status: 400 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to update membership' }, { status: 502 });
  }
}
