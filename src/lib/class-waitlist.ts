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
    .select('id,person_id,created_at,waitlist_offer_expires_at')
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

  const { data: household, error: householdError } = await admin
    .from('households')
    .select('email,name')
    .eq('id', person.household_id)
    .maybeSingle();

  if (householdError) throw new Error(householdError.message);
  const to = typeof household?.email === 'string' ? household.email.trim() : '';
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
