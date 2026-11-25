import { AGE_PRICING_START, openPlayAgeAmount } from '@/lib/open-play-age-pricing';
import { freeInfantSiblingIds, isInfantSibling, type AdmissionChild } from '@/lib/infant-sibling-pricing';
import { membershipCoversAdmission, type MembershipAdmissionTerm } from '@/lib/membership-admission-coverage';

export function softOpeningAmount(childIds: string[], memberships: Array<MembershipAdmissionTerm & {
    child_ids: string[];
}>, visitDate: string, children: AdmissionChild[] = []) {
    const covered = new Set(childIds.filter(id => memberships.some(m => m.child_ids.includes(id) && membershipCoversAdmission(m, visitDate))));
    if (visitDate >= AGE_PRICING_START) return openPlayAgeAmount(childIds.map(id => ({ id, birthdate: children.find(child => child.id === id)?.birthdate })), visitDate, covered);
    const freeInfants = freeInfantSiblingIds(childIds.map(id => ({ id, birthdate: children.find(child => child.id === id)?.birthdate })), visitDate, covered);
    const uncovered = childIds.filter(id => !freeInfants.has(id) && !covered.has(id));
    if (!uncovered.length) return 0;
    const infantOnly = uncovered.every(id => isInfantSibling(children.find(child => child.id === id)?.birthdate, visitDate));
    return (infantOnly ? 1000 : 1600) + (uncovered.length - 1) * 1000;
}
