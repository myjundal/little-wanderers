import type { AdmissionVisit } from '@/lib/admission-pos-ui';

export const admissionDate = (value: string) => new Date(value).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
export const admissionTime = (value: string) => new Date(value).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

export function stayMinutes(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const minutes = (Date.parse(end) - Date.parse(start)) / 60000;
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

export function stayLabel(minutes: number | null) {
  if (minutes === null) return 'Time unavailable';
  const rounded = Math.floor(minutes);
  if (rounded < 1) return 'Less than 1 min';
  return rounded < 60 ? `${rounded} min` : `${Math.floor(rounded / 60)} hr${rounded >= 120 ? 's' : ''}${rounded % 60 ? ` ${rounded % 60} min` : ''}`;
}

export function visitingFamilies(visits: AdmissionVisit[]) {
  const groups = new Map<string, { id: string; name: string; visits: AdmissionVisit[] }>();
  for (const visit of visits) {
    if (!visit.household_id) continue;
    const group = groups.get(visit.household_id) ?? { id: visit.household_id, name: visit.household_name, visits: [] };
    group.visits.push(visit);
    groups.set(group.id, group);
  }
  return [...groups.values()];
}

export function admissionStayStatistics(visits: AdmissionVisit[]) {
  const families = new Map<string, { date: string; household_id: string; name: string; visits: AdmissionVisit[] }>();
  let completedGuests = 0, guestMinutes = 0;
  for (const visit of visits) {
    const minutes = stayMinutes(visit.checked_in_at, visit.checked_out_at);
    if (minutes !== null) { completedGuests++; guestMinutes += minutes; }
    if (!visit.checked_in_at || !Number.isFinite(Date.parse(visit.checked_in_at))) continue;
    const date = admissionDate(visit.checked_in_at);
    const key = `${date}:${visit.household_id}`;
    const group = families.get(key) ?? { date, household_id: visit.household_id, name: visit.household_name, visits: [] };
    group.visits.push(visit);
    families.set(key, group);
  }
  const completed = [...families.values()].flatMap(group => {
    if (group.visits.some(visit => stayMinutes(visit.checked_in_at, visit.checked_out_at) === null)) return [];
    const start = Math.min(...group.visits.map(visit => Date.parse(visit.checked_in_at!)));
    const end = Math.max(...group.visits.map(visit => Date.parse(visit.checked_out_at!)));
    return [{ date: group.date, household_id: group.household_id, name: group.name, guests: group.visits.length,
      checked_in_at: new Date(start).toISOString(), checked_out_at: new Date(end).toISOString(), minutes: (end - start) / 60000 }];
  }).sort((a, b) => b.checked_out_at.localeCompare(a.checked_out_at));
  return {
    completed, completed_guests: completedGuests, guest_minutes: guestMinutes,
    without_checkout: visits.length - completedGuests,
    average_minutes: completed.length ? completed.reduce((sum, row) => sum + row.minutes, 0) / completed.length : null,
    longest_minutes: completed.length ? Math.max(...completed.map(row => row.minutes)) : null,
  };
}

export function admissionStayCsv(completed: ReturnType<typeof admissionStayStatistics>['completed']) {
  const cell = (value: string | number) => {
    const raw = String(value);
    const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const lines = [['Date (Eastern)', 'Family', 'Guests', 'Check-in (Eastern)', 'Check-out (Eastern)', 'Stay (minutes)'],
    ...completed.map(row => [row.date, row.name, row.guests, admissionTime(row.checked_in_at), admissionTime(row.checked_out_at), Math.round(row.minutes * 10) / 10])];
  return '\ufeff' + lines.map(row => row.map(cell).join(',')).join('\r\n');
}
