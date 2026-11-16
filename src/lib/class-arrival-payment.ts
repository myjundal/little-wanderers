import type { SupabaseClient } from '@supabase/supabase-js';
import { quoteClassSelection, type classCheckoutRequest } from '@/lib/class-checkout';

import { CLASS_PAY_AT_COUNTER_NOTE } from '@/lib/class-config';
export const CLASS_PAY_ON_ARRIVAL_NOTE = CLASS_PAY_AT_COUNTER_NOTE;

export async function saveClassArrivalPayment(admin: SupabaseClient, input: {
  householdId: string; userId: string; request: ReturnType<typeof classCheckoutRequest>;
}) {
  await quoteClassSelection(admin, input);
  const ids: string[] = [];
  for (const item of input.request.items) {
    const existing = await admin.from('class_registrations').select('id,status,customer_note').eq('household_id', input.householdId)
      .eq('person_id', input.request.person_id).eq('class_id', item.class_id).maybeSingle();
    if (existing.error) throw new Error('Unable to check your registration. Please refresh.');
    if (existing.data && ['scheduled', 'attended'].includes(existing.data.status)) { ids.push(existing.data.id); continue; }
    if (existing.data && !['preregistered', 'cancelled'].includes(existing.data.status)) throw new Error('Please contact us about your existing waitlist registration.');
    const note = existing.data?.customer_note?.includes(CLASS_PAY_ON_ARRIVAL_NOTE) ? existing.data.customer_note
      : [existing.data?.customer_note, CLASS_PAY_ON_ARRIVAL_NOTE].filter(Boolean).join('\n').slice(-2000);
    const result = existing.data
      ? await admin.from('class_registrations').update({ status: 'preregistered', customer_note: note, customer_note_updated_at: new Date().toISOString() })
        .eq('id', existing.data.id).eq('status', existing.data.status).select('id').maybeSingle()
      : await admin.from('class_registrations').insert({ class_id: item.class_id, person_id: input.request.person_id, child_id: input.request.person_id,
        household_id: input.householdId, status: 'preregistered', created_by_user_id: input.userId, created_by_role: 'customer', customer_note: note,
        customer_note_updated_at: new Date().toISOString() }).select('id').single();
    if (result.error || !result.data) throw new Error('Your registration changed. Please refresh to check your payment choice.');
    ids.push(result.data.id);
  }
  return { registration_ids: ids, payment_choice: 'arrival', seat_confirmed: false,
    message: 'Pay at counter selected. Please arrive early and pay before class. Places are subject to availability; this does not reserve a seat.' };
}
