import { requireStaffContext } from '@/lib/authz';

type Params = { params: { id: string } };

export async function POST(req: Request, { params }: Params) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  const { id: householdId } = params;
  const { class_id, person_id } = await req.json();

  if (!class_id || !person_id) {
    return Response.json({ ok: false, error: 'class_id and person_id are required' }, { status: 400 });
  }

  const admin = context.admin;
  const { data: person } = await admin
    .from('people')
    .select('id,household_id,role')
    .eq('id', person_id)
    .eq('household_id', householdId)
    .maybeSingle();

  if (!person) return Response.json({ ok: false, error: 'person not found in this household' }, { status: 404 });

  const { data: klass } = await admin.from('classes').select('id,capacity,status,title').eq('id', class_id).maybeSingle();
  if (!klass) return Response.json({ ok: false, error: 'class not found' }, { status: 404 });
  if (klass.status !== 'scheduled') return Response.json({ ok: false, error: 'class is not open for booking' }, { status: 409 });

  const { data: existing } = await admin
    .from('class_registrations')
    .select('id,status')
    .eq('class_id', class_id)
    .eq('person_id', person_id)
    .maybeSingle();

  if (existing && existing.status !== 'cancelled') {
    return Response.json({ ok: false, error: 'already registered' }, { status: 409 });
  }

  if (klass.capacity != null) {
    const { count } = await admin
      .from('class_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('class_id', class_id)
      .neq('status', 'cancelled');

    if ((count ?? 0) >= klass.capacity) {
      return Response.json({ ok: false, error: 'class is full' }, { status: 409 });
    }
  }

  if (existing && existing.status === 'cancelled') {
    const { error } = await admin
      .from('class_registrations')
      .update({
        status: 'scheduled',
        household_id: householdId,
        child_id: person.role === 'child' ? person.id : null,
        created_by_user_id: context.user.id,
        created_by_role: 'owner',
      })
      .eq('id', existing.id);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, id: existing.id, restored: true });
  }

  const { data, error } = await admin
    .from('class_registrations')
    .insert({
      class_id,
      person_id,
      status: 'scheduled',
      household_id: householdId,
      child_id: person.role === 'child' ? person.id : null,
      created_by_user_id: context.user.id,
      created_by_role: 'owner',
    })
    .select('id')
    .maybeSingle();

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, id: data?.id ?? null });
}
