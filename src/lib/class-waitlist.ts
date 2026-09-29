import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendResendEmail } from '@/lib/email-campaigns';
import { normalizeWaitlistEmail } from '@/lib/waitlist';

const WAITLIST_OFFER_HOURS = 48;

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatClassTime(startIso: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(startIso));
}

function formatClassDateTime(startIso: string, endIso: string | null) {
  const start = formatClassTime(startIso);
  if (!endIso) return start;

  const end = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(endIso));

  return `${start} - ${end}`;
}

function formatPrice(priceCents: number | null) {
  if (priceCents == null || priceCents <= 0) return 'Free';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: priceCents % 100 === 0 ? 0 : 2,
  }).format(priceCents / 100);
}

async function getWaitlistPosition(admin: SupabaseClient, classId: string, registrationId: string) {
  const { data, error } = await admin
    .from('class_registrations')
    .select('id')
    .eq('class_id', classId)
    .eq('status', 'waitlist')
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  const index = (data ?? []).findIndex((row) => row.id === registrationId);
  return index >= 0 ? index + 1 : null;
}

async function getAuthUserEmail(admin: SupabaseClient, userId: string | null | undefined) {
  if (!userId) return '';
  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(userId);
  if (authError) throw new Error(authError.message);
  return authUser.user?.email?.trim() ?? '';
}

async function getHouseholdRecipientEmail(admin: SupabaseClient, householdId: string, preferredUserId?: string | null) {
  const { data: household, error: householdError } = await admin
    .from('households')
    .select('email,user_id')
    .eq('id', householdId)
    .maybeSingle();

  if (householdError) throw new Error(householdError.message);

  const householdEmail = typeof household?.email === 'string' ? household.email.trim() : '';
  if (householdEmail) return householdEmail;

  const candidateUserIds = new Set<string>();
  if (preferredUserId) candidateUserIds.add(preferredUserId);
  if (typeof household?.user_id === 'string' && household.user_id) candidateUserIds.add(household.user_id);

  const { data: members, error: membersError } = await admin
    .from('household_members')
    .select('user_id,role,created_at')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });

  if (membersError) throw new Error(membersError.message);
  (members ?? []).forEach((member) => {
    if (typeof member.user_id === 'string' && member.user_id) candidateUserIds.add(member.user_id);
  });

  for (const userId of candidateUserIds) {
    const email = await getAuthUserEmail(admin, userId);
    if (email) return email;
  }

  return '';
}

