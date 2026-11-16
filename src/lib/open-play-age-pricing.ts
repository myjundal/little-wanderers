import type { AdmissionChild } from '@/lib/infant-sibling-pricing';
export const AGE_PRICING_START = '2026-11-16';
export function underMonths(birthdate: string | null | undefined, visitDate: string, months: number) {
  if (!birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || !/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) return false;
  const born = new Date(`${birthdate}T12:00:00Z`);
  if (!Number.isFinite(born.getTime()) || born.toISOString().slice(0, 10) !== birthdate || birthdate > visitDate) return false;
  const end = new Date(Date.UTC(born.getUTCFullYear(), born.getUTCMonth() + months, 1, 12));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0, 12)).getUTCDate();
  end.setUTCDate(Math.min(born.getUTCDate(), last));
  return visitDate < end.toISOString().slice(0, 10);
}
export function openPlayAgeAmount(children: AdmissionChild[], visitDate: string, covered = new Set<string>()) {
  const payable = [...new Map(children.map(child => [child.id, child])).values()]
    .filter(child => !covered.has(child.id) && !underMonths(child.birthdate, visitDate, 6));
  if (!payable.length) return 0;
  return payable.length * 1000 + (payable.some(child => !underMonths(child.birthdate, visitDate, 12)) ? 600 : 0);
}
