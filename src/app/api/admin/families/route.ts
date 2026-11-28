import { requireStaffContext } from '@/lib/authz';
import { US_CITIES_BY_STATE, type UsStateCode } from '@/lib/us-cities';
import { getWaiverStatus, WAIVER_STATUS_SELECT, type WaiverRow } from '@/lib/waivers';
import { getStaffFamilySearchAliases } from '@/lib/staff-family-search';
import { readFamilyDirectoryRows } from '@/lib/family-directory';

type HouseholdRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
};
type PersonRow = { id: string; household_id: string; first_name: string | null; last_name: string | null; role: 'adult' | 'child' | null; created_at?: string };

function normalizeCityName(input: string) {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function isKnownCity(city: string | null, state: string | null) {
  if (!city || !state || !(state in US_CITIES_BY_STATE)) return false;
  const cities = US_CITIES_BY_STATE[state as UsStateCode] ?? [];
  const normalizedCity = normalizeCityName(city);
  return cities.some((name) => normalizeCityName(name) === normalizedCity);
}

export async function GET(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  const query = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  const admin = context.admin;
  let aliases: Map<string, string>;
  try { aliases = await getStaffFamilySearchAliases(admin); }
  catch { return Response.json({ ok: false, error: 'Unable to load family directory links.' }, { status: 503 }); }

  type MemberRow = { household_id: string; user_id: string | null };
  type MembershipRow = { household_id: string | null; person_id: string | null; renews_at: string | null };
  type FamilyWaiverRow = WaiverRow & { household_id: string };
  type RoleRow = { id: string; role: string };
  type ExtraRoleRow = { user_id: string; role: string };
  let households: (HouseholdRow & { created_at: string })[], people: PersonRow[], members: MemberRow[],
    memberships: MembershipRow[], waivers: FamilyWaiverRow[], roles: RoleRow[], extraRoles: ExtraRoleRow[];
  try {
    [households, people, members, memberships, waivers, roles, extraRoles] = await Promise.all([
      readFamilyDirectoryRows<HouseholdRow & { created_at: string }>(admin, 'households', 'id,name,phone,email,city,state,created_at'),
      readFamilyDirectoryRows<PersonRow>(admin, 'people', 'id,household_id,first_name,last_name,role,created_at'),
      readFamilyDirectoryRows<MemberRow>(admin, 'household_members', 'household_id,user_id'),
      readFamilyDirectoryRows<MembershipRow>(admin, 'memberships', 'household_id,person_id,renews_at'),
      readFamilyDirectoryRows<FamilyWaiverRow>(admin, 'waivers', `household_id,${WAIVER_STATUS_SELECT}`),
      readFamilyDirectoryRows<RoleRow>(admin, 'roles', 'id,role'),
      readFamilyDirectoryRows<ExtraRoleRow>(admin, 'user_roles', 'user_id,role', 'user_id'),
    ]);
  } catch { return Response.json({ ok: false, error: 'Unable to load family directory. Please try again.' }, { status: 503 }); }
  people.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id));

  const canonicalId = (id: string) => aliases.get(id) ?? id;
  const householdIds = new Set(households.map(row => row.id));
  if ([...aliases].some(([source, target]) => !householdIds.has(source) || !householdIds.has(target))) {
    return Response.json({ ok: false, error: 'Family directory links require review.' }, { status: 503 });
  }
  const internalRoles = new Set(['owner', 'admin', 'staff', 'instructor']);
  const internalUsers = new Set([
    ...roles.filter(row => internalRoles.has(row.role)).map(row => row.id),
    ...extraRoles.filter(row => internalRoles.has(row.role)).map(row => row.user_id),
  ]);
  const internalFamilies = new Set(members.filter(row => row.user_id && internalUsers.has(row.user_id)).map(row => canonicalId(row.household_id)));
  const customerHouseholds = households.filter(row => !aliases.has(row.id) && !internalFamilies.has(row.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  const customerIds = new Set(customerHouseholds.map(row => row.id));
  const linkedIds = new Set(members.filter(row => row.user_id).map(row => canonicalId(row.household_id)).filter(id => customerIds.has(id)));
  const childrenIds = new Set(people.filter(row => row.role === 'child').map(row => canonicalId(row.household_id)).filter(id => customerIds.has(id)));
  const total = customerIds.size;
  const linkedFamilies = linkedIds.size;
  const familiesWithChildren = childrenIds.size;

  const peopleByHousehold = new Map<string, PersonRow[]>();
  people.forEach((p) => {
    const arr = peopleByHousehold.get(p.household_id) ?? [];
    arr.push(p);
    peopleByHousehold.set(p.household_id, arr);
  });

  const now = new Date().toISOString();
  const membershipByHousehold = new Map<string, boolean>();
  memberships.forEach((m) => {
    const householdId = m.household_id || people.find(person => person.id === m.person_id)?.household_id;
    if (!householdId) return;
    const active = !m.renews_at || m.renews_at > now;
    if (active) membershipByHousehold.set(canonicalId(householdId), true);
  });

  const waiversByHousehold = new Map<string, WaiverRow[]>();
  waivers.forEach((w) => {
    if (!w.household_id) return;
    const arr = waiversByHousehold.get(w.household_id) ?? [];
    arr.push(w);
    waiversByHousehold.set(w.household_id, arr);
  });

  const normalized = query.toLowerCase();

  const matches = customerHouseholds
    .map((household) => {
      const familyPeople = peopleByHousehold.get(household.id) ?? [];
      const adults = familyPeople.filter((p) => p.role !== 'child');
      const children = familyPeople.filter((p) => p.role === 'child');
      const guardianName = adults[0] ? `${adults[0].first_name ?? ''} ${adults[0].last_name ?? ''}`.trim() : household.name ?? 'Unnamed family';
      return {
        household_id: household.id,
        household_name: household.name,
        guardian_name: guardianName || household.name || 'Unnamed family',
        phone: household.phone,
        email: household.email,
        city: household.city,
        state: household.state,
        location_needs_review: Boolean(household.city && !isKnownCity(household.city, household.state)),
        children_names: children.map((p) => `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()).filter(Boolean),
        membership_status: membershipByHousehold.get(household.id) ? 'active' : 'none',
        waiver_status: getWaiverStatus(waiversByHousehold.get(household.id) ?? [], new Date(), children.map(child => child.id)).status,
      };
    })
    .filter((item) => {
      if (!normalized) return true;
      const haystack = [
        item.guardian_name,
        item.household_name,
        item.phone,
        item.email,
        item.city,
        item.state,
        ...item.children_names,
        ...households.filter(row => aliases.get(row.id) === item.household_id)
          .flatMap(row => [row.name, row.email, row.phone, ...(peopleByHousehold.get(row.id) ?? []).map(person => `${person.first_name ?? ''} ${person.last_name ?? ''}`)]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalized);
    });
  const items = matches.slice(0, 100);

  return Response.json({ ok: true, items, total, linked_families: linkedFamilies, guest_families: total - linkedFamilies,
    families_with_children: familiesWithChildren, matching_families: matches.length, duplicate_records_grouped: aliases.size });
}
