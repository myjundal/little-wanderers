import { requireOwnerContext } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const [{ data: classes, error: classError }, { data: assignments, error }] = await Promise.all([
    context.admin.from('classes').select('id,title,start_time,instructor_note').order('start_time'),
    context.admin.from('class_instructors').select('class_id,user_id'),
  ]);
  if (error || classError) return Response.json({ ok: false, error: 'Run the instructor access migration before assigning instructors.' }, { status: 500 });
  const users = new Map<string, string>();
  for (const id of new Set((assignments ?? []).map(row => row.user_id))) {
    const { data, error: userError } = await context.admin.auth.admin.getUserById(id);
    if (userError) return Response.json({ ok: false, error: 'Unable to load instructor accounts.' }, { status: 500 });
    users.set(id, data.user?.email ?? id);
  }
  return Response.json({ ok: true, classes, assignments: (assignments ?? []).map(row => ({ ...row, email: users.get(row.user_id) })) });
}

export async function POST(req: Request) {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  let body: { class_id?: string; email?: string; user_id?: string; action?: string; note?: string };
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: 'Invalid request.' }, { status: 400 }); }
  const { class_id, action } = body;
  if (!class_id || !['assign', 'remove', 'note'].includes(action ?? '')) return Response.json({ ok: false, error: 'Class and valid action are required.' }, { status: 400 });
  const { data: klass, error: classError } = await context.admin.from('classes').select('id').eq('id', class_id).maybeSingle();
  if (classError || !klass) return Response.json({ ok: false, error: 'Class not found.' }, { status: 404 });
  if (action === 'note') {
    if (typeof body.note !== 'string' || body.note.length > 4000) return Response.json({ ok: false, error: 'Note must be at most 4,000 characters.' }, { status: 400 });
    const { error } = await context.admin.from('classes').update({ instructor_note: body.note.trim() || null }).eq('id', class_id);
    return Response.json({ ok: !error, error: error?.message }, { status: error ? 500 : 200 });
  }
  if (action === 'remove') {
    if (!body.user_id) return Response.json({ ok: false, error: 'Instructor is required.' }, { status: 400 });
    const { error } = await context.admin.from('class_instructors').delete().eq('class_id', class_id).eq('user_id', body.user_id);
    return Response.json({ ok: !error, error: error?.message }, { status: error ? 500 : 200 });
  }
  const email = body.email?.trim().toLowerCase();
  if (!email) return Response.json({ ok: false, error: 'Instructor email is required.' }, { status: 400 });
  let userId: string | undefined;
  for (let page = 1; ; page++) {
    const { data, error } = await context.admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return Response.json({ ok: false, error: 'Unable to find account.' }, { status: 500 });
    userId = data.users.find(user => user.email?.toLowerCase() === email)?.id;
    if (userId || data.users.length < 1000) break;
  }
  if (!userId) return Response.json({ ok: false, error: 'Account not found. Ask the instructor to sign up first.' }, { status: 404 });
  const { error: roleError } = await context.admin.from('user_roles').upsert({ user_id: userId, role: 'instructor' });
  if (roleError) return Response.json({ ok: false, error: roleError.message }, { status: 500 });
  const { error } = await context.admin.from('class_instructors').upsert({ class_id, user_id: userId });
  return Response.json({ ok: !error, error: error?.message }, { status: error ? 500 : 200 });
}
