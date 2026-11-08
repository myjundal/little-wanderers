export const JAMIE_ART_TITLE = 'Little Hands, Big Canvases';
export const JAMIE_ART_SESSION_STARTS = [
  '2026-11-12T22:00:00Z', '2026-11-19T22:00:00Z',
  '2026-12-03T22:00:00Z', '2026-12-10T22:00:00Z', '2026-12-17T22:00:00Z',
];
export const SECOND_CHILD_DISCOUNT_CENTS = 2000;

type Session = {
  id: string; title: string; status: string; start_time: string;
  price_cents: number; capacity: number | null;
};
type Registration = { class_id: string; person_id: string; status: string };
type Person = { id: string; role: string | null; household_id: string | null; first_name: string | null; last_name: string | null };
type Household = { id: string; name: string | null; email: string | null };

/** One full-series charge per child. The discount applies once, to the second child. */
export function quoteJamieArtSeries(childIds: string[], priceCents: number, paidChildCount = 0) {
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) throw new Error('A valid series price is required.');
  if (!childIds.length || childIds.some(id => !id) || new Set(childIds).size !== childIds.length) {
    throw new Error('Choose distinct children for the series.');
  }
  if (!Number.isSafeInteger(paidChildCount) || paidChildCount < 0) throw new Error('Invalid paid child count.');
  const discountCents = (paidChildCount === 0 && childIds.length >= 2) || paidChildCount === 1 ? Math.min(SECOND_CHILD_DISCOUNT_CENTS, priceCents) : 0;
  const subtotalCents = childIds.length * priceCents;
  if (!Number.isSafeInteger(subtotalCents)) throw new Error('Series amount is too large.');
  return { childCount: childIds.length, subtotalCents, discountCents, totalCents: subtotalCents - discountCents };
}

/** Read-only preparation: pre-registration is interest, never evidence of payment. */
export function prepareJamieArtPayments(input: {
  sessions: Session[]; registrations: Registration[]; people: Person[]; households: Household[]; paidChildrenByHousehold?: Record<string, number>;
}) {
  const course = input.sessions.filter(session => session.title === JAMIE_ART_TITLE);
  const sessions = course.filter(session => session.status === 'scheduled').sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
  const issues: string[] = [];
  const expected = JAMIE_ART_SESSION_STARTS.map(Date.parse);
  if (sessions.length !== expected.length || sessions.some((session, i) => Date.parse(session.start_time) !== expected[i])) {
    issues.push('Confirm the five sessions: November 12, November 19, December 3, December 10, and December 17.');
  }
  const priceCents = sessions[0]?.price_cents ?? null;
  const validPrice = priceCents != null && Number.isSafeInteger(priceCents) && priceCents > 0
    && sessions.every(session => session.price_cents === priceCents);
  if (!validPrice) issues.push('Confirm one consistent price for the full five-session series.');
  const capacities = sessions.map(session => session.capacity);
  const capacity = capacities.length && capacities.every(value => value != null && Number.isInteger(value) && value >= 0)
    ? Math.min(...capacities as number[]) : null;
  if (capacity == null) issues.push('Confirm the class size for every session before opening payment.');

  const sessionIds = new Set(sessions.map(session => session.id));
  const registrations = input.registrations.filter(reg => sessionIds.has(reg.class_id) && reg.status !== 'cancelled');
  const confirmedIds = new Set(registrations.filter(reg => reg.status === 'scheduled' || reg.status === 'attended').map(reg => reg.person_id));
  if (confirmedIds.size) issues.push(`${confirmedIds.size} child record(s) already have a confirmed or attended registration. Review their payment history separately.`);
  const interestIds = new Set(registrations.filter(reg => reg.status === 'preregistered').map(reg => reg.person_id));
  const people = new Map(input.people.map(person => [person.id, person]));
  const households = new Map(input.households.map(household => [household.id, household]));
  const groups = new Map<string, { household: Household; children: Person[] }>();
  let needsProfileReview = 0;
  for (const id of interestIds) {
    if (confirmedIds.has(id)) continue;
    const person = people.get(id);
    const household = person?.household_id ? households.get(person.household_id) : null;
    if (!person || person.role !== 'child' || !household) { needsProfileReview++; continue; }
    let group = groups.get(household.id);
    if (!group) { group = { household, children: [] }; groups.set(household.id, group); }
    group.children.push(person);
  }
  if (needsProfileReview) issues.push(`${needsProfileReview} pre-registration(s) need a child profile and family link before preparing payment.`);
  const families = [...groups.values()].map(group => {
    const children = group.children.sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));
    return {
      householdId: group.household.id, familyName: group.household.name,
      email: group.household.email,
      children: children.map(person => ({ id: person.id, name: [person.first_name, person.last_name].filter(Boolean).join(' ') || 'Name needed' })),
      quote: validPrice ? quoteJamieArtSeries(children.map(child => child.id), priceCents!, input.paidChildrenByHousehold?.[group.household.id] ?? 0) : null,
    };
  }).sort((a, b) => (a.familyName ?? a.children[0].name).localeCompare(b.familyName ?? b.children[0].name));
  const missingContactCount = families.filter(family => !family.email?.trim()).length;
  if (missingContactCount) issues.push(`${missingContactCount} family record(s) need an email address before sending a payment link.`);
  const interestCount = interestIds.size;
  if (capacity != null && new Set([...interestIds, ...confirmedIds]).size > capacity) {
    issues.push(`Interest exceeds the ${capacity}-child class size. Pre-registration does not reserve a place; limit completed payments to available seats.`);
  }
  return { sessions, priceCents: validPrice ? priceCents : null, capacity, interestCount, families, issues };
}