export async function isUserOnWanderlist(admin: SupabaseClient, email: string | null | undefined) {
  const normalizedEmail = normalizeWaitlistEmail(email ?? '');
  if (!normalizedEmail) return false;

  const { data, error } = await admin
    .from('waitlist_entries')
    .select('id')
    .eq('normalized_email', normalizedEmail)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function countConfirmedClassRegistrations(admin: SupabaseClient, classId: string) {
  const { count, error } = await admin
    .from('class_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('class_id', classId)
    .in('status', ['scheduled', 'attended']);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function hasActiveWaitlistOffer(admin: SupabaseClient, classId: string, exceptRegistrationId?: string) {
  let query = admin
    .from('class_registrations')
    .select('id')
    .eq('class_id', classId)
    .eq('status', 'waitlist')
    .gt('waitlist_offer_expires_at', new Date().toISOString())
    .limit(1);

  if (exceptRegistrationId) query = query.neq('id', exceptRegistrationId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function countWaitlistRegistrations(admin: SupabaseClient, classId: string) {
  const { count, error } = await admin
    .from('class_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('class_id', classId)
    .eq('status', 'waitlist');

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function sendClassRegistrationEmail(
  admin: SupabaseClient,
  registrationId: string,
  status: 'scheduled' | 'waitlist'
) {
  const { data: reg, error: regError } = await admin
    .from('class_registrations')
    .select('id,class_id,person_id,status,created_by_user_id')
    .eq('id', registrationId)
    .maybeSingle();

  if (regError) throw new Error(regError.message);
  if (!reg) return { ok: false as const, error: 'registration not found' };

  const { data: klass, error: classError } = await admin
    .from('classes')
    .select('id,title,category,start_time,end_time,capacity,price_cents,instructor_name,schedule_label,age_range,caregiver_participation')
    .eq('id', reg.class_id)
    .maybeSingle();

  if (classError) throw new Error(classError.message);
  if (!klass) return { ok: false as const, error: 'class not found' };

  const { data: person, error: personError } = await admin
    .from('people')
    .select('first_name,last_name,household_id')
    .eq('id', reg.person_id)
    .maybeSingle();

  if (personError) throw new Error(personError.message);
  if (!person?.household_id) return { ok: false as const, error: 'person household not found' };

  const to = await getHouseholdRecipientEmail(admin, person.household_id, reg.created_by_user_id);
  if (!to) return { ok: true as const, skipped: true, reason: 'missing_email' };

  const childName = [person.first_name, person.last_name].filter(Boolean).join(' ').trim() || 'your child';
  const classTime = formatClassDateTime(klass.start_time, klass.end_time);
  const scheduleLabel = typeof klass.schedule_label === 'string' && klass.schedule_label.trim() ? klass.schedule_label.trim() : null;
  const waitlistPosition = status === 'waitlist' ? await getWaitlistPosition(admin, reg.class_id, reg.id) : null;
  const heading = status === 'waitlist' ? 'You are on the waitlist' : 'You are pre-registered';
  const intro =
    status === 'waitlist'
      ? `We added ${childName} to the waitlist for ${klass.title}.`
      : `We received ${childName}'s pre-registration for ${klass.title}.`;
  const positionLine = waitlistPosition
    ? `<p><strong>Waitlist position:</strong> #${waitlistPosition}</p>`
    : '';
  const waitlistNote =
    status === 'waitlist'
      ? '<p>If a spot opens, we will email the next family in line a private claim link before opening that seat to anyone else.</p>'
      : '<p>This is a pre-registration confirmation. We will follow up with any final class details before the start date.</p>';

  const details = [
    ['Class', klass.title],
    ['Child', childName],
    ['Instructor', klass.instructor_name],
    ['Schedule', scheduleLabel ?? classTime],
    ['First class', classTime],
    ['Age group', klass.age_range],
    ['Caregiver participation', klass.caregiver_participation],
    ['Price', formatPrice(klass.price_cents)],
  ]
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => `<tr><td style="padding:8px 12px;color:#6d6480;">${escapeHtml(label)}</td><td style="padding:8px 12px;font-weight:700;color:#3f355a;">${escapeHtml(value)}</td></tr>`)
    .join('');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#ffffff;color:#3f355a;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
    <main style="max-width:620px;margin:0 auto;">
      <h1 style="font-size:22px;margin:0 0 14px;color:#4f3f82;">${escapeHtml(heading)}</h1>
      <p>${escapeHtml(intro)}</p>
      ${positionLine}
      <table style="width:100%;border-collapse:collapse;border:1px solid #efe3ff;border-radius:12px;overflow:hidden;margin:18px 0;">
        <tbody>${details}</tbody>
      </table>
      ${waitlistNote}
      <p style="color:#6d6480;font-size:13px;">Questions? Reply to this email and we will help.</p>
    </main>
  </body>
</html>`;

  return sendResendEmail({
    to,
    subject: status === 'waitlist' ? `Waitlist confirmation: ${klass.title}` : `Pre-registration confirmation: ${klass.title}`,
    html,
  });
}

export async function sendClassCancellationEmail(admin: SupabaseClient, registrationId: string) {
  const { data: reg, error: regError } = await admin
    .from('class_registrations')
    .select('id,class_id,person_id,created_by_user_id')
    .eq('id', registrationId)
    .maybeSingle();

  if (regError) throw new Error(regError.message);
  if (!reg) return { ok: false as const, error: 'registration not found' };

  const { data: klass, error: classError } = await admin
    .from('classes')
    .select('id,title,start_time,end_time,instructor_name,schedule_label')
    .eq('id', reg.class_id)
    .maybeSingle();

  if (classError) throw new Error(classError.message);
  if (!klass) return { ok: false as const, error: 'class not found' };

  const { data: person, error: personError } = await admin
    .from('people')
    .select('first_name,last_name,household_id')
    .eq('id', reg.person_id)
    .maybeSingle();

  if (personError) throw new Error(personError.message);
  if (!person?.household_id) return { ok: false as const, error: 'person household not found' };

  const to = await getHouseholdRecipientEmail(admin, person.household_id, reg.created_by_user_id);
  if (!to) return { ok: true as const, skipped: true, reason: 'missing_email' };

  const childName = [person.first_name, person.last_name].filter(Boolean).join(' ').trim() || 'your child';
  const classTime = formatClassDateTime(klass.start_time, klass.end_time);
  const scheduleLabel = typeof klass.schedule_label === 'string' && klass.schedule_label.trim() ? klass.schedule_label.trim() : null;
  const details = [
    ['Class', klass.title],
    ['Child', childName],
    ['Instructor', klass.instructor_name],
    ['Schedule', scheduleLabel ?? classTime],
    ['Class time', classTime],
  ]
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => `<tr><td style="padding:8px 12px;color:#6d6480;">${escapeHtml(label)}</td><td style="padding:8px 12px;font-weight:700;color:#3f355a;">${escapeHtml(value)}</td></tr>`)
    .join('');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#ffffff;color:#3f355a;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
    <main style="max-width:620px;margin:0 auto;">
      <h1 style="font-size:22px;margin:0 0 14px;color:#4f3f82;">Class registration cancelled</h1>
      <p>We cancelled ${escapeHtml(childName)}'s registration for <strong>${escapeHtml(klass.title)}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #efe3ff;border-radius:12px;overflow:hidden;margin:18px 0;">
        <tbody>${details}</tbody>
      </table>
      <p style="color:#6d6480;font-size:13px;">If this was a mistake, you can register again from your class schedule. If the class is full, you will join the waitlist.</p>
    </main>
  </body>
</html>`;

  return sendResendEmail({
    to,
    subject: `Class cancellation confirmation: ${klass.title}`,
    html,
  });
}

export async function offerNextWaitlistSpot(admin: SupabaseClient, classId: string, baseUrl: string) {
  if (await hasActiveWaitlistOffer(admin, classId)) {
    return { ok: true as const, offered: false, reason: 'active_offer_exists' };
  }

  const { data: klass, error: classError } = await admin
    .from('classes')
    .select('id,title,start_time,capacity,status')
    .eq('id', classId)
    .maybeSingle();

  if (classError) throw new Error(classError.message);
  if (!klass || klass.status !== 'scheduled') return { ok: true as const, offered: false, reason: 'class_not_open' };

  const booked = await countConfirmedClassRegistrations(admin, classId);
  if (klass.capacity != null && booked >= klass.capacity) {
    return { ok: true as const, offered: false, reason: 'no_seat_available' };
  }

  const { data: waitlistRows, error: waitlistError } = await admin
    .from('class_registrations')
    .select('id,person_id,created_at,waitlist_offer_expires_at,created_by_user_id')
    .eq('class_id', classId)
    .eq('status', 'waitlist')
    .order('created_at', { ascending: true })
    .limit(20);

  if (waitlistError) throw new Error(waitlistError.message);

  const now = Date.now();
  const next = (waitlistRows ?? []).find((row) => {
    if (!row.waitlist_offer_expires_at) return true;
    return new Date(row.waitlist_offer_expires_at).getTime() <= now;
  });

  if (!next) return { ok: true as const, offered: false, reason: 'no_waitlist' };

  const { data: person, error: personError } = await admin
    .from('people')
    .select('first_name,household_id')
    .eq('id', next.person_id)
    .maybeSingle();

  if (personError) throw new Error(personError.message);
  if (!person?.household_id) return { ok: true as const, offered: false, reason: 'missing_household' };

  const to = await getHouseholdRecipientEmail(admin, person.household_id, next.created_by_user_id);
  if (!to) return { ok: true as const, offered: false, reason: 'missing_email' };

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + WAITLIST_OFFER_HOURS * 60 * 60 * 1000).toISOString();
  const claimUrl = `${baseUrl.replace(/\/$/, '')}/landing/classschedule?waitlist_token=${encodeURIComponent(token)}`;

  const { error: updateError } = await admin
    .from('class_registrations')
    .update({
      waitlist_offer_token: token,
      waitlist_offer_expires_at: expiresAt,
      waitlist_offered_at: new Date().toISOString(),
    })
    .eq('id', next.id);

  if (updateError) throw new Error(updateError.message);

  const childName = person.first_name ? ` for ${person.first_name}` : '';
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#ffffff;color:#3f355a;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
    <main style="max-width:620px;margin:0 auto;">
      <h1 style="font-size:22px;margin:0 0 14px;color:#4f3f82;">A class spot opened${escapeHtml(childName)}</h1>
      <p>A spot opened in <strong>${escapeHtml(klass.title)}</strong>.</p>
      <p><strong>Class time:</strong> ${escapeHtml(formatClassTime(klass.start_time))}</p>
      <p>This offer is reserved for your family first and expires in ${WAITLIST_OFFER_HOURS} hours.</p>
      <p style="margin:22px 0;">
        <a href="${escapeHtml(claimUrl)}" style="display:inline-block;background:#5f3da4;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px;">Claim this spot</a>
      </p>
      <p style="color:#6d6480;font-size:13px;">If the button does not work, copy and paste this link: ${escapeHtml(claimUrl)}</p>
    </main>
  </body>
</html>`;

  const email = await sendResendEmail({
    to,
    subject: `A spot opened in ${klass.title}`,
    html,
  });

  return { ok: true as const, offered: true, registration_id: next.id, email };
}
