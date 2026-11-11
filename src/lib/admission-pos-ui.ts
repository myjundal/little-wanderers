export type AdmissionVisit = {
  id: string;
  person_id: string;
  household_id: string;
  household_name: string;
  name: string;
  price_cents: number;
  payment_status: string;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
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
    return { status: 'ok' as const, transaction_id: data.transaction_id, state: data.state.split('.')[0], return_token: data.state.includes('.') ? data.state : undefined };
  } catch { return { status: 'error' as const }; }
}

export const PENDING_ADMISSION_POS_KEY = 'lw-admission-pos-pending';
export type PendingAdmissionPos = { id: string; family_id: string; started_at: number };

export function readPendingAdmissionPos(value: string | null, now = Date.now()): PendingAdmissionPos | null {
  if (!value || value.length > 500) return null;
  try {
    const parsed = JSON.parse(value);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!parsed || typeof parsed.id !== 'string' || !uuid.test(parsed.id) || typeof parsed.family_id !== 'string' || !uuid.test(parsed.family_id)
      || !Number.isFinite(parsed.started_at) || parsed.started_at > now || now - parsed.started_at > 86400000) return null;
    return { id: parsed.id, family_id: parsed.family_id, started_at: parsed.started_at };
  } catch { return null; }
}
