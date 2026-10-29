import { paymentFlowEnabled, type PaymentFlow } from '@/lib/square-client';

/** Each flow stays closed until explicitly enabled in its deployment environment. */
export function onlinePaymentsUnavailable(flow: PaymentFlow = 'class'): Response | null {
  if (paymentFlowEnabled(flow)) return null;
  return Response.json({ ok: false, error: 'Online payments are not available yet. Please contact Little Wanderers for payment assistance.' }, { status: 503 });
}
