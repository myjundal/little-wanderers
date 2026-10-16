import { requireOwnerContext } from '@/lib/authz';
import { sameOrigin } from '@/lib/staff-kiosk';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const [classesResult, assignmentsResult, coursesResult, notesResult] = await Promise.all([
    context.admin.from('classes').select('id,title,start_time').order('start_time'),
    context.admin.from('class_instructors').select('class_id,user_id'),
    context.admin.from('class_course_instructors').select('class_title,user_id'),
    context.admin.from('class_instructor_notes').select('class_id,note'),
  ]);
  if (classesResult.error || assignmentsResult.error || coursesResult.error) return Response.json({ ok: false, error: 'Class instructor setup is not ready. Run the class-course instructor migration.' }, { status: 503 });
  const { data: notes, error: noteError } = notesResult;
  if (noteError && !['42P01', 'PGRST205'].includes(noteError.code)) return Response.json({ ok: false, error: 'Unable to load private class notes.' }, { status: 500 });
  const classes = classesResult.data ?? [];
  const assignments = assignmentsResult.data ?? [];
  const courses = coursesResult.data ?? [];
  const notesByClass = new Map((notes ?? []).map(row => [row.class_id, row.note]));
  const users = new Map<string, string>();
  for (const id of new Set([...assignments.map(row => row.user_id), ...courses.map(row => row.user_id)])) {
    const { data, error } = await context.admin.auth.admin.getUserById(id);
    if (error) return Response.json({ ok: false, error: 'Unable to load instructor accounts.' }, { status: 500 });
    users.set(id, data.user?.email ?? id);
  }
  const titles = [...new Set(classes.map(row => row.title))].sort((a,b) => a.localeCompare(b));
  return Response.json({
    ok: true, notes_ready: !noteError,
    classes: classes.map(klass => ({ ...klass, instructor_note: notesByClass.get(klass.id) ?? null })),
    courses: titles.map(title => {
      const course = courses.find(row => row.class_title === title);
      const sessions = classes.filter(row => row.title === title);
      const ids = new Set(sessions.map(row => row.id));
      return { title, session_count: sessions.length, user_id: course?.user_id ?? null, email: course ? users.get(course.user_id) : '', has_session_assignments: !course && assignments.some(row => ids.has(row.class_id)) };
    }),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ ok: false, error: 'Invalid request origin.' }, { status: 403 });
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  let body: { class_id?: string; course_title?: string; email?: string; action?: string; note?: string };
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: 'Invalid request.' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return Response.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  if (body.action === 'note') {
    if (!body.class_id || typeof body.note !== 'string' || body.note.length > 4000) return Response.json({ ok: false, error: 'Session and note (up to 4,000 characters) are required.' }, { status: 400 });
    const { data: klass, error: classError } = await context.admin.from('classes').select('id').eq('id', body.class_id).maybeSingle();
    if (classError || !klass) return Response.json({ ok: false, error: 'Class not found.' }, { status: 404 });
    const { error } = await context.admin.from('class_instructor_notes').upsert({ class_id: body.class_id, note: body.note.trim() });
    return Response.json({ ok: !error, error: error ? 'Unable to save private session notes.' : undefined }, { status: error ? 500 : 200 });
  }
  if (!['assign_course','remove_course'].includes(body.action ?? '') || typeof body.course_title !== 'string' || !body.course_title.trim()) return Response.json({ ok: false, error: 'Choose a class and refresh this page before assigning its instructor.' }, { status: 400 });
  const title = body.course_title;
  const { data: klass, error: classError } = await context.admin.from('classes').select('id').eq('title', title).limit(1).maybeSingle();
  if (classError || !klass) return Response.json({ ok: false, error: 'Class not found.' }, { status: 404 });
  let userId: string | null = null;
  if (body.action === 'assign_course') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ ok: false, error: 'Enter the instructor’s account email.' }, { status: 400 });
    for (let page = 1; ; page++) {
      const { data, error } = await context.admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return Response.json({ ok: false, error: 'Unable to find account.' }, { status: 500 });
      userId = data.users.find(user => user.email?.toLowerCase() === email)?.id ?? null;
      if (userId || data.users.length < 1000) break;
    }
    if (!userId) return Response.json({ ok: false, error: 'Account not found. Invite the instructor in Staff & Timecards first, or ask them to sign up.' }, { status: 404 });
  }
  const { data, error } = await context.admin.rpc('set_class_course_instructor', { p_class_title: title, p_user_id: userId });
  if (error) return Response.json({ ok: false, error: 'Unable to save the class instructor. Check the class-course migration.' }, { status: 503 });
  return Response.json(data, { status: data?.ok ? 200 : 409 });
}
