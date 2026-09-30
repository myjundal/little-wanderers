import { requireStaffContext } from '@/lib/authz';
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildPrePopulatedData, logSquarePayload } from '@/lib/square';
import {
  countConfirmedClassRegistrations,
  countWaitlistRegistrations,
  hasActiveWaitlistOffer,
  sendClassRegistrationEmail,
} from '@/lib/class-waitlist';
import { sendClassRegistrationNotification } from '@/lib/admin-notifications';
import { getPrimaryGuardianProfile } from '@/lib/family-profile';
import { logger } from '@/lib/logger';

type Params = { params: { id: string } };
type CheckoutBody = { person_id?: string; items?: Array<{ class_id: string; quantity?: number }>; mode?: 'create_payment_link' | 'finalize' | 'register' };

function getSquareBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT ?? process.env.SQUARE_ENV ?? 'sandbox').toLowerCase();
  return env === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
}

async function notifyManualClassRegistration(input: {
  admin: SupabaseClient;
  registrationId?: string | null;
  status: 'scheduled' | 'waitlist';
  householdId: string;
  fallbackEmail?: string | null;
  userId: string;
  person: {
    first_name?: string | null;
    last_name?: string | null;
    birthdate?: string | null;
  };
  klass: {
    title?: string | null;
    category?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    schedule_label?: string | null;
    instructor_name?: string | null;
    price_cents?: number | null;
  };
}) {
  if (!input.registrationId) return;

  void (async () => {
    const email = await sendClassRegistrationEmail(input.admin, input.registrationId!, input.status, input.fallbackEmail).catch((emailError) => ({
      ok: false as const,
      error: emailError instanceof Error ? emailError.message : 'Unable to send class email.',
    }));
    if (!email.ok || 'skipped' in email) {
      logger.warn({
        action: 'staff.class.registration_email_not_sent',
        householdId: input.householdId,
        registrationId: input.registrationId,
        status: input.status,
        result: email,
      });
    }

    try {
      const [{ data: household }, guardian] = await Promise.all([
        input.admin.from('households').select('name,email').eq('id', input.householdId).maybeSingle(),
        getPrimaryGuardianProfile(input.admin, input.householdId).catch(() => null),
      ]);
      const notification = await sendClassRegistrationNotification({
        registrationId: input.registrationId,
        status: input.status,
        familyName: household?.name ?? null,
        familyEmail: household?.email ?? input.fallbackEmail ?? null,
        guardianFirstName: guardian?.first_name ?? null,
        guardianLastName: guardian?.last_name ?? null,
        childFirstName: input.person.first_name ?? null,
        childLastName: input.person.last_name ?? null,
        childBirthdate: input.person.birthdate ?? null,
        classTitle: input.klass.title ?? null,
        classCategory: input.klass.category ?? null,
        classStartTime: input.klass.start_time ?? null,
        classEndTime: input.klass.end_time ?? null,
        classScheduleLabel: input.klass.schedule_label ?? null,
        instructorName: input.klass.instructor_name ?? null,
        priceCents: input.klass.price_cents ?? null,
      });
      if (!notification.ok) {
        logger.error({ action: 'staff.class.registration_notification_not_sent', registrationId: input.registrationId }, new Error(notification.error));
      }
    } catch (notificationError) {
      logger.error({ action: 'staff.class.registration_notification_failed', registrationId: input.registrationId }, notificationError);
    }
  })().catch((error) => {
    logger.error({ action: 'staff.class.registration_side_effects_failed', registrationId: input.registrationId }, error);
  });
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

  if (mode === 'register') {
    if (items.length !== 1) {
      return Response.json({ ok: false, error: 'Choose one class at a time for manual registration.' }, { status: 400 });
    }

    const classId = items[0].class_id;
    const { data: person } = await admin
      .from('people')
      .select('id,role,first_name,last_name,birthdate')
      .eq('id', personId)
      .eq('household_id', householdId)
      .maybeSingle();
    if (!person) return Response.json({ ok: false, error: 'person not found in household' }, { status: 404 });

    const { data: klass } = await admin
      .from('classes')
      .select('id,title,category,capacity,status,start_time,end_time,schedule_label,instructor_name,price_cents')
      .eq('id', classId)
      .maybeSingle();
    if (!klass) return Response.json({ ok: false, error: 'class not found' }, { status: 404 });
    if (klass.status !== 'scheduled') {
      return Response.json({ ok: false, error: 'class is not open for booking' }, { status: 409 });
    }

    const { data: already } = await admin
      .from('class_registrations')
      .select('id,status')
      .eq('class_id', classId)
      .eq('person_id', personId)
      .maybeSingle();

    if (already && already.status !== 'cancelled') {
      return Response.json({ ok: false, error: 'already registered' }, { status: 409 });
    }

    const [booked, offerPendingResult, waitlistCount, { data: household }] = await Promise.all([
      countConfirmedClassRegistrations(admin, classId),
      hasActiveWaitlistOffer(admin, classId),
      countWaitlistRegistrations(admin, classId),
      admin.from('households').select('email').eq('id', householdId).maybeSingle(),
    ]);
    const isFull = klass.capacity != null && booked >= klass.capacity;
    const shouldWaitlist = isFull || (!isFull && offerPendingResult) || (!isFull && waitlistCount > 0);
    const nextStatus: 'scheduled' | 'waitlist' = shouldWaitlist ? 'waitlist' : 'scheduled';

    if (already && already.status === 'cancelled') {
      const { error } = await admin
        .from('class_registrations')
        .update({
          status: nextStatus,
          created_at: new Date().toISOString(),
          waitlist_offer_token: null,
          waitlist_offer_expires_at: null,
          waitlist_offered_at: null,
        })
        .eq('id', already.id);
      if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

      notifyManualClassRegistration({
        admin,
        registrationId: already.id,
        status: nextStatus,
        householdId,
        fallbackEmail: household?.email ?? null,
        userId: context.user.id,
        person,
        klass,
      });

      return Response.json({ ok: true, id: already.id, restored: true, status: nextStatus, email_pending: true });
    }

    const { data: inserted, error } = await admin
      .from('class_registrations')
      .insert({
        class_id: classId,
        person_id: personId,
        status: nextStatus,
        household_id: householdId,
        child_id: person.role === 'child' ? person.id : null,
        created_by_user_id: context.user.id,
        created_by_role: context.role,
      })
      .select('id')
      .maybeSingle();
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

    notifyManualClassRegistration({
      admin,
      registrationId: inserted?.id ?? null,
      status: nextStatus,
      householdId,
      fallbackEmail: household?.email ?? null,
      userId: context.user.id,
      person,
      klass,
    });

    return Response.json({ ok: true, id: inserted?.id ?? null, status: nextStatus, email_pending: true });
  }

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
            created_by_role: context.role,
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
