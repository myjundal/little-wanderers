import { requireStaffContext } from '@/lib/authz';

type Params = { params: { id: string } };

type MemberInput = {
  id?: string;
  first_name: string;
  last_name?: string | null;
  birthdate?: string | null;
  role: 'adult' | 'child';
};

export async function PUT(req: Request, { params }: Params) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  const householdId = params.id;
  const body = (await req.json()) as { members?: MemberInput[] };
  const members = Array.isArray(body.members) ? body.members : [];

  const cleaned = members
    .map((m) => ({
      id: m.id,
      first_name: String(m.first_name ?? '').trim(),
      last_name: m.last_name ? String(m.last_name).trim() : null,
      birthdate: m.birthdate ? String(m.birthdate) : null,
      role: m.role === 'child' ? 'child' : 'adult',
    }))
    .filter((m) => m.first_name.length > 0);

  if (cleaned.length === 0) {
    return Response.json({ ok: false, error: 'At least one member is required.' }, { status: 400 });
  }

  const admin = context.admin;
  const { data: existing } = await admin.from('people').select('id').eq('household_id', householdId);
  const incomingIds = new Set(cleaned.map((m) => m.id).filter(Boolean));
  const toDelete = (existing ?? []).map((row) => row.id).filter((id) => !incomingIds.has(id));

  for (const member of cleaned) {
    if (member.id) {
      const { error } = await admin
        .from('people')
        .update({
          first_name: member.first_name,
          last_name: member.last_name,
          birthdate: member.birthdate,
          role: member.role,
        })
        .eq('id', member.id)
        .eq('household_id', householdId);
      if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    } else {
      const { error } = await admin.from('people').insert({
        household_id: householdId,
        first_name: member.first_name,
        last_name: member.last_name,
        birthdate: member.birthdate,
        role: member.role,
      });
      if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  if (toDelete.length) {
    const { error } = await admin.from('people').delete().in('id', toDelete);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
