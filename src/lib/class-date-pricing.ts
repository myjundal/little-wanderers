import type { SupabaseClient } from '@supabase/supabase-js';

export const BALLET_SIBLING_DISCOUNT_PERCENT = 20;
export const isBalletClass = (title: string) => /\bballet\b/i.test(title);
export type ClassDatePrice = { id: string; title: string; price_cents: number };
export type ClassDateQuote = { policy: 'ballet-sibling-20-v1'; subtotal_cents: number; discount_cents: number; total_cents: number;
  lines: Array<{ class_id: string; price_cents: number; discount_cents: number; amount_cents: number }> };

export function quoteClassDates(classes: ClassDatePrice[], siblingClassIds: Set<string>): ClassDateQuote {
  const lines = classes.map(row => {
    if (!Number.isSafeInteger(row.price_cents) || row.price_cents <= 0) throw new Error('Class price needs review.');
    const discount = isBalletClass(row.title) && siblingClassIds.has(row.id) ? Math.round(row.price_cents * BALLET_SIBLING_DISCOUNT_PERCENT / 100) : 0;
    return { class_id: row.id, price_cents: row.price_cents, discount_cents: discount, amount_cents: row.price_cents - discount };
  });
  return { policy: 'ballet-sibling-20-v1', subtotal_cents: lines.reduce((sum, row) => sum + row.price_cents, 0),
    discount_cents: lines.reduce((sum, row) => sum + row.discount_cents, 0), total_cents: lines.reduce((sum, row) => sum + row.amount_cents, 0), lines };
}

export async function readClassDateQuote(admin: SupabaseClient, householdId: string, personId: string, classes: ClassDatePrice[]) {
  const ballet = classes.filter(row => isBalletClass(row.title));
  if (!ballet.length) return quoteClassDates(classes, new Set());
  const registrations = await admin.from('class_registrations').select('class_id,person_id').eq('household_id', householdId)
    .in('class_id', ballet.map(row => row.id)).in('status', ['scheduled', 'attended']).neq('person_id', personId);
  if (registrations.error) throw new Error('Unable to verify the ballet sibling discount. Please try again.');
  const personIds = [...new Set((registrations.data ?? []).map(row => row.person_id))];
  if (!personIds.length) return quoteClassDates(classes, new Set());
  const children = await admin.from('people').select('id').eq('household_id', householdId).eq('role', 'child').in('id', personIds);
  if (children.error) throw new Error('Unable to verify the ballet sibling discount. Please try again.');
  const siblings = new Set((children.data ?? []).map(child => child.id));
  return quoteClassDates(classes, new Set((registrations.data ?? []).filter(row => siblings.has(row.person_id)).map(row => row.class_id)));
}
