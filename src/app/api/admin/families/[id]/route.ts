import { requireStaffContext } from '@/lib/authz';

type Params = { params: { id: string } };

export async function GET(_: Request, { params }: Params) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  const { id } = params;
  const admin = context.admin;

  const [{ data: household }, { data: people }, { data: memberships }, { data: waivers }, { data: parties }] = await Promise.all([
    admin.from('households').select('id,name,phone,created_at').eq('id', id).maybeSingle(),
    admin.from('people').select('id,first_name,last_name,birthdate,role,created_at').eq('household_id', id).order('created_at', { ascending: true }),
    admin.from('memberships').select('id,renews_at,created_at').eq('household_id', id).order('created_at', { ascending: false }),
    admin.from('waivers').select('id,signed_at,created_at').eq('household_id', id).order('created_at', { ascending: false }),
    admin.from('party_bookings').select('id,start_time,end_time,status,headcount_expected,notes,created_at').eq('household_id', id).order('start_time', { ascending: true }),
  ]);

  if (!household) {
    return Response.json({ ok: false, error: 'Family not found' }, { status: 404 });
  }

  const peopleRows = (people ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null; role: 'adult' | 'child' | null; birthdate: string | null }>;
  const { data: classRegs } = peopleRows.length
    ? await admin
        .from('class_registrations')
        .select('id,person_id,status,created_at,class:classes(id,title,start_time,end_time,status)')
        .in('person_id', peopleRows.map((p) => p.id))
        .order('created_at', { ascending: false })
    : { data: [] };
  const personNameById = new Map(peopleRows.map((p) => [p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()]));
  const now = new Date().toISOString();

  const activeMembership = (memberships ?? []).some((m) => !m.renews_at || m.renews_at > now);
  const waiverSigned = (waivers ?? []).some((w) => Boolean(w.signed_at));

  const normalizedRegs = (classRegs ?? []).map((reg) => ({
    ...reg,
    class: Array.isArray(reg.class) ? reg.class[0] ?? null : reg.class,
  }));

  const upcomingClasses = normalizedRegs
    .filter((reg) => reg.status !== 'cancelled' && reg.class?.start_time && reg.class.start_time > now)
    .map((reg) => ({
      id: reg.id,
      status: reg.status,
      person_id: reg.person_id,
      person_name: personNameById.get(reg.person_id) ?? 'Unknown',
      class: reg.class,
    }));

  const upcomingParties = (parties ?? []).filter((p) => p.start_time > now && p.status !== 'cancelled');

  const { data: checkins } = await admin
    .from('checkins')
    .select('id,person_id,checked_in_at,source,price_cents,membership_applied')
    .in('person_id', peopleRows.map((p) => p.id))
    .order('checked_in_at', { ascending: false })
    .limit(50);

  const visits = (checkins ?? []).map((visit) => ({
    ...visit,
    person_name: personNameById.get(visit.person_id) ?? 'Unknown',
  }));

  return Response.json({
    ok: true,
    item: {
      household,
      guardians: peopleRows.filter((p) => p.role !== 'child'),
      children: peopleRows.filter((p) => p.role === 'child'),
      membership_status: activeMembership ? 'active' : 'none',
      waiver_status: waiverSigned ? 'signed' : 'missing',
      qr_status: peopleRows.length > 0 ? 'available' : 'unavailable',
      upcoming_classes: upcomingClasses,
      upcoming_parties: upcomingParties,
      visit_history: visits,
    },
  });
}
