import { requireStaffContext } from '@/lib/authz';

type HouseholdRow = { id: string; name: string | null; phone: string | null };
type PersonRow = { household_id: string; first_name: string | null; last_name: string | null; role: 'adult' | 'child' | null };

export async function GET(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  const query = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  const admin = context.admin;

  const [{ data: households }, { data: people }, { data: memberships }, { data: waivers }] = await Promise.all([
    admin.from('households').select('id,name,phone').order('created_at', { ascending: false }).limit(400),
    admin.from('people').select('household_id,first_name,last_name,role').order('created_at', { ascending: true }).limit(2000),
    admin.from('memberships').select('household_id,renews_at').limit(2000),
    admin.from('waivers').select('household_id,signed_at').limit(2000),
  ]);

  const peopleByHousehold = new Map<string, PersonRow[]>();
  ((people ?? []) as PersonRow[]).forEach((p) => {
    const arr = peopleByHousehold.get(p.household_id) ?? [];
    arr.push(p);
    peopleByHousehold.set(p.household_id, arr);
  });

  const now = new Date().toISOString();
  const membershipByHousehold = new Map<string, boolean>();
  (memberships ?? []).forEach((m) => {
    if (!m.household_id) return;
    const active = !m.renews_at || m.renews_at > now;
    if (active) membershipByHousehold.set(m.household_id, true);
  });

  const waiverByHousehold = new Map<string, boolean>();
  (waivers ?? []).forEach((w) => {
    if (!w.household_id) return;
    if (w.signed_at) waiverByHousehold.set(w.household_id, true);
  });

  const normalized = query.toLowerCase();

  const items = ((households ?? []) as HouseholdRow[])
    .map((household) => {
      const familyPeople = peopleByHousehold.get(household.id) ?? [];
      const adults = familyPeople.filter((p) => p.role !== 'child');
      const children = familyPeople.filter((p) => p.role === 'child');
      const guardianName = adults[0] ? `${adults[0].first_name ?? ''} ${adults[0].last_name ?? ''}`.trim() : household.name ?? 'Unnamed family';
      const email = null;

      return {
        household_id: household.id,
        household_name: household.name,
        guardian_name: guardianName || household.name || 'Unnamed family',
        phone: household.phone,
        email,
        children_names: children.map((p) => `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()).filter(Boolean),
        membership_status: membershipByHousehold.get(household.id) ? 'active' : 'none',
        waiver_status: waiverByHousehold.get(household.id) ? 'signed' : 'missing',
      };
    })
    .filter((item) => {
      if (!normalized) return true;
      const haystack = [
        item.guardian_name,
        item.household_name,
        item.phone,
        item.email,
        ...item.children_names,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalized);
    })
    .slice(0, 100);

  return Response.json({ ok: true, items });
}
