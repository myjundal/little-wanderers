import type { SupabaseClient } from '@supabase/supabase-js';
import { squareConfig, squareRequest } from '@/lib/square-client';
import { normalizeEmail } from '@/lib/square';

export async function ensureSquareCustomer(admin: SupabaseClient, householdId: string, fallbackEmail?: string | null) {
  const { environment } = squareConfig();
  const { data: existing, error } = await admin.from('square_customers').select('square_customer_id')
    .eq('household_id', householdId).eq('environment', environment).maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) return existing.square_customer_id as string;
  const { data: household, error: householdError } = await admin.from('households').select('name,email').eq('id', householdId).single();
  if (householdError) throw new Error(householdError.message);
  const email = normalizeEmail(household.email) || normalizeEmail(fallbackEmail);
  if (!email) throw new Error('A valid household email is required for the invoice');
  const result = await squareRequest<{ customer: { id: string } }>('/v2/customers', 'POST', {
    idempotency_key: `lw-customer-${environment}-${householdId}`,
    reference_id: householdId,
    email_address: email,
    ...(household.name ? { nickname: household.name } : {}),
  });
  const { error: saveError } = await admin.from('square_customers').insert({
    household_id: householdId, environment, square_customer_id: result.customer.id,
  });
  if (saveError && saveError.code !== '23505') throw new Error(saveError.message);
  // Concurrent retries must converge on the persisted mapping, not an email guess.
  const { data: saved, error: readError } = await admin.from('square_customers').select('square_customer_id')
    .eq('household_id', householdId).eq('environment', environment).single();
  if (readError) throw new Error(readError.message);
  return saved.square_customer_id as string;
}
