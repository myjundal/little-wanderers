export type AdmissionVisit = {
  id: string;
  person_id: string;
  household_id: string;
  household_name: string;
  name: string;
  price_cents: number;
  payment_status: string;
};

export function admissionGroups(visits: AdmissionVisit[]) {
  const groups = new Map<string, { id: string; name: string; visits: AdmissionVisit[]; total: number }>();
  for (const visit of visits) {
    if (visit.payment_status !== 'due' || visit.price_cents <= 0 || !visit.household_id) continue;
    const group = groups.get(visit.household_id) ?? { id: visit.household_id, name: visit.household_name, visits: [], total: 0 };
    group.visits.push(visit);
    group.total += visit.price_cents;
    groups.set(group.id, group);
  }
  return [...groups.values()];
}

export function squarePosCallback(search: string) {
  const raw = new URLSearchParams(search).get('data');
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || !data) return { status: 'error' as const };
    if (data.status !== 'ok' || typeof data.transaction_id !== 'string' || typeof data.state !== 'string') return { status: 'error' as const };
    return { status: 'ok' as const, transaction_id: data.transaction_id, state: data.state };
  } catch { return { status: 'error' as const }; }
}
