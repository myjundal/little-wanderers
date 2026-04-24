import { requireStaffContext } from '@/lib/authz';

type Params = { params: { id: string } };

export async function POST(req: Request, { params }: Params) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  const householdId = params.id;
  const body = (await req.json()) as { action?: 'start' | 'pause' | 'end'; notes?: string };
  const action = body.action;
  if (!action) return Response.json({ ok: false, error: 'action is required' }, { status: 400 });

  const admin = context.admin;
  const { data: current } = await admin
    .from('memberships')
    .select('id')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let membershipId = current?.id ?? null;

  if (action === 'start') {
    const renewsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const { data, error } = await admin
      .from('memberships')
      .upsert({ household_id: householdId, renews_at: renewsAt }, { onConflict: 'household_id' })
      .select('id')
      .maybeSingle();
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    membershipId = data?.id ?? membershipId;
  }

  if (action === 'pause') {
    const { error } = await admin.from('memberships').update({ renews_at: new Date().toISOString() }).eq('household_id', householdId);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (action === 'end') {
    const { error } = await admin.from('memberships').delete().eq('household_id', householdId);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  await admin.from('membership_events').insert({
    household_id: householdId,
    membership_id: membershipId,
    action,
    notes: body.notes ?? null,
    created_by_user_id: context.user.id,
    created_by_role: 'owner',
  });

  return Response.json({ ok: true });
}
