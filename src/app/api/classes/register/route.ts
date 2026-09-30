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
import { logger } from '@/lib/logger';

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

async function getHouseholdIdForUser(userId: string) {
  return getLatestHouseholdIdForUser(admin(), userId);
}

async function notifyClassRegistrationSaved(input: {
  admin: ReturnType<typeof admin>;
  registrationId?: string | null;
  status: string;
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
    const { data: household } = await input.admin
      .from('households')
      .select('name,email')
      .eq('id', input.householdId)
      .maybeSingle();

    const notification = await sendClassRegistrationNotification({
      registrationId: input.registrationId,
      status: input.status,
      familyName: household?.name ?? null,
      familyEmail: household?.email ?? input.fallbackEmail ?? null,
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const classId = body?.class_id as string | undefined;
    const personId = body?.person_id as string | undefined;

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

    const householdId = await getHouseholdIdForUser(user.id);
    if (!householdId) {
      return Response.json({ ok: false, error: 'household not found' }, { status: 404 });
    }

    const supa = admin();

    const { data: roleRow } = await supa.from('roles').select('role').eq('id', user.id).maybeSingle();
    const isOperator = roleRow?.role === 'owner' || roleRow?.role === 'staff' || roleRow?.role === 'admin';
    const onWanderlist = isOperator || (await isUserOnWanderlist(supa, user.email));
    if (!onWanderlist) {
      return Response.json(
        { ok: false, error: 'Class pre-registration is open to Wanderlist families first.' },
        { status: 403 }
      );
    }

    const { data: person } = await supa
      .from('people')
      .select('id,role,first_name,last_name,birthdate')
      .eq('id', personId)
      .eq('household_id', householdId)
      .maybeSingle();

    if (!person) {
      return Response.json({ ok: false, error: 'person not found in your household' }, { status: 403 });
    }

    const { data: klass } = await supa
      .from('classes')
      .select('id,title,category,capacity,status,start_time,end_time,schedule_label,instructor_name,price_cents')
      .eq('id', classId)
      .maybeSingle();

    if (!klass) return Response.json({ ok: false, error: 'class not found' }, { status: 404 });
    if (klass.status !== 'scheduled') {
      return Response.json({ ok: false, error: 'class is not open for booking' }, { status: 409 });
    }

    const { data: already } = await supa
      .from('class_registrations')
      .select('id,status')
      .eq('class_id', classId)
      .eq('person_id', personId)
      .maybeSingle();

    if (already && already.status !== 'cancelled') {
      return Response.json({ ok: false, error: 'already registered' }, { status: 409 });
    }

    const booked = await countConfirmedClassRegistrations(supa, classId);
    const isFull = klass.capacity != null && booked >= klass.capacity;
    const offerPending = !isFull && (await hasActiveWaitlistOffer(supa, classId));
    const waitlistExists = !isFull && (await countWaitlistRegistrations(supa, classId)) > 0;
    const shouldWaitlist = isFull || offerPending || waitlistExists;
    const nextStatus = shouldWaitlist ? 'waitlist' : 'scheduled';

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

      const email = await sendClassRegistrationEmail(supa, already.id, nextStatus, user.email).catch((emailError) => ({
        ok: false as const,
        error: emailError instanceof Error ? emailError.message : 'Unable to send class email.',
      }));
      if (!email.ok || 'skipped' in email) {
        logger.warn({ action: 'class.registration_email_not_sent', userId: user.id, householdId, registrationId: already.id, status: nextStatus, result: email });
      }
      await notifyClassRegistrationSaved({
        admin: supa,
        registrationId: already.id,
        status: nextStatus,
        householdId,
        fallbackEmail: user.email,
        person,
        klass,
      });

      return Response.json({ ok: true, id: already.id, restored: true, status: nextStatus, email });
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

    const email = inserted?.id
      ? await sendClassRegistrationEmail(supa, inserted.id, nextStatus, user.email).catch((emailError) => ({
          ok: false as const,
          error: emailError instanceof Error ? emailError.message : 'Unable to send class email.',
        }))
      : { ok: false as const, error: 'registration id missing' };
    if (!email.ok || 'skipped' in email) {
      logger.warn({ action: 'class.registration_email_not_sent', userId: user.id, householdId, registrationId: inserted?.id ?? null, status: nextStatus, result: email });
    }
    await notifyClassRegistrationSaved({
      admin: supa,
      registrationId: inserted?.id ?? null,
      status: nextStatus,
      householdId,
      fallbackEmail: user.email,
      person,
      klass,
    });

    return Response.json({ ok: true, id: inserted?.id ?? null, status: nextStatus, email });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
