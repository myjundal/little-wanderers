import { requireStaffContext } from '@/lib/authz';
import type { SupabaseClient } from '@supabase/supabase-js';
import { onlinePaymentsUnavailable } from '@/lib/online-payment-access';
import { squareConfig } from '@/lib/square-client';
import { startSquareCheckout, reconcileCheckout, type CheckoutAttempt } from '@/lib/square-checkout';
import {
  sendClassRegistrationEmail,
} from '@/lib/class-waitlist';
import { sendClassRegistrationNotification } from '@/lib/admin-notifications';
import { getPrimaryGuardianProfile } from '@/lib/family-profile';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };
type CheckoutBody = { checkout_id?: string; person_id?: string; items?: Array<{ class_id: string; quantity?: number }>; mode?: 'create_payment_link' | 'finalize' | 'register' };

async function notifyManualClassRegistration(input: {
  admin: SupabaseClient;
  registrationId?: string | null;
  status: 'preregistered';
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
    const email = await sendClassRegistrationEmail(input.admin, input.registrationId!, input.fallbackEmail).catch((emailError) => ({
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

export async function POST(req: Request, { params: pendingParams }: Params) {
  const params = await pendingParams;
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  const householdId = params.id;
  const body = (await req.json()) as CheckoutBody;
  const mode = body.mode ?? 'create_payment_link';
  if (mode !== 'register') {
    const unavailable = onlinePaymentsUnavailable('class');
    if (unavailable) return unavailable;
  }
  const personId = body.person_id;
  const items = (body.items ?? [])
    .filter((item) => item.class_id)
    .map((item) => ({ class_id: item.class_id, quantity: Math.max(1, Number(item.quantity ?? 1)) }));

  if (mode !== 'finalize' && (!personId || items.length === 0)) {
    return Response.json({ ok: false, error: 'person_id and items are required' }, { status: 400 });
  }

  const admin = context.admin;
  const { data: people } = await admin.from('people').select('id,role').eq('household_id', householdId).order('created_at', { ascending: true });
  const peopleRows = people ?? [];
  if (mode !== 'finalize' && !peopleRows.some((p) => p.id === personId)) {
    return Response.json({ ok: false, error: 'person not found in household' }, { status: 404 });
  }

  const classIds = items.map((item) => item.class_id);
  const { error: classError } = await admin.from('classes').select('id,title,capacity,status,price_cents').in('id', classIds);
  if (classError) return Response.json({ ok: false, error: classError.message }, { status: 500 });

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

    const { data: household } = await admin.from('households').select('email').eq('id', householdId).maybeSingle();
    const nextStatus = 'preregistered' as const;

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

  try {
    if (mode === 'finalize') {
      if (!body.checkout_id) return Response.json({ ok: false, error: 'checkout_id is required' }, { status: 400 });
      const { data, error } = await admin.from('square_checkout_attempts').select('*').eq('id',body.checkout_id)
        .eq('household_id', householdId).eq('kind','class').eq('environment',squareConfig().environment).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return Response.json({ ok: false, error: 'Checkout not found' }, { status: 404 });
      return Response.json({ ok:true, ...await reconcileCheckout(admin,data as CheckoutAttempt) });
    }
    if (mode !== 'create_payment_link') return Response.json({ ok:false,error:'Invalid action' }, { status:400 });
    const { data: household, error } = await admin.from('households').select('email').eq('id',householdId).single();
    if (error) throw new Error(error.message);
    const result = await startSquareCheckout(admin, { householdId,userId:context.user.id,role:context.role,kind:'class',
      personId,items,email:household.email,returnPath:`/staff/families/${householdId}?class_checkout=success` });
    return Response.json({ ok:true,checkout_id:result.id,payment_url:result.url,total_price_cents:result.total });
  } catch (error) {
    return Response.json({ ok:false,error:error instanceof Error ? error.message : 'Unable to verify checkout' }, { status:409 });
  }
}
