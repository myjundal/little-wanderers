import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import crypto from 'crypto';

const SQUARE_BASE = 'https://connect.squareupsandbox.com';

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type CheckoutBody = {
  class_ids?: string[];
  person_id?: string;
  mode?: 'create_payment_link' | 'finalize';
};

type LoadedContext = {
  classIds: string[];
  personId: string;
  classById: Map<string, { id: string; title: string; capacity: number | null; status: string; price_cents: number }>;
  existingByClass: Map<string, { id: string; status: string }>;
};

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

async function loadAndValidate(body: CheckoutBody, userId: string): Promise<LoadedContext> {
  const classIds = Array.isArray(body.class_ids) ? [...new Set(body.class_ids.filter(Boolean))] : [];
  const personId = body.person_id;

  if (!personId || classIds.length === 0) {
    throw new Error('person_id and class_ids are required');
  }

  const householdId = await getHouseholdIdForUser(userId);
  if (!householdId) {
    throw new Error('household not found');
  }

  const supa = admin();
  const { data: person } = await supa
    .from('people')
    .select('id')
    .eq('id', personId)
    .eq('household_id', householdId)
    .maybeSingle();

  if (!person) {
    throw new Error('person not found in your household');
  }

  const { data: classes, error: classErr } = await supa
    .from('classes')
    .select('id,title,capacity,status,price_cents')
    .in('id', classIds);

  if (classErr) {
    throw new Error(classErr.message);
  }
  if ((classes ?? []).length !== classIds.length) {
    throw new Error('one or more classes were not found');
  }

  const classById = new Map((classes ?? []).map((item) => [item.id, item]));
  const { data: regs } = await supa
    .from('class_registrations')
    .select('id,class_id,person_id,status')
    .in('class_id', classIds);

  const activeByClass = new Map<string, number>();
  const existingByClass = new Map<string, { id: string; status: string }>();

  (regs ?? []).forEach((reg) => {
    if (reg.status !== 'cancelled') {
      activeByClass.set(reg.class_id, (activeByClass.get(reg.class_id) ?? 0) + 1);
    }
    if (reg.person_id === personId) {
      existingByClass.set(reg.class_id, { id: reg.id, status: reg.status });
    }
  });

  for (const classId of classIds) {
    const klass = classById.get(classId);
    if (!klass) continue;

    if (klass.status !== 'scheduled') {
      throw new Error(`${klass.title} is not open for booking`);
    }

    const existing = existingByClass.get(classId);
    if (existing && existing.status !== 'cancelled') {
      throw new Error(`already registered for ${klass.title}`);
    }

    if (klass.capacity != null && (activeByClass.get(classId) ?? 0) >= klass.capacity) {
      throw new Error(`${klass.title} is full`);
    }
  }

  return { classIds, personId, classById, existingByClass };
}

async function finalizeCheckout(context: LoadedContext) {
  const supa = admin();
  const restoredIds: string[] = [];
  const insertedRows: { id: string }[] = [];

  for (const classId of context.classIds) {
    const existing = context.existingByClass.get(classId);
    if (existing?.status === 'cancelled') {
      const { error } = await supa
        .from('class_registrations')
        .update({ status: 'scheduled' })
        .eq('id', existing.id);
      if (error) throw new Error(error.message);
      restoredIds.push(existing.id);
      continue;
    }

    const { data, error } = await supa
      .from('class_registrations')
      .insert({ class_id: classId, person_id: context.personId, status: 'scheduled' })
      .select('id')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (data) insertedRows.push(data);
  }

  const totalPriceCents = context.classIds.reduce(
    (sum, classId) => sum + (context.classById.get(classId)?.price_cents ?? 0),
    0
  );

  return {
    registration_count: context.classIds.length,
    inserted_count: insertedRows.length,
    restored_count: restoredIds.length,
    total_price_cents: totalPriceCents,
  };
}

async function createSquarePaymentLink(context: LoadedContext, userEmail?: string | null) {
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
    throw new Error('Square payment is not configured');
  }

  const totalPriceCents = context.classIds.reduce(
    (sum, classId) => sum + (context.classById.get(classId)?.price_cents ?? 0),
    0
  );

  const lineItems = context.classIds.map((classId) => {
    const klass = context.classById.get(classId)!;
    return {
      name: klass.title,
      quantity: '1',
      base_price_money: {
        amount: klass.price_cents,
        currency: 'USD',
      },
    };
  });

  const idempotencyKey = crypto.randomUUID();
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const classIdsParam = encodeURIComponent(context.classIds.join(','));
  const redirectUrl = `${base}/landing/classschedule?checkout=success&person_id=${context.personId}&class_ids=${classIdsParam}`;

  const squareBody = {
    idempotency_key: idempotencyKey,
    order: {
      location_id: process.env.SQUARE_LOCATION_ID,
      line_items: lineItems,
    },
    checkout_options: {
      redirect_url: redirectUrl,
      ask_for_shipping_address: false,
    },
    pre_populated_data: {
      buyer_email: userEmail ?? undefined,
    },
    reference_id: `class_checkout_${context.personId}`,
    description: `Class checkout (${context.classIds.length} items, $${(totalPriceCents / 100).toFixed(2)})`,
  };

  const resp = await fetch(`${SQUARE_BASE}/v2/online-checkout/payment-links`, {
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
    throw new Error(`square_error: ${text}`);
  }

  const data = await resp.json();
  const url: string | undefined = data?.payment_link?.url;

  if (!url) {
    throw new Error('no_url_returned');
  }

  return { url, total_price_cents: totalPriceCents };
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
      message === 'person_id and class_ids are required'
        ? 400
        : message === 'unauthorized'
          ? 401
          : message.includes('not found')
            ? 404
            : message.includes('already registered') || message.includes('is full') || message.includes('not open')
              ? 409
              : 500;
    return Response.json({ ok: false, error: message }, { status });
  }
}
