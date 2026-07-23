import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { callOccupancyRpc } from '@/lib/occupancy';
import { requireStaffContext } from '@/lib/authz';
import { loadCheckinCandidates } from '@/lib/checkin-flow';

type PaymentStatus = 'membership' | 'prepaid' | 'walkin_paid' | 'square_pos_paid' | 'included';

type CheckinBody = {
  mode?: 'preview' | 'finalize';
  person_id?: string;
  person_ids?: string[];
  source?: string;
  group_size?: number;
  created_by_user_id?: string;
  created_by_role?: string;
  payment_status?: PaymentStatus;
  session_id?: string;
  square_pos_transaction_id?: string | null;
  square_pos_client_transaction_id?: string | null;
};

function personIdsFromBody(body: CheckinBody) {
  if (Array.isArray(body.person_ids) && body.person_ids.length > 0) return body.person_ids;
  return body.person_id ? [body.person_id] : [];
}

function normalizePaymentStatus(input: unknown): PaymentStatus | null {
  if (
    input === 'membership' ||
    input === 'prepaid' ||
    input === 'walkin_paid' ||
    input === 'square_pos_paid' ||
    input === 'included'
  ) {
    return input;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const body = (await req.json()) as CheckinBody;
    const mode = body.mode ?? 'finalize';
    const personIds = personIdsFromBody(body);

    if (personIds.length === 0) {
      return Response.json({ ok: false, error: 'person_id required' }, { status: 400 });
    }

    const candidates = await loadCheckinCandidates(context.admin, personIds);

    if (mode === 'preview') {
      return Response.json({
        ok: true,
        candidates,
        candidate: candidates[0] ?? null,
      });
    }

    const requestedPaymentStatus = normalizePaymentStatus(body.payment_status);
    const hasChargeableGuests = candidates.some((candidate) => !candidate.membership_applied && candidate.price_cents > 0);
    if (hasChargeableGuests && !requestedPaymentStatus) {
      return Response.json({ ok: false, error: 'payment_status required' }, { status: 400 });
    }

    const sessionId = body.session_id || crypto.randomUUID();
    const source = body.source ?? 'qr';

    const rows = candidates.map((candidate) => {
      const rowPaymentStatus: PaymentStatus = candidate.membership_applied
        ? 'membership'
        : candidate.price_cents <= 0
          ? 'included'
          : requestedPaymentStatus ?? 'walkin_paid';

      return {
        person_id: candidate.person_id,
        household_id: candidate.household_id,
        child_id: candidate.role === 'child' ? candidate.person_id : null,
        created_by_user_id: body.created_by_user_id ?? context.user.id,
        created_by_role: body.created_by_role ?? context.role ?? 'owner',
        source,
        price_cents: rowPaymentStatus === 'included' ? 0 : candidate.price_cents,
        membership_applied: candidate.membership_applied,
        notes: body.square_pos_transaction_id
          ? `session=${sessionId}; square_pos_transaction_id=${body.square_pos_transaction_id}`
          : `session=${sessionId}`,
        checkin_session_id: sessionId,
        payment_status: rowPaymentStatus,
        square_pos_transaction_id: body.square_pos_transaction_id ?? null,
        square_pos_client_transaction_id: body.square_pos_client_transaction_id ?? null,
        payment_recorded_at: rowPaymentStatus === 'included' ? null : new Date().toISOString(),
      };
    });

    const { data: inserted, error: insertError } = await context.admin
      .from('checkins')
      .insert(rows)
      .select('id');

    if (insertError) {
      return Response.json({ ok: false, error: 'insert failed' }, { status: 500 });
    }

    const occupancyDelta = Math.max(
      1,
      Math.trunc(Number(body.group_size) || candidates.length || 1)
    );

    try {
      await callOccupancyRpc(context.admin, 'record_checkin', occupancyDelta);
    } catch {
      const insertedIds = (inserted ?? []).map((row: { id: string }) => row.id);
      if (insertedIds.length > 0) {
        await context.admin.from('checkins').delete().in('id', insertedIds);
      }
      return Response.json({ ok: false, error: 'occupancy update failed' }, { status: 500 });
    }

    return Response.json({
      ok: true,
      session_id: sessionId,
      checkin_ids: (inserted ?? []).map((row: { id: string }) => row.id),
      checkin_id: inserted?.[0]?.id,
      candidates,
      membership_applied: candidates.every((candidate) => candidate.membership_applied),
      price_cents: candidates.reduce((sum, candidate) => sum + candidate.price_cents, 0),
      first_name: candidates[0]?.first_name ?? null,
      last_name: candidates[0]?.last_name ?? null,
      birthdate: candidates[0]?.birthdate ?? null,
      lineItems: candidates.flatMap((candidate) => candidate.lineItems),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const status = message.includes('not found') ? 404 : message.includes('pricing') ? 422 : 500;
    return Response.json({ ok: false, error: message }, { status });
  }
}
