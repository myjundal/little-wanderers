import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { parseBirthdate } from '@/lib/birthdate';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

export const GUEST_WAIVER_COOKIE = 'lw_guest_waiver';
export const guestEmailSchema = z.string().trim().toLowerCase().email().max(254);
const name = z.string().trim().min(1).max(100);
export const guestProfileSchema = z.object({
  first_name: name, last_name: name,
  phone: z.string().max(40).transform(value => {
    const digits = value.replace(/\D/g, '');
    return value.trim().startsWith('+') ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
  }).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/)),
  children: z.array(z.object({ first_name: name, last_name: name,
    birthdate: z.string().refine(value => parseBirthdate(value) !== null).transform(value => parseBirthdate(value)!),
  })).max(10),
  signature: z.string().trim().min(2).max(150).transform(value => value.replace(/\s+/g, ' ')),
  is_guardian: z.literal(true), electronic_consent: z.literal(true), photo_consent: z.boolean(),
  agreements: z.record(z.string(), z.boolean()),
});
export type GuestChild = { id: string; first_name: string; last_name: string | null; birthdate: string | null };
export type GuestWaiverContext = { verified: boolean; email?: string; children?: GuestChild[]; party_id?: string | null; party_date?: string | null; waiver_id?: string | null; existing_waiver?: { id: string; signed_at: string; expires_at: string } | null };
export const guestTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const guestFamilyRevision = (children: GuestChild[]) => guestTokenHash(JSON.stringify(children));
export function guestSecretHash(value: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Waiver verification is unavailable');
  return createHmac('sha256', key).update(value).digest('hex');
}

/** The database reads the confirmed Auth email; a submitted contact email cannot claim records. */
export async function claimGuestWaiverFamily(userId: string) {
  const { data, error } = await createAdminSupabaseClient().rpc('claim_guest_waiver_family', { p_user: userId });
  if (error) throw new Error('Unable to connect guest waiver records');
  return data as { claimed: boolean; review_required?: boolean; household_id?: string };
}
