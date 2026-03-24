import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import crypto from 'crypto';

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function getSquareBaseUrl() {
  if (process.env.SQUARE_BASE_URL) return process.env.SQUARE_BASE_URL;
  const env = (process.env.SQUARE_ENVIRONMENT ?? process.env.SQUARE_ENV ?? 'sandbox').toLowerCase();
  return env === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
}

type CheckoutItem = { class_id: string; quantity?: number };

type CheckoutBody = {
  class_ids?: string[];
  items?: CheckoutItem[];
  person_id?: string;
  mode?: 'create_payment_link' | 'finalize';
};

type ClassRow = {
  id: string;
  title: string;
  capacity: number | null;
  status: string;
  price_cents: number;
};

type ExistingRegistration = {
  id: string;
  class_id: string;
  person_id: string;
  status: string;
};

type LoadedContext = {
  householdId: string;
  requestedItems: Array<{ class_id: string; quantity: number }>;
  personId: string;
  classById: Map<string, ClassRow>;
  householdPersonIds: string[];
  registrations: ExistingRegistration[];
};

function normalizeRequestedItems(body: CheckoutBody) {
  if (Array.isArray(body.items) && body.items.length > 0) {
    const byClassId = new Map<string, number>();

    body.items.forEach((item) => {
      if (!item?.class_id) return;
      const qty = Number(item.quantity ?? 1);
      const safeQty = Number.isInteger(qty) && qty > 0 ? qty : 1;
      byClassId.set(item.class_id, (byClassId.get(item.class_id) ?? 0) + safeQty);
    });

    return [...byClassId.entries()].map(([class_id, quantity]) => ({ class_id, quantity }));
  }

  const classIds = Array.isArray(body.class_ids) ? [...new Set(body.class_ids.filter(Boolean))] : [];
  return classIds.map((class_id) => ({ class_id, quantity: 1 }));
}

async function getHouseholdIdForUser(userId: string) {
  const supa = admin();
  const { data } = await supa
    .from('households')
    .select('id')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  return data?.[0]?.id ?? null;
}

async function buildAssignments(context: LoadedContext) {
  const activeByClass = new Map<string, number>();
  const regByClassPerson = new Map<string, ExistingRegistration>();

  context.registrations.forEach((reg) => {
    if (reg.status !== 'cancelled') {
      activeByClass.set(reg.class_id, (activeByClass.get(reg.class_id) ?? 0) + 1);
    }
    regByClassPerson.set(`${reg.class_id}:${reg.person_id}`, reg);
  });

  const prioritizedPeople = [
    context.personId,
    ...context.householdPersonIds.filter((id) => id !== context.personId),
  ];

  const assignments = new Map<string, Array<{ person_id: string; existing: ExistingRegistration | null }>>();

  for (const item of context.requestedItems) {
    const klass = context.classById.get(item.class_id);
    if (!klass) continue;

    if (klass.status !== 'scheduled') {
      throw new Error(`${klass.title} is not open for booking`);
    }

    if (klass.capacity != null && (activeByClass.get(item.class_id) ?? 0) + item.quantity > klass.capacity) {
      throw new Error(`${klass.title} does not have enough seats left`);
    }

    const availablePeople = prioritizedPeople
      .map((personId) => {
        const existing = regByClassPerson.get(`${item.class_id}:${personId}`) ?? null;
        if (existing && existing.status !== 'cancelled') return null;
        return { person_id: personId, existing };
      })
      .filter((entry): entry is { person_id: string; existing: ExistingRegistration | null } => Boolean(entry));

    if (availablePeople.length < item.quantity) {
      throw new Error(`${klass.title} needs ${item.quantity} participant(s), but only ${availablePeople.length} eligible person(s) found in household`);
    }

    assignments.set(item.class_id, availablePeople.slice(0, item.quantity));
  }

  return assignments;
}

async function loadAndValidate(body: CheckoutBody, userId: string): Promise<LoadedContext> {
  const requestedItems = normalizeRequestedItems(body);
  const personId = body.person_id;

  if (!personId || requestedItems.length === 0) {
    throw new Error('person_id and items are required');
  }

  const householdId = await getHouseholdIdForUser(userId);
  if (!householdId) {
    throw new Error('household not found');
  }

  const supa = admin();
  const { data: people } = await supa
    .from('people')
    .select('id')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });

  const householdPersonIds = (people ?? []).map((p) => p.id);
  if (!householdPersonIds.includes(personId)) {
    throw new Error('person not found in your household');
  }

  const classIds = requestedItems.map((item) => item.class_id);
  const { data: classes, error: classErr } = await supa
    .from('classes')
    .select('id,title,capacity,status,price_cents')
    .in('id', classIds);

  if (classErr) throw new Error(classErr.message);
  if ((classes ?? []).length !== classIds.length) {
    throw new Error('one or more classes were not found');
  }

  const classById = new Map((classes ?? []).map((item) => [item.id, item as ClassRow]));

  const { data: regs, error: regErr } = await supa
    .from('class_registrations')
    .select('id,class_id,person_id,status')
    .in('class_id', classIds)
    .in('person_id', householdPersonIds);

  if (regErr) throw new Error(regErr.message);

  return {
    householdId,
    requestedItems,
    personId,
    classById,
    householdPersonIds,
    registrations: (regs ?? []) as ExistingRegistration[],
  };
}

