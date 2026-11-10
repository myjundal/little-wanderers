import type { User } from '@supabase/supabase-js';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { normalizeWaitlistEmail } from '@/lib/waitlist';
export type SoftOpeningAccess = {
    allowed: boolean;
    email: string | null;
    on_wanderlist: boolean;
    website_signup: boolean;
    party_early_access: boolean;
    has_party_booking: boolean;
    founding_member: boolean;
};
/** The emailed URL is unlisted. Email and phone sign-ins are eligible; callers validate the user with Auth. */
export async function getSoftOpeningAccessForUser(admin: ReturnType<typeof createAdminSupabaseClient>, user: Pick<User, 'id' | 'email' | 'phone'>): Promise<SoftOpeningAccess> {
    const email = normalizeWaitlistEmail(user.email ?? '');
    let onWanderlist = false;
    if (email) {
        const result = await admin.from('waitlist_entries').select('id').eq('normalized_email', email).limit(1);
        if (result.error)
            throw new Error(result.error.message);
        onWanderlist = Boolean(result.data?.length);
    }
    return { allowed: Boolean(user.id && (email || user.phone)), email: user.email ?? null, on_wanderlist: onWanderlist, website_signup: !onWanderlist, party_early_access: false, has_party_booking: false, founding_member: false };
}
