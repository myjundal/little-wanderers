import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { isFamilyManagerRole } from '@/lib/family-roles';

export const ACCOUNT_LINK_COOKIE = 'lw_account_link';
type Intent = { user: string; household: string; method: 'email' | 'phone'; contact: string; expires: number };
export const normalizeLoginContact = (value: string, method: 'email' | 'phone') => method === 'phone' ? value.replace(/\D/g, '') : value.trim().toLowerCase();
function signature(value: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('Account linking is unavailable.');
  return createHmac('sha256', secret).update(`account-link-v1:${value}`).digest('base64url');
}
export function signAccountLink(intent: Intent) {
  const payload = Buffer.from(JSON.stringify(intent)).toString('base64url');
  return `${payload}.${signature(payload)}`;
}
export function readAccountLink(value: string): Intent | null {
  try {
    const [payload, mac, extra] = value.split('.');
    if (!payload || !mac || extra) return null;
    const expected = Buffer.from(signature(payload));
    const actual = Buffer.from(mac);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const intent = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Intent;
    if (!intent.user || !intent.household || !['email', 'phone'].includes(intent.method) || !intent.contact || intent.expires < Date.now() || intent.expires > Date.now() + 16 * 60_000) return null;
    return intent;
  } catch { return null; }
}

/** Both identities must have passed Auth verification. Contact profile fields never establish ownership. */
export async function linkVerifiedFamilyLogins(admin: SupabaseClient, user: User, intent: Intent) {
  const verified = intent.method === 'email' ? user.email_confirmed_at : user.phone_confirmed_at;
  if (!verified || normalizeLoginContact(user[intent.method] ?? '', intent.method) !== intent.contact || user.id === intent.user) throw new Error('Verify the email or phone number you chose.');
  const source = await admin.from('household_members').select('role').eq('user_id', intent.user).eq('household_id', intent.household).maybeSingle();
  if (source.error || !isFamilyManagerRole(source.data?.role)) throw new Error('The original family access changed. Start again.');
  const other = await getLatestHouseholdIdForUser(admin, user.id);
  let canonical = intent.household;
  let placeholder: string | null = null;
  if (other) {
    const member = await admin.from('household_members').select('role').eq('household_id', other).eq('user_id', user.id).maybeSingle();
    if (member.error || !isFamilyManagerRole(member.data?.role)) throw new Error('Ask a family caregiver to connect these logins.');
  }
  if (other && other !== canonical) {
    const aliases = await admin.from('staff_family_search_aliases').select('alias_household_id').in('alias_household_id', [canonical, other]);
    if (aliases.error || aliases.data?.length) throw new Error('Existing family directory links need review before connecting another login.');
    const populated = async (id: string) => {
      for (const table of ['people', 'founding_memberships', 'memberships', 'party_bookings', 'open_play_reservations', 'checkins', 'waivers']) {
        let query = admin.from(table).select('id').eq('household_id', id);
        if (table === 'people') query = query.eq('role', 'child');
        const result = await query.limit(1);
        if (result.error) throw new Error('Unable to check existing family records.');
        if (result.data?.length) return true;
      }
      return false;
    };
    const [sourcePopulated, otherPopulated] = await Promise.all([populated(canonical), populated(other)]);
    if (sourcePopulated && otherPopulated) throw new Error('Both logins have family records. Contact Little Wanderers so we can preserve and connect both histories.');
    canonical = otherPopulated ? other : sourcePopulated ? canonical : [canonical, other].sort()[0];
    placeholder = canonical === other ? intent.household : other;
  }
  // Upsert only memberships proven above. No people, waivers, billing records or Auth users are deleted.
  const timestamp = new Date().toISOString();
  for (const id of [intent.user, user.id]) {
    const result = await admin.from('household_members').upsert({ user_id: id, household_id: canonical, role: 'primary_caregiver', created_at: timestamp }, { onConflict: 'household_id,user_id' });
    if (result.error) throw new Error('Unable to finish connecting your logins. Retry from My Info.');
  }
  if (placeholder) {
    const alias = await admin.from('staff_family_search_aliases').upsert({ alias_household_id: placeholder, canonical_household_id: canonical, reason: 'Both email/phone login identities verified by the family; an empty signup household is linked to the existing family.' }, { onConflict: 'alias_household_id', ignoreDuplicates: true });
    if (alias.error) throw new Error('Your logins are connected, but the family directory needs review. Contact Little Wanderers.');
  }
  return canonical;
}
