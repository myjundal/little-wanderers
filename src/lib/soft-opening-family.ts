import { readComplimentaryMembership } from '@/lib/complimentary-membership';
import { isUuid } from '@/lib/open-play-reservations';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPrimaryGuardianProfile, ensureGuardianProfile } from '@/lib/family-profile';
import { isEstimatedOpenPlayBirthdate, parseOpenPlayBirthdate } from '@/lib/open-play-birthdate';
import { squareEnvironment } from '@/lib/square-client';
export async function readSoftOpeningFamily(db: SupabaseClient, householdId: string) {
    const [guardian, children, founding, complimentary] = await Promise.all([
        getPrimaryGuardianProfile(db, householdId),
        db.from('people').select('id,first_name,last_name,birthdate,notes').eq('household_id', householdId).eq('role', 'child').order('created_at'),
        db.from('founding_memberships').select('child_ids,status,start_date,paid_through,square_card_id,square_subscription_id').eq('household_id', householdId).eq('environment', squareEnvironment()).in('status', ['pending', 'activating', 'scheduled', 'active', 'canceling', 'canceled']),
        readComplimentaryMembership(db, householdId),
    ]);
    if (children.error || founding.error)
        throw new Error('Unable to load family details.');
    // Notes stay private; clients receive only the birthday confirmation flag.
    const roster = (children.data ?? []).map(({ notes, ...child }) => ({ ...child,
        birthdate_needs_confirmation: isEstimatedOpenPlayBirthdate(notes) || !parseOpenPlayBirthdate(child.birthdate),
    }));
    // The reservation form needs membership eligibility, not private provider IDs.
    const memberships = (founding.data ?? []).map(({ square_card_id, square_subscription_id, ...term }) => ({
        ...term, active_subscription: term.status === 'active' && Boolean(square_card_id && square_subscription_id),
    }));
    return { guardian, children: roster, memberships: [...memberships, ...(complimentary ? [{ child_ids: roster.map(child => child.id), status: 'complimentary', start_date: null, paid_through: null }] : [])] };
}
export type SoftOpeningPersonInput = {
    id?: string;
    new_id?: string;
    name?: string;
    birthdate?: string;
};
export async function saveSoftOpeningFamily(db: SupabaseClient, householdId: string, user: {
    id: string;
    email?: string;
}, input: {
    guardian_first_name?: string;
    guardian_last_name?: string;
    children?: SoftOpeningPersonInput[];
}) {
    const family = await readSoftOpeningFamily(db, householdId);
    const firstName = (input.guardian_first_name ?? family.guardian?.first_name ?? '').trim();
    const lastName = (input.guardian_last_name ?? family.guardian?.last_name ?? '').trim();
    if (!firstName || firstName === 'Guardian' || !lastName || firstName.length > 80 || lastName.length > 80)
        throw new Error('Please enter the parent or guardian’s first and last name.');
    if (!Array.isArray(input.children) || input.children.length < 1 || input.children.length > 5)
        throw new Error('Choose 1–5 participating children.');
    const ids: string[] = [];
    // Validate every child before writing anything. Only IDs belonging to this family are accepted.
    const entries = input.children.map(child => {
        const lookup = child.id ?? child.new_id;
        if (child.new_id && !isUuid(child.new_id))
            throw new Error('Invalid child information. Please refresh and try again.');
        const existing = lookup ? family.children.find(p => p.id === lookup) : null;
        if (child.id && !existing)
            throw new Error('Please choose a child from your family.');
        const name = (child.name ?? [existing?.first_name, existing?.last_name].filter(Boolean).join(' ')).trim().replace(/\s+/g, ' ');
        if (!name || name.length > 80)
            throw new Error('Please enter each child’s name.');
        const birthdate = parseOpenPlayBirthdate(child.birthdate ?? (existing?.birthdate_needs_confirmation ? null : existing?.birthdate));
        if (!birthdate)
            throw Object.assign(new Error('Please enter each child’s actual birthday (MM/DD/YYYY). Future dates and age estimates cannot be used for check-in.'), { code: 'invalid_birthdate' });
        return { existing, name, birthdate, newId: child.new_id };
    });
    if (new Set(entries.filter(e => e.existing).map(e => e.existing!.id)).size !== entries.filter(e => e.existing).length)
        throw new Error('Choose each child only once.');
    const newKeys = entries.filter(e => !e.existing && e.newId).map(e => e.newId);
    if (new Set(newKeys).size !== newKeys.length)
        throw new Error('Choose each child only once.');
    await ensureGuardianProfile({ admin: db, householdId, userId: user.id, email: user.email, firstName, lastName });
    for (const e of entries) {
        const [first, ...rest] = e.name.split(' ');
        // Retain original private notes, including the old estimate, in the audit.
        let confirmationNotes: string | undefined;
        if (e.existing?.birthdate_needs_confirmation) {
            const previous = await db.from('people').select('notes').eq('id', e.existing.id).eq('household_id', householdId).single();
            if (previous.error || !previous.data) throw new Error('Unable to confirm the saved birthday. Please try again.');
            confirmationNotes = `Birthday confirmed by signed-in caregiver during Open Play booking: ${e.birthdate} on ${new Date().toISOString()}. Previous birthday: ${e.existing.birthdate ?? 'not provided'}. Previous notes: ${previous.data.notes ?? ''}`;
        }
        const row = { first_name: first, last_name: rest.join(' ') || null, birthdate: e.birthdate, ...(confirmationNotes ? { notes: confirmationNotes } : {}) };
        const query = e.existing ? db.from('people').update(row).eq('id', e.existing.id).eq('household_id', householdId).eq('role', 'child') : db.from('people').insert({ ...row, ...(e.newId ? { id: e.newId } : {}), household_id: householdId, role: 'child', gender: null });
        const result = await query.select('id').single();
        if (result.error || !result.data)
            throw new Error('Unable to save your family details. Please try again.');
        ids.push(result.data.id);
    }
    return { childIds: ids, memberships: family.memberships.map(membership => membership.status === 'complimentary' ? { ...membership, child_ids: ids } : membership), guardianName: `${firstName} ${lastName}`, children: entries.map((e, index) => ({ id: ids[index], name: e.name, birthdate: e.birthdate })) };
}
