import { requireStaffContext } from '@/lib/authz';

export async function POST(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  const body = await req.json();
  const person_id = body.person_id as string | undefined;
  if (!person_id) return Response.json({ ok: false, error: 'person_id required' }, { status: 400 });

  const res = await fetch(new URL('/api/checkin', req.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ person_id, source: 'staff_manual', created_by_user_id: context.user.id, created_by_role: 'owner' }),
  });

  const json = await res.json();
  return Response.json(json, { status: res.status });
}
