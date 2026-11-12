import { freeInfantSiblingIds, type AdmissionChild } from '@/lib/infant-sibling-pricing';

export function softOpeningAmount(childIds: string[], memberships: Array<{
    child_ids: string[];
    status: string;
    start_date: string | null;
    paid_through: string | null;
}>, visitDate: string, children: AdmissionChild[] = []) {
    const covered = new Set(childIds.filter(id => memberships.some(m => m.child_ids.includes(id) && (['complimentary', 'pending', 'activating', 'scheduled'].includes(m.status) || (m.status === 'active' && !m.start_date) ||
        (['active', 'canceling', 'canceled'].includes(m.status) && m.start_date && m.start_date <= visitDate && m.paid_through && m.paid_through >= visitDate)))));
    const freeInfants = freeInfantSiblingIds(childIds.map(id => ({ id, birthdate: children.find(child => child.id === id)?.birthdate })), visitDate, covered);
    const uncovered = childIds.filter(id => !freeInfants.has(id) && !covered.has(id)).length;
    return uncovered ? 1600 + (uncovered - 1) * 1000 : 0;
}
