import { requireOwnerContext } from '@/lib/authz';
import { isUuid } from '@/lib/open-play-reservations';
import { readPrivatePartyConflicts } from '@/lib/private-party-open-play';

export const dynamic = 'force-dynamic';
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const { id } = await params;
  if (!isUuid(id)) return reply({ ok: false, error: 'Invalid party booking.' }, 400);
  const body = await req.json().catch(() => null);
  if (typeof body?.is_private !== 'boolean' || typeof body?.expected_is_private !== 'boolean'
    || typeof body?.expected_start_time !== 'string' || !Number.isFinite(Date.parse(body.expected_start_time))) {
    return reply({ ok: false, error: 'Refresh the party before changing its private setting.' }, 400);
  }
  try {
    const current = await context.admin.from('party_bookings').select('id,start_time,end_time,status,is_private').eq('id', id).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) return reply({ ok: false, error: 'Party booking not found.' }, 404);
    const party = current.data;
    if (party.status === 'cancelled' || Date.parse(party.end_time) <= Date.now()) return reply({ ok: false, error: 'Completed or cancelled parties cannot be changed.' }, 409);
    if (party.is_private !== body.expected_is_private || Date.parse(party.start_time) !== Date.parse(body.expected_start_time)) return reply({ ok: false, error: 'This party changed. Refresh and try again.' }, 409);
    const saved = await context.admin.from('party_bookings').update({ is_private: body.is_private, updated_at: new Date().toISOString() })
      .eq('id', id).eq('is_private', party.is_private).eq('start_time', party.start_time).eq('end_time', party.end_time).eq('status', party.status)
      .select('id,start_time,end_time,is_private').maybeSingle();
    if (saved.error) throw saved.error;
    if (!saved.data) return reply({ ok: false, error: 'This party changed while saving. Refresh and try again.' }, 409);
    let conflicts: Awaited<ReturnType<typeof readPrivatePartyConflicts>> = [];
    let conflicts_available = true;
    if (saved.data.is_private) {
      try { conflicts = await readPrivatePartyConflicts(context.admin, saved.data.start_time); }
      catch { conflicts_available = false; }
    }
    return reply({ ok: true, item: saved.data, conflicts, conflicts_available });
  } catch {
    return reply({ ok: false, error: 'Unable to save the private party setting. Please refresh and try again.' }, 503);
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const { id } = await params;
  if (!isUuid(id)) return reply({ ok: false, error: 'Invalid party booking.' }, 400);
  try {
    const result = await context.admin.from('party_bookings').select('id,start_time,end_time,status,is_private').eq('id', id).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return reply({ ok: false, error: 'Party booking not found.' }, 404);
    const conflicts = result.data.is_private && result.data.status !== 'cancelled' ? await readPrivatePartyConflicts(context.admin, result.data.start_time) : [];
    return reply({ ok: true, item: result.data, conflicts, conflicts_available: true });
  } catch { return reply({ ok: false, error: 'Unable to read existing Open Play reservations.' }, 503); }
}
