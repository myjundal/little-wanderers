import { admissionDate } from '@/lib/admission-stays';
import type { AdmissionVisit } from '@/lib/admission-pos-ui';
import type { ReservationAdmissionStatus } from '@/lib/admission-payment-status';

export type DeskPerson = { id: string; first_name: string | null; last_name: string | null; role: string; birthdate: string | null };
export type DeskReservation = { id: string; child_count: number; adult_count: number; child_ids?: string[] | null; status?: string; amount_cents?: number; admission_status?: ReservationAdmissionStatus; slot: { label: string; starts_at: string; ends_at: string } };
export type DeskFamily = { id: string; name: string | null; email: string | null; phone: string | null; people: DeskPerson[]; waiver_status: string; reservations: DeskReservation[] };
export type ArrivalCard = { family: DeskFamily; reservation?: DeskReservation; arrived: boolean; completed: boolean; checkedChildren: number; expectedChildren: number; arrivedAt: number };
export type ArrivalGroup = { key: string; starts_at: string; ends_at: string; cards: ArrivalCard[]; ages: Array<{ age: number | null; count: number }>; children: number };

export function childAgeOn(birthdate: string | null | undefined, date: string): number | null {
  if (!birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || birthdate > date) return null;
  const born = new Date(`${birthdate}T12:00:00Z`);
  if (!Number.isFinite(born.getTime()) || born.toISOString().slice(0, 10) !== birthdate) return null;
  const years = Number(date.slice(0, 4)) - Number(birthdate.slice(0, 4)) - (date.slice(5) < birthdate.slice(5) ? 1 : 0);
  return years >= 0 ? years : null;
}

function reservedIds(reservation: DeskReservation) {
  const ids = [...new Set(reservation.child_ids ?? [])];
  // Mismatched legacy headcounts cannot identify which children are coming.
  return ids.length <= reservation.child_count ? ids : [];
}

export function familyArrival(family: DeskFamily, visits: AdmissionVisit[], date: string, reservation?: DeskReservation): ArrivalCard {
  const familyVisits = visits.filter(visit => visit.household_id === family.id && visit.checked_in_at && admissionDate(visit.checked_in_at) === date);
  const arrived = new Set(familyVisits.map(visit => visit.person_id));
  const childVisits = familyVisits.filter(visit => family.people.some(person => person.id === visit.person_id && person.role === 'child'));
  const ids = reservation ? reservedIds(reservation) : family.people.filter(person => person.role === 'child').map(person => person.id);
  const checkedChildren = ids.length ? ids.filter(id => arrived.has(id) && family.people.some(person => person.id === id && person.role === 'child')).length
    : family.people.filter(person => person.role === 'child' && arrived.has(person.id)).length;
  const expectedChildren = reservation?.child_count ?? Math.max(family.people.filter(person => person.role === 'child').length, 1);
  const arrivedAt = childVisits.length ? Math.min(...childVisits.map(visit => Date.parse(visit.checked_in_at!))) : 0;
  return { family, reservation, arrived: childVisits.length > 0, checkedChildren, expectedChildren, completed: checkedChildren >= expectedChildren, arrivedAt };
}

export function arrivalGroups(families: DeskFamily[], visits: AdmissionVisit[], date: string) {
  const groups = new Map<string, ArrivalGroup>();
  const walkins: ArrivalCard[] = [];
  for (const family of families) {
    const reservations = family.reservations.filter(reservation => reservation.status !== 'cancelled' && admissionDate(reservation.slot.starts_at) === date);
    if (!reservations.length) { walkins.push(familyArrival(family, visits, date)); continue; }
    for (const reservation of reservations) {
      const key = `${reservation.slot.starts_at}/${reservation.slot.ends_at}`;
      const group = groups.get(key) ?? { key, starts_at: reservation.slot.starts_at, ends_at: reservation.slot.ends_at, cards: [], ages: [], children: 0 };
      group.cards.push(familyArrival(family, visits, date, reservation));
      group.children += reservation.child_count;
      const ids = reservedIds(reservation);
      const children = ids.map(id => family.people.find(person => person.id === id && person.role === 'child'));
      const ages = children.map(person => childAgeOn(person?.birthdate, date));
      while (ages.length < reservation.child_count) ages.push(null);
      for (const age of ages) {
        const bucket = group.ages.find(item => item.age === age);
        if (bucket) bucket.count++; else group.ages.push({ age, count: 1 });
      }
      groups.set(key, group);
    }
  }
  // A family has arrived once any child checks in, even when siblings stay home.
  const arrivedLast = (a: ArrivalCard, b: ArrivalCard) => Number(a.arrived) - Number(b.arrived) || (a.arrived ? a.arrivedAt - b.arrivedAt : 0);
  const windows = [...groups.values()].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  for (const group of windows) {
    group.cards.sort(arrivedLast);
    group.ages.sort((a, b) => (a.age ?? Infinity) - (b.age ?? Infinity));
  }
  return { windows, walkins: walkins.sort(arrivedLast) };
}
