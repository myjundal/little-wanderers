import { requireTeachingContext } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await requireTeachingContext();
  if (!context.ok) return context.response;
  const { data: assignments, error: assignmentError } = await context.admin.from('class_instructors').select('class_id').eq('user_id', context.user.id);
  if (assignmentError) return Response.json({ ok: false, error: 'Unable to load teaching assignments. Run the instructor migration first.' }, { status: 500 });
  const ids = (assignments ?? []).map(row => row.class_id);
  if (!ids.length) return Response.json({ ok: true, items: [] });
  const { data: classes, error: classError } = await context.admin.from('classes')
    .select('id,title,category,start_time,end_time,status,capacity,age_range,caregiver_participation,schedule_label')
    .in('id', ids).order('start_time');
  if (classError) return Response.json({ ok: false, error: 'Unable to load classes.' }, { status: 500 });
  const { data: notes, error: noteError } = await context.admin.from('class_instructor_notes').select('class_id,note').in('class_id', ids);
  if (noteError && !['42P01', 'PGRST205'].includes(noteError.code)) return Response.json({ ok: false, error: 'Unable to load private class notes.' }, { status: 500 });
  const notesByClass = new Map((notes ?? []).map(row => [row.class_id, row.note]));
  const { data: registrations, error: registrationError } = await context.admin.from('class_registrations')
    .select('id,class_id,person_id,status,attendance_status').in('class_id', ids);
  if (registrationError) return Response.json({ ok: false, error: 'Unable to load attendance.' }, { status: 500 });
  const personIds = [...new Set((registrations ?? []).map(row => row.person_id))];
  const people = new Map<string, { first_name: string | null; last_name: string | null; birthdate: string | null }>();
  if (personIds.length) {
    const { data, error } = await context.admin.from('people').select('id,first_name,last_name,birthdate').in('id', personIds);
    if (error) return Response.json({ ok: false, error: 'Unable to load class roster.' }, { status: 500 });
    for (const person of data ?? []) people.set(person.id, person);
  }
  // Only assigned-class data is returned; household, payment and contact data are excluded.
  const items = (classes ?? []).map(klass => ({ ...klass, instructor_note: notesByClass.get(klass.id) ?? null, registrants: (registrations ?? []).filter(reg => reg.class_id === klass.id).map(reg => {
    const person = people.get(reg.person_id);
    const birthdate = person?.birthdate;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    let age: number | null = null;
    if (birthdate && /^\d{4}-\d{2}-\d{2}$/.test(birthdate)) {
      age = Number(today.slice(0, 4)) - Number(birthdate.slice(0, 4)) - (today.slice(5) < birthdate.slice(5) ? 1 : 0);
      if (age < 0) age = null;
    }
    return { id: reg.id, person_id: reg.person_id, name: `${person?.first_name ?? ''} ${person?.last_name ?? ''}`.trim() || 'Unknown', age, status: reg.status, attendance_status: reg.attendance_status ?? 'unknown' };
  }).sort((a, b) => a.name.localeCompare(b.name)) }));
  return Response.json({ ok: true, items });
}
