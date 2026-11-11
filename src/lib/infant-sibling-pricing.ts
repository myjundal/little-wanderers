export type AdmissionChild = { id: string; birthdate?: string | null };

// "Six months and under" includes the whole sixth month, ending on the
// seventh-month birthday. Clamp month ends instead of letting Date roll over.
export function isInfantSibling(birthdate: string | null | undefined, visitDate: string) {
  if (!birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || !/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) return false;
  const born = new Date(`${birthdate}T12:00:00Z`);
  if (!Number.isFinite(born.getTime()) || born.toISOString().slice(0, 10) !== birthdate || birthdate > visitDate) return false;
  const end = new Date(Date.UTC(born.getUTCFullYear(), born.getUTCMonth() + 7, 1, 12));
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0, 12)).getUTCDate();
  end.setUTCDate(Math.min(born.getUTCDate(), lastDay));
  return visitDate < end.toISOString().slice(0, 10);
}

export function freeInfantSiblingIds(children: AdmissionChild[], visitDate: string, includedIds = new Set<string>()) {
  const unique = [...new Map(children.map(child => [child.id, child])).values()];
  if (unique.length < 2) return new Set<string>();
  const infants = unique.filter(child => isInfantSibling(child.birthdate, visitDate));
  // A baby visiting alone still has normal admission. In an all-infant family,
  // retain one admission and waive only the additional siblings.
  const anchor = infants.find(child => includedIds.has(child.id)) ?? infants[0];
  const free = infants.length === unique.length ? infants.filter(child => child.id !== anchor.id) : infants;
  return new Set(free.map(child => child.id));
}
