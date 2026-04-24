import { requireStaffContext } from '@/lib/authz';
import crypto from 'crypto';
import { buildPrePopulatedData, logSquarePayload } from '@/lib/square';

type Params = { params: { id: string } };

type MembershipBody = {
  action?: 'create_payment_link' | 'finalize_start' | 'pause' | 'end';
  notes?: string;
};

function getSquareBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT ?? process.env.SQUARE_ENV ?? 'sandbox').toLowerCase();
  return env === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
}

export async function POST(req: Request, { params }: Params) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  const householdId = params.id;
  const body = (await req.json()) as MembershipBody;
  const action = body.action;
  if (!action) return Response.json({ ok: false, error: 'action is required' }, { status: 400 });

  const admin = context.admin;

  const insertEvent = async (membershipId: string | null, eventAction: string, notes?: string) => {
    await admin.from('membership_events').insert({
      household_id: householdId,
      membership_id: membershipId,
      action: eventAction,
      notes: notes ?? null,
      created_by_user_id: context.user.id,
      created_by_role: 'owner',
    });
  };

  if (action === 'create_payment_link') {
    if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID || !process.env.SQUARE_PLAN_VARIATION_ID) {
      return Response.json({ ok: false, error: 'Square membership payment is not configured' }, { status: 500 });
    }

    const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const redirectUrl = `${base}/staff/families/${householdId}/membership?membership_checkout=success`;

    const payload = {
      idempotency_key: crypto.randomUUID(),
      quick_pay: {
        name: 'Little Wanderers Monthly Membership',
        price_money: {
          amount: 6000,
          currency: 'USD',
        },
        location_id: process.env.SQUARE_LOCATION_ID,
      },
      checkout_options: {
        subscription_plan_id: process.env.SQUARE_PLAN_VARIATION_ID,
        redirect_url: redirectUrl,
        ask_for_shipping_address: false,
      },
      ...(buildPrePopulatedData(null) ? { pre_populated_data: buildPrePopulatedData(null) } : {}),
      reference_id: `staff_membership_${householdId}`,
    };

    logSquarePayload('staff membership checkout payload', payload as Record<string, unknown>, {
      householdId,
      userId: context.user.id,
    });

    const resp = await fetch(`${getSquareBaseUrl()}/v2/online-checkout/payment-links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2025-10-16',
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return Response.json({ ok: false, error: `square_error: ${text}` }, { status: 500 });
    }

    const data = await resp.json();
    return Response.json({ ok: true, url: data?.payment_link?.url ?? null });
  }

  if (action === 'finalize_start') {
    const renewsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();

    const { data: existing } = await admin
      .from('memberships')
      .select('id')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let membershipId: string | null = null;

    if (existing?.id) {
      const { error } = await admin
        .from('memberships')
        .update({ renews_at: renewsAt })
        .eq('id', existing.id);
      if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
      membershipId = existing.id;
    } else {
      const { data, error } = await admin
        .from('memberships')
        .insert({ household_id: householdId, renews_at: renewsAt })
        .select('id')
        .maybeSingle();
      if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
      membershipId = data?.id ?? null;
    }

    await insertEvent(membershipId, 'start', body.notes);
    return Response.json({ ok: true });
  }

  if (action === 'pause') {
    const { data: membership } = await admin
      .from('memberships')
      .select('id')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!membership?.id) return Response.json({ ok: false, error: 'No membership to pause' }, { status: 404 });

    const { error } = await admin
      .from('memberships')
      .update({ renews_at: new Date().toISOString() })
      .eq('id', membership.id);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

    await insertEvent(membership.id, 'pause', body.notes);
    return Response.json({ ok: true });
  }

  if (action === 'end') {
    const { data: membership } = await admin
      .from('memberships')
      .select('id')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!membership?.id) return Response.json({ ok: false, error: 'No membership to end' }, { status: 404 });

    const { error } = await admin.from('memberships').delete().eq('id', membership.id);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

    await insertEvent(membership.id, 'end', body.notes);
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: 'Unsupported action' }, { status: 400 });
}
