import { requireStaffContext } from '@/lib/authz';
import crypto from 'crypto';
import { buildPrePopulatedData, logSquarePayload } from '@/lib/square';

type Params = { params: { id: string } };
type CheckoutBody = { person_id?: string; items?: Array<{ class_id: string; quantity?: number }>; mode?: 'create_payment_link' | 'finalize' };

function getSquareBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT ?? process.env.SQUARE_ENV ?? 'sandbox').toLowerCase();
  return env === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
}

export async function POST(req: Request, { params }: Params) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  const householdId = params.id;
  const body = (await req.json()) as CheckoutBody;
  const mode = body.mode ?? 'create_payment_link';
  const personId = body.person_id;
  const items = (body.items ?? [])
    .filter((item) => item.class_id)
    .map((item) => ({ class_id: item.class_id, quantity: Math.max(1, Number(item.quantity ?? 1)) }));

  if (!personId || items.length === 0) {
    return Response.json({ ok: false, error: 'person_id and items are required' }, { status: 400 });
  }

  const admin = context.admin;
  const { data: people } = await admin.from('people').select('id,role').eq('household_id', householdId).order('created_at', { ascending: true });
  const peopleRows = people ?? [];
  if (!peopleRows.some((p) => p.id === personId)) {
    return Response.json({ ok: false, error: 'person not found in household' }, { status: 404 });
  }

  const classIds = items.map((item) => item.class_id);
  const { data: classes, error: classError } = await admin.from('classes').select('id,title,capacity,status,price_cents').in('id', classIds);
  if (classError) return Response.json({ ok: false, error: classError.message }, { status: 500 });
  const classById = new Map((classes ?? []).map((c) => [c.id, c]));

  if (mode === 'finalize') {
    const registrationIds: string[] = [];

    for (const item of items) {
      const klass = classById.get(item.class_id);
      if (!klass || klass.status !== 'scheduled') return Response.json({ ok: false, error: 'class not available' }, { status: 409 });

      const { count } = await admin
        .from('class_registrations')
        .select('id', { count: 'exact', head: true })
        .eq('class_id', item.class_id)
        .neq('status', 'cancelled');

      if (klass.capacity != null && (count ?? 0) + item.quantity > klass.capacity) {
        return Response.json({ ok: false, error: `${klass.title} does not have enough seats` }, { status: 409 });
      }

      const eligiblePeople = peopleRows.slice(0, item.quantity);
      for (const person of eligiblePeople) {
        const { data, error } = await admin
          .from('class_registrations')
          .insert({
            class_id: item.class_id,
            person_id: person.id,
            status: 'scheduled',
            household_id: householdId,
            child_id: person.role === 'child' ? person.id : null,
            created_by_user_id: context.user.id,
            created_by_role: 'owner',
          })
          .select('id')
          .maybeSingle();
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        if (data?.id) registrationIds.push(data.id);
      }
    }

    return Response.json({ ok: true, checkout_summary: { registration_ids: registrationIds } });
  }

  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
    return Response.json({ ok: false, error: 'Square payment is not configured' }, { status: 500 });
  }

  const total = items.reduce((sum, item) => sum + (classById.get(item.class_id)?.price_cents ?? 0) * item.quantity, 0);
  if (total <= 0) return Response.json({ ok: false, error: 'total must be greater than 0' }, { status: 409 });

  const lineItems = items.map((item) => ({
    name: classById.get(item.class_id)?.title ?? 'Class',
    quantity: String(item.quantity),
    base_price_money: { amount: classById.get(item.class_id)?.price_cents ?? 0, currency: 'USD' },
  }));

  const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const redirectParams = new URLSearchParams({
    class_checkout: 'success',
    person_id: personId,
    items: items.map((item) => `${item.class_id}:${item.quantity}`).join(','),
  });
  const redirectUrl = `${base}/staff/families/${householdId}?${redirectParams.toString()}`;

  const squareBody = {
    idempotency_key: crypto.randomUUID(),
    order: { location_id: process.env.SQUARE_LOCATION_ID, line_items: lineItems },
    checkout_options: { redirect_url: redirectUrl, ask_for_shipping_address: false },
    ...(buildPrePopulatedData(null) ? { pre_populated_data: buildPrePopulatedData(null) } : {}),
    reference_id: `staff_class_${crypto.randomUUID().slice(0, 12)}`,
  };

  logSquarePayload('staff class checkout payload', squareBody as Record<string, unknown>);

  const resp = await fetch(`${getSquareBaseUrl()}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2025-10-16',
    },
    body: JSON.stringify(squareBody),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return Response.json({ ok: false, error: `square_error: ${text}` }, { status: 500 });
  }

  const data = await resp.json();
  return Response.json({ ok: true, payment_url: data?.payment_link?.url, total_price_cents: total });
}
