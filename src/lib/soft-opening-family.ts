import { readComplimentaryMembership } from '@/lib/complimentary-membership';
import { isUuid } from '@/lib/open-play-reservations';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPrimaryGuardianProfile, ensureGuardianProfile } from '@/lib/family-profile';
import { parseChildAge } from '@/lib/child-age';
import { squareEnvironment } from '@/lib/square-client';
export async function readSoftOpeningFamily(db: SupabaseClient, householdId: string) {
    const [guardian, children, founding, complimentary] = await Promise.all([
        getPrimaryGuardianProfile(db, householdId),
        db.from('people').select('id,first_name,last_name,birthdate').eq('household_id', householdId).eq('role', 'child').order('created_at'),
        db.from('founding_memberships').select('child_ids,status,start_date,paid_through').eq('household_id', householdId).eq('environment', squareEnvironment()).in('status', ['pending', 'activating', 'scheduled', 'active', 'canceling', 'canceled']),
        readComplimentaryMembership(db, householdId),
    ]);
    if (children.error || founding.error)
        throw new Error('Unable to load family details.');
    return { guardian, children: children.data ?? [], memberships: [...(founding.data ?? []), ...(complimentary ? [{ child_ids: complimentary.covered_person_ids!, status: 'complimentary', start_date: null, paid_through: null }] : [])] };
}
export type SoftOpeningPersonInput = {
    id?: string;
    new_id?: string;
    name?: string;
    age?: string | number;
    age_unit?: string;
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
        const age = parseChildAge(child.age, child.age_unit);
        if (!existing?.birthdate && !age)
            throw new Error('Please enter each child’s age in years or months.');
        let birthdate = existing?.birthdate;
        if (!birthdate && age) {
            const d = new Date();
            d.setUTCMonth(d.getUTCMonth() - age.months);
            birthdate = d.toISOString().slice(0, 10);
        }
        return { existing, name, birthdate, age, newId: child.new_id };
    });
    if (new Set(entries.filter(e => e.existing).map(e => e.existing!.id)).size !== entries.filter(e => e.existing).length)
        throw new Error('Choose each child only once.');
    const newKeys = entries.filter(e => !e.existing && e.newId).map(e => e.newId);
    if (new Set(newKeys).size !== newKeys.length)
        throw new Error('Choose each child only once.');
    await ensureGuardianProfile({ admin: db, householdId, userId: user.id, email: user.email, firstName, lastName });
    for (const e of entries) {
        const [first, ...rest] = e.name.split(' ');
        const row = { first_name: first, last_name: rest.join(' ') || null, birthdate: e.birthdate, ...(!e.existing?.birthdate ? { notes: `Approximate age ${e.age!.label} entered for soft opening. Update birthday in My Info/People.` } : {}) };
        const query = e.existing ? db.from('people').update(row).eq('id', e.existing.id).eq('household_id', householdId).eq('role', 'child') : db.from('people').insert({ ...row, ...(e.newId ? { id: e.newId } : {}), household_id: householdId, role: 'child', gender: null });
        const result = await query.select('id').single();
        if (result.error || !result.data)
            throw new Error('Unable to save your family details. Please try again.');
        ids.push(result.data.id);
    }
    return { childIds: ids, memberships: family.memberships, guardianName: `${firstName} ${lastName}`, children: entries.map((e, index) => ({ id: ids[index], name: e.name, birthdate: e.birthdate, ageLabel: e.age?.label })) };
}
