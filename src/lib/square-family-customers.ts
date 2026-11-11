import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { squareConfig, squareRequest } from '@/lib/square-client';
import { getStaffFamilySearchAliases } from '@/lib/staff-family-search';

type Customer = { id: string; given_name?: string; family_name?: string; email_address?: string; phone_number?: string; reference_id?: string };
const emailKey = (value?: string | null) => (value ?? '').trim().toLowerCase();
const phoneKey = (value?: string | null) => { const digits = (value ?? '').replace(/\D/g, ''); return digits.length === 10 ? `1${digits}` : digits; };
const nameKey = (value?: string | null) => (value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();
const checked = <T>(result: { data: T; error: unknown }) => { if (result.error) throw new Error('Unable to load the Square family connection.'); return result.data as NonNullable<T>; };

async function retrieve(id: string) {
  try { return (await squareRequest<{ customer: Customer }>(`/v2/customers/${encodeURIComponent(id)}`)).customer; }
  catch (error) {
    // Legacy mapping rows have no environment column. A mapping is usable only
    // when the current environment's provider confirms it exists.
    if (/Square request failed \(404[:)]/.test(String(error))) return null;
    throw error;
  }
}

export async function linkedSquareFamilyCustomer(admin: SupabaseClient, householdId: string) {
  const rows = checked(await admin.from('square_customers').select('square_customer_id').eq('household_id', householdId).limit(11));
  if (rows.length > 10) throw new Error('Multiple Square connections need review.');
  const customers: Customer[] = [];
  for (const row of rows) { const customer = await retrieve(row.square_customer_id); if (customer) customers.push(customer); }
  if (customers.length > 1) throw new Error('Multiple Square customer records need review before connecting this family.');
  return customers[0] ?? null;
}

/** Creates directory profiles only: no card, charge, subscription, invoice or message. */
export async function connectSquareFamilyCustomer(admin: SupabaseClient, householdId: string) {
  const config = squareConfig();
  const aliases = await getStaffFamilySearchAliases(admin);
  householdId = aliases.get(householdId) ?? householdId;
  const linked = await linkedSquareFamilyCustomer(admin, householdId);
  if (linked) return { customer: linked, created: false };
  const [familyResult, peopleResult, foundingResult, classResult] = await Promise.all([
    admin.from('households').select('id,name,email,phone').eq('id', householdId).single(),
    admin.from('people').select('first_name,last_name').eq('household_id', householdId).eq('role', 'adult').order('created_at').limit(2),
    admin.from('founding_memberships').select('square_customer_id').eq('household_id', householdId).eq('environment', config.environment).not('square_customer_id', 'is', null).order('created_at').limit(10),
    admin.from('class_series_sales').select('square_customer_id').eq('household_id', householdId).eq('environment', config.environment).not('square_customer_id', 'is', null).order('created_at').limit(10),
  ]);
  const family = checked(familyResult), people = checked(peopleResult), founding = checked(foundingResult), classes = checked(classResult);
  // Known membership/class associations are stronger than editable contact info.
  const knownIds = [...new Set<string>([...founding, ...classes].map(row => row.square_customer_id).filter(Boolean))];
  let customer: Customer | null = null;
  for (const id of knownIds) { customer = await retrieve(id); if (customer) break; }
  let created = false;
  if (!customer) {
    const email = emailKey(family.email), phone = phoneKey(family.phone);
    const reference = `lw-family-${householdId}`;
    const searches: Array<{ email_address?: { exact: string }; phone_number?: { exact: string }; reference_id?: { exact: string } }> = [{ reference_id: { exact: reference } }, { reference_id: { exact: householdId } }];
    if (email) searches.push({ email_address: { exact: email } });
    if (phone) searches.push({ phone_number: { exact: `+${phone}` } });
    const matches = new Map<string, Customer>();
    for (const filter of searches) {
      const result = await squareRequest<{ customers?: Customer[]; cursor?: string }>('/v2/customers/search', 'POST', { limit: 100, query: { filter } });
      if (result.cursor) throw new Error('Too many Square customer matches. Please review the customer directory.');
      for (const item of result.customers ?? []) {
        const referenceMatches = item.reference_id === reference || item.reference_id === householdId;
        const sameEmail = !!email && emailKey(item.email_address) === email;
        const samePhone = !!phone && phoneKey(item.phone_number) === phone;
        const conflict = (email && item.email_address && !sameEmail) || (phone && item.phone_number && !samePhone);
        const sameGuardian = people.some(person => nameKey(person.first_name) === nameKey(item.given_name) && !!nameKey(person.last_name) && nameKey(person.last_name) === nameKey(item.family_name));
        const contactMatches = !conflict && ((sameEmail && samePhone) || ((sameEmail || samePhone) && sameGuardian));
        if (referenceMatches || contactMatches) matches.set(item.id, item);
      }
      // A partial contact match must be reviewed rather than creating another
      // customer with the same email or phone and a different identity.
      if ((filter.email_address || filter.phone_number) && (result.customers?.length ?? 0) > 0 && !matches.size)
        throw new Error('A Square customer has matching contact details but needs review. Check Add customer in Square before creating another record.');
    }
    if (matches.size > 1) throw new Error('Multiple Square customer records match. Please review them in Square before connecting.');
    customer = [...matches.values()][0] ?? null;
    if (!customer) {
      if (!people.length || (!email && !phone)) throw new Error('Add a caregiver and an email or phone in family details before connecting Square.');
      const result = await squareRequest<{ customer: Customer }>('/v2/customers', 'POST', {
        idempotency_key: createHash('sha256').update(`lw-family-${config.environment}-${householdId}`).digest('hex').slice(0, 40), reference_id: reference,
        given_name: people[0].first_name, family_name: people[0].last_name || undefined,
        email_address: email || undefined, phone_number: phone ? `+${phone}` : undefined,
      });
      if (!result.customer?.id) throw new Error('Square could not save this customer.');
      customer = result.customer; created = true;
    }
  }
  const mapping = checked(await admin.from('square_customers').select('household_id').eq('square_customer_id', customer.id).maybeSingle());
  if (mapping && mapping.household_id !== householdId) throw new Error('This Square customer is already connected to another family. Please review the family records.');
  checked(await admin.from('square_customers').upsert({ household_id: householdId, square_customer_id: customer.id }, { onConflict: 'square_customer_id', ignoreDuplicates: true }));
  const saved = checked(await admin.from('square_customers').select('household_id').eq('square_customer_id', customer.id).single());
  if (saved.household_id !== householdId) throw new Error('This Square customer was connected to another family. Please review the family records.');
  return { customer, created };
}
