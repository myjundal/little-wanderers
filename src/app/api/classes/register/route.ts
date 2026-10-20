import { isWanderlistSignupWindow } from '@/lib/signup-policy';
import { CLASS_START_AT, CLASS_START_LABEL } from '@/lib/class-config';
import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import {
  countConfirmedClassRegistrations,
  countWaitlistRegistrations,
  hasActiveWaitlistOffer,
  isUserOnWanderlist,
  sendClassRegistrationEmail,
} from '@/lib/class-waitlist';
import { sendClassRegistrationNotification } from '@/lib/admin-notifications';
import { ensureGuardianProfile, getPrimaryGuardianProfile, parseGuardianName } from '@/lib/family-profile';
import { logger } from '@/lib/logger';
import { waitUntil } from '@vercel/functions';

export const maxDuration = 60;

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

async function notifyClassRegistrationSaved(input: {
  admin: ReturnType<typeof admin>;
  registrationId?: string | null;
  status: 'scheduled' | 'waitlist';
  householdId: string;
  fallbackEmail?: string | null;
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
      logger.error(
        { action: 'class_registration_notification.failed', registrationId: input.registrationId ?? null, status: input.status },
        new Error(notification.error)
      );
    }
  } catch (notificationError) {
    logger.error(
      { action: 'class_registration_notification.failed', registrationId: input.registrationId ?? null, status: input.status },
      notificationError
    );
  }
}

function queueClassRegistrationSideEffects(input: {
  admin: ReturnType<typeof admin>;
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

  const emailTask = sendClassRegistrationEmail(input.admin, input.registrationId, input.fallbackEmail).catch((emailError) => ({
    ok: false as const,
    error: emailError instanceof Error ? emailError.message : 'Unable to send class email.',
  })).then(email => {
    if (!email.ok || 'skipped' in email) logger.warn({
      action: 'class.registration_email_not_sent',
      userId: input.userId,
      householdId: input.householdId,
      registrationId: input.registrationId,
      status: input.status,
      result: email,
    });
  });

  const notificationTask = notifyClassRegistrationSaved({
    admin: input.admin,
    registrationId: input.registrationId,
    status: input.status,
    householdId: input.householdId,
    fallbackEmail: input.fallbackEmail,
    person: input.person,
    klass: input.klass,
  });
  waitUntil(Promise.all([emailTask, notificationTask]).catch(error => {
    logger.error({ action: 'class.registration_side_effects_failed', registrationId: input.registrationId }, error);
  }));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const classId = body?.class_id as string | undefined;
    const personId = body?.person_id as string | undefined;
    const guardianName = parseGuardianName(body);

    if (!classId || !personId) {
      return Response.json({ ok: false, error: 'class_id and person_id are required' }, { status: 400 });
    }

    const server = createServerSupabaseClient();
    const {
      data: { user },
    } = await server.auth.getUser();

    if (!user) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const supa = admin();
    const householdId = await getLatestHouseholdIdForUser(supa, user.id);
    if (!householdId) {
      return Response.json({ ok: false, error: 'household not found' }, { status: 404 });
    }

    const [{ data: roleRow }, { data: person }, { data: klass }, existingResult] = await Promise.all([
      supa.from('roles').select('role').eq('id', user.id).maybeSingle(),
      supa.from('people').select('id,role,first_name,last_name,birthdate').eq('id', personId).eq('household_id', householdId).maybeSingle(),
      supa.from('classes').select('id,title,category,capacity,status,start_time,end_time,schedule_label,instructor_name,price_cents').eq('id', classId).maybeSingle(),
      supa.from('class_registrations').select('id,status').eq('class_id', classId).eq('person_id', personId).maybeSingle(),
    ]);
    const isOperator = roleRow?.role === 'owner' || roleRow?.role === 'staff' || roleRow?.role === 'admin';
    const onWanderlist = isOperator || (await isUserOnWanderlist(supa, user.email));
    if (isWanderlistSignupWindow() && !onWanderlist) {
      return Response.json(
        { ok: false, error: 'Class pre-registration is open to Wanderlist families first.' },
        { status: 403 }
      );
    }

    if (!person) {
      return Response.json({ ok: false, error: 'person not found in your household' }, { status: 403 });
    }

    if (!klass) return Response.json({ ok: false, error: 'class not found' }, { status: 404 });
    if (new Date(klass.start_time).getTime() < new Date(CLASS_START_AT).getTime()) {
      return Response.json({ ok: false, error: `Classes begin ${CLASS_START_LABEL}. Please choose an upcoming date.` }, { status: 409 });
    }
    if (klass.status !== 'scheduled') {
      return Response.json({ ok: false, error: 'class is not open for booking' }, { status: 409 });
    }

    if (existingResult.error) throw new Error(existingResult.error.message);
    const already = existingResult.data;

    if (already && already.status !== 'cancelled') {
      return Response.json({ ok: true, id: already.id, status: already.status, already_registered: true });
    }

    const [booked, offerPendingResult, waitlistCount] = await Promise.all([
      countConfirmedClassRegistrations(supa, classId),
      hasActiveWaitlistOffer(supa, classId),
      countWaitlistRegistrations(supa, classId),
      ensureGuardianProfile({ admin: supa, householdId, userId: user.id, email: user.email, firstName: guardianName.firstName, lastName: guardianName.lastName }),
    ]);
    const isFull = klass.capacity != null && booked >= klass.capacity;
    const offerPending = !isFull && offerPendingResult;
    const waitlistExists = !isFull && waitlistCount > 0;
    const shouldWaitlist = isFull || offerPending || waitlistExists;
    const nextStatus: 'scheduled' | 'waitlist' = shouldWaitlist ? 'waitlist' : 'scheduled';

    if (already && already.status === 'cancelled') {
      const { error } = await supa
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

      queueClassRegistrationSideEffects({
        admin: supa,
        registrationId: already.id,
        status: nextStatus,
        householdId,
        fallbackEmail: user.email,
        userId: user.id,
        person,
        klass,
      });

      return Response.json({ ok: true, id: already.id, restored: true, status: nextStatus, email_pending: true });
    }

    const { data: inserted, error: insertErr } = await supa
      .from('class_registrations')
      .insert({
        class_id: classId,
        person_id: personId,
        status: nextStatus,
        household_id: householdId,
        child_id: person.role === 'child' ? person.id : null,
        created_by_user_id: user.id,
        created_by_role: 'customer',
      })
      .select('id')
      .maybeSingle();

    if (insertErr) return Response.json({ ok: false, error: insertErr.message }, { status: 500 });

    queueClassRegistrationSideEffects({
      admin: supa,
      registrationId: inserted?.id ?? null,
      status: nextStatus,
      householdId,
      fallbackEmail: user.email,
      userId: user.id,
      person,
      klass,
    });

    return Response.json({ ok: true, id: inserted?.id ?? null, status: nextStatus, email_pending: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