function computeTotalPriceCents(context: LoadedContext) {
  return context.requestedItems.reduce((sum, item) => {
    const price = context.classById.get(item.class_id)?.price_cents ?? 0;
    return sum + price * item.quantity;
  }, 0);
}

async function finalizeCheckout(context: LoadedContext) {
  const supa = admin();
  const assignments = await buildAssignments(context);

  const restoredIds: string[] = [];
  const insertedRows: { id: string }[] = [];

  for (const item of context.requestedItems) {
    const assignedPeople = assignments.get(item.class_id) ?? [];

    for (const assignment of assignedPeople) {
      if (assignment.existing?.status === 'cancelled') {
        const { error } = await supa
          .from('class_registrations')
          .update({ status: 'scheduled' })
          .eq('id', assignment.existing.id);
        if (error) throw new Error(error.message);
        restoredIds.push(assignment.existing.id);
        continue;
      }

      const { data, error } = await supa
        .from('class_registrations')
        .insert({ class_id: item.class_id, person_id: assignment.person_id, status: 'scheduled' })
        .select('id')
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (data) insertedRows.push(data);
    }
  }

  return {
    registration_count: context.requestedItems.reduce((sum, item) => sum + item.quantity, 0),
    inserted_count: insertedRows.length,
    restored_count: restoredIds.length,
    total_price_cents: computeTotalPriceCents(context),
    registration_ids: [...insertedRows.map((row) => row.id), ...restoredIds],
  };
}

async function createSquarePaymentLink(context: LoadedContext, userEmail?: string | null) {
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
    throw new Error('Square payment is not configured');
  }

  await buildAssignments(context);

  const totalPriceCents = computeTotalPriceCents(context);
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const redirectUrl = `${base}/landing/classschedule?checkout=success&person_id=${context.personId}`;

  const referenceSuffix = crypto.createHash('sha1').update(`${context.householdId}:${Date.now()}`).digest('hex').slice(0, 20);

  const commonBody = {
    checkout_options: {
      redirect_url: redirectUrl,
      ask_for_shipping_address: false,
    },
    pre_populated_data: {
      buyer_email: userEmail ?? undefined,
    },
    reference_id: `cc_${referenceSuffix}`,
    description: `Class checkout (${context.requestedItems.length} line item(s), $${(totalPriceCents / 100).toFixed(2)})`,
  };

  const callSquare = async (body: Record<string, unknown>) => {
    const resp = await fetch(`${getSquareBaseUrl()}/v2/online-checkout/payment-links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2025-10-16',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return { ok: false as const, error: await resp.text() };
    const data = await resp.json();
    const url: string | undefined = data?.payment_link?.url;
    if (!url) return { ok: false as const, error: 'no_url_returned' };
    return { ok: true as const, url };
  };

  const orderBody = {
    ...commonBody,
    idempotency_key: crypto.randomUUID(),
    order: {
      location_id: process.env.SQUARE_LOCATION_ID,
      line_items: context.requestedItems.map((item) => ({
        name: context.classById.get(item.class_id)?.title ?? 'Class booking',
        quantity: String(item.quantity),
        base_price_money: {
          amount: context.classById.get(item.class_id)?.price_cents ?? 0,
          currency: 'USD',
        },
      })),
    },
  };

  const order = await callSquare(orderBody);
  if (order.ok) return { url: order.url, total_price_cents: totalPriceCents };

  const fallbackBody = {
    ...commonBody,
    idempotency_key: crypto.randomUUID(),
    quick_pay: {
      name: `Little Wanderers Class Checkout (${context.requestedItems.length} classes)`,
      price_money: {
          amount: totalPriceCents,
          currency: 'USD',
      },
      location_id: process.env.SQUARE_LOCATION_ID,
    },
  };

  const fallback = await callSquare(fallbackBody);
  if (fallback.ok) return { url: fallback.url, total_price_cents: totalPriceCents };
  throw new Error(`square_error: order=${order.error}; fallback=${fallback.error}`);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CheckoutBody;
    const mode = body.mode ?? 'create_payment_link';

    const server = createServerSupabaseClient();
    const {
      data: { user },
    } = await server.auth.getUser();

    if (!user) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const context = await loadAndValidate(body, user.id);

    if (mode === 'finalize') {
      const checkout_summary = await finalizeCheckout(context);
      return Response.json({ ok: true, checkout_summary });
    }

    const payment = await createSquarePaymentLink(context, user.email);
    return Response.json({ ok: true, payment_url: payment.url, total_price_cents: payment.total_price_cents });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    const status =
      message === 'person_id and items are required'
        ? 400
        : message === 'unauthorized'
          ? 401
          : message.includes('not found')
            ? 404
            : message.includes('enough seats') || message.includes('eligible person') || message.includes('not open')
              ? 409
              : 500;
    return Response.json({ ok: false, error: message }, { status });
  }
}
