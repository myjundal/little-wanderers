import type { SupabaseClient } from '@supabase/supabase-js';

export type PersonRole = 'adult' | 'child';

export type CheckinLineItem = {
  id: string;
  name: string;
  quantity: number;
  price_cents: number;
};

export type CheckinCandidate = {
  person_id: string;
  household_id: string;
  first_name: string | null;
  last_name: string | null;
  role: PersonRole;
  birthdate: string | null;
  membership_applied: boolean;
  price_cents: number;
  lineItems: CheckinLineItem[];
  household: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

type PersonRow = {
  id: string;
  household_id: string;
  role: PersonRole | null;
  first_name: string | null;
  last_name: string | null;
  birthdate: string | null;
};

type HouseholdRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
};

type PricingRule = {
  id: string;
  name: string | null;
  role?: PersonRole | null;
  min_months: number | null;
  max_months: number | null;
  price_cents: number;
  active_from: string | null;
  active_to: string | null;
};

function uniqueIds(ids: string[]) {
  return [...new Set(ids.map((id) => id?.trim()).filter(Boolean))];
}

function fullName(person: Pick<PersonRow, 'first_name' | 'last_name'>) {
  return [person.first_name, person.last_name].filter(Boolean).join(' ').trim() || 'Guest';
}

function monthsBetween(birthISO: string | null): number | null {
  if (!birthISO) return null;
  const b = new Date(birthISO);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) months -= 1;
  return Math.max(months, 0);
}

function ruleApplies(rule: PricingRule, role: PersonRole, ageMonths: number | null): boolean {
  const today = new Date();
  const activeFrom = rule.active_from ? new Date(rule.active_from) : null;
  const activeTo = rule.active_to ? new Date(rule.active_to) : null;
  if (activeFrom && activeFrom > today) return false;
  if (activeTo && activeTo < new Date(today.toDateString())) return false;
  if (rule.role && rule.role !== role) return false;
  if (rule.min_months != null && (ageMonths == null || ageMonths < rule.min_months)) return false;
  if (rule.max_months != null && (ageMonths == null || ageMonths > rule.max_months)) return false;
  return true;
}

function pickBestRule(rules: PricingRule[], role: PersonRole, ageMonths: number | null): PricingRule | null {
  const candidates = rules.filter((rule) => ruleApplies(rule, role, ageMonths));
  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    const aRole = a.role ? 1 : 0;
    const bRole = b.role ? 1 : 0;
    if (bRole !== aRole) return bRole - aRole;

    const aSpan = (a.max_months ?? 99999) - (a.min_months ?? 0);
    const bSpan = (b.max_months ?? 99999) - (b.min_months ?? 0);
    if (aSpan !== bSpan) return aSpan - bSpan;

    const aFrom = a.active_from ? new Date(a.active_from).getTime() : 0;
    const bFrom = b.active_from ? new Date(b.active_from).getTime() : 0;
    return bFrom - aFrom;
  })[0];
}

async function loadActiveMembershipKeys(admin: SupabaseClient, householdIds: string[], personIds: string[]) {
  const householdMemberships = new Set<string>();
  const personMemberships = new Set<string>();
  const nowISO = new Date().toISOString();

  if (householdIds.length > 0) {
    const { data, error } = await admin
      .from('memberships')
      .select('household_id')
      .in('household_id', householdIds)
      .or(`renews_at.is.null,renews_at.gt.${nowISO}`);
    if (error) throw new Error('membership check failed');
    (data ?? []).forEach((row: { household_id: string | null }) => {
      if (row.household_id) householdMemberships.add(row.household_id);
    });
  }

  if (personIds.length > 0) {
    const { data, error } = await admin
      .from('memberships')
      .select('person_id')
      .in('person_id', personIds)
      .or(`renews_at.is.null,renews_at.gt.${nowISO}`);
    if (!error) {
      (data ?? []).forEach((row: { person_id: string | null }) => {
        if (row.person_id) personMemberships.add(row.person_id);
      });
    }
  }

  return { householdMemberships, personMemberships };
}

export async function loadCheckinCandidates(admin: SupabaseClient, rawPersonIds: string[]) {
  const personIds = uniqueIds(rawPersonIds);
  if (personIds.length === 0) throw new Error('person_id required');

  const { data: people, error: peopleError } = await admin
    .from('people')
    .select('id, household_id, role, first_name, last_name, birthdate')
    .in('id', personIds);

  if (peopleError) throw new Error('person lookup failed');
  if ((people ?? []).length !== personIds.length) throw new Error('person not found');

  const personRows = (people ?? []) as PersonRow[];
  const householdIds = uniqueIds(personRows.map((person) => person.household_id));

  const { data: households, error: householdError } = await admin
    .from('households')
    .select('id, name, email, phone')
    .in('id', householdIds);
  if (householdError) throw new Error('household lookup failed');

  const householdById = new Map((households ?? []).map((row) => [row.id, row as HouseholdRow]));
  const memberships = await loadActiveMembershipKeys(admin, householdIds, personIds);

  const { data: rules, error: rulesError } = await admin.from('pricing_rules').select('*');
  if (rulesError) throw new Error('pricing rules load failed');

  const ruleRows = (rules ?? []) as PricingRule[];
  const personById = new Map(personRows.map((person) => [person.id, person]));

  return personIds.map((personId) => {
    const person = personById.get(personId);
    if (!person) throw new Error('person not found');

    const role = person.role === 'adult' ? 'adult' : 'child';
    const membershipApplied =
      memberships.householdMemberships.has(person.household_id) || memberships.personMemberships.has(person.id);

    let priceCents = 0;
    let ruleName: string | null = null;
    if (!membershipApplied) {
      const best = pickBestRule(ruleRows, role, monthsBetween(person.birthdate));
      if (!best) throw new Error('no applicable pricing rule');
      priceCents = best.price_cents;
      ruleName = best.name;
    }

    const household = householdById.get(person.household_id) ?? null;
    const name = fullName(person);
    const lineName = membershipApplied
      ? `${name} admission - membership`
      : ruleName || `${name} open play (${role})`;

    return {
      person_id: person.id,
      household_id: person.household_id,
      first_name: person.first_name,
      last_name: person.last_name,
      role,
      birthdate: person.birthdate,
      membership_applied: membershipApplied,
      price_cents: priceCents,
      lineItems: [
        {
          id: `${person.id}:admission`,
          name: lineName,
          quantity: 1,
          price_cents: priceCents,
        },
      ],
      household: household
        ? {
            id: household.id,
            name: household.name,
            email: household.email,
            phone: household.phone,
          }
        : null,
    } satisfies CheckinCandidate;
  });
}

export function getChargeableLineItems(candidates: CheckinCandidate[]) {
  return candidates.flatMap((candidate) =>
    candidate.membership_applied
      ? []
      : candidate.lineItems.filter((item) => item.price_cents > 0)
  );
}

export function getCheckinTotalCents(candidates: CheckinCandidate[]) {
  return getChargeableLineItems(candidates).reduce(
    (sum, item) => sum + item.price_cents * item.quantity,
    0
  );
}
