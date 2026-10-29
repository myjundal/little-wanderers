import type { SupabaseClient } from '@supabase/supabase-js';
import { sendResendEmail } from '@/lib/email-campaigns';
import { logger } from '@/lib/logger';
import { reconcilePartyInvoice, type InvoiceBooking } from '@/lib/square-party';
import { squareEnvironment } from '@/lib/square-client';
import { sendPartyBookingNotification } from '@/lib/admin-notifications';
import {
  PARTY_FINAL_DETAILS,
  PARTY_WHAT_TO_BRING,
  PARTY_WHAT_WE_PROVIDE,
} from '@/lib/party-info';

const DAY_MS = 86_400_000;

type PartyBookingRow = {
  id: string;
  household_id: string;
  start_time: string;
  end_time: string;
  headcount_expected: number | null;
  price_quote_cents: number | null;
  notes: string | null;
  status: string | null;
  created_by_user_id: string | null;
  birthday_child_name: string | null;
  birthday_age: number | null;
  occasion_details: string | null;
  final_child_count?: number | null;
  final_adult_count?: number | null;
  final_total_count?: number | null;
  confirmation_email_sent_at?: string | null;
  two_week_reminder_sent_at?: string | null;
  final_details_email_sent_at?: string | null;
  remaining_balance_cents?: number | null;
  remaining_balance_payment_url?: string | null;
  square_environment?: string | null;
  square_invoice_id?: string | null;
  square_invoice_url?: string | null;
  deposit_paid_cents?: number;
  balance_paid_cents?: number;
  payment_review_required?: boolean;
};

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function formatPartyRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(start);
  const startTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  }).format(start);
  const endTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  }).format(end);
  return `${date}, ${startTime}-${endTime}`;
}

function formatSetupArrival(startIso: string) {
  const setup = new Date(new Date(startIso).getTime() - 30 * 60 * 1000);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(setup);
}

function listItems(items: string[]) {
  return `<ul style="margin:8px 0 0 20px;padding:0;">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function infoTable(rows: Array<[string, string | number | null | undefined]>) {
  return `<table style="width:100%;border-collapse:collapse;border:1px solid #efe3ff;border-radius:12px;overflow:hidden;margin:18px 0;">
    <tbody>
      ${rows
        .filter(([, value]) => value != null && value !== '')
        .map(([label, value]) => `
          <tr>
            <td style="padding:8px 12px;color:#6d6480;border-bottom:1px solid #f0e7ff;">${escapeHtml(label)}</td>
            <td style="padding:8px 12px;font-weight:700;color:#3f355a;border-bottom:1px solid #f0e7ff;">${escapeHtml(String(value))}</td>
          </tr>
        `)
        .join('')}
    </tbody>
  </table>`;
}

function renderShell(title: string, body: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#ffffff;color:#3f355a;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
    <main style="max-width:640px;margin:0 auto;">
      <h1 style="font-size:22px;margin:0 0 14px;color:#4f3f82;">${escapeHtml(title)}</h1>
      ${body}
      <p style="color:#6d6480;font-size:13px;margin-top:22px;">Questions? Reply to this email and we will help.</p>
    </main>
  </body>
</html>`;
}

async function getAuthUserEmail(admin: SupabaseClient, userId: string | null | undefined) {
  if (!userId) return '';
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) throw new Error(error.message);
  return data.user?.email?.trim() ?? '';
}

async function getPartyRecipientEmail(admin: SupabaseClient, booking: Pick<PartyBookingRow, 'household_id' | 'created_by_user_id'>, fallbackEmail?: string | null) {
  const directEmail = typeof fallbackEmail === 'string' ? fallbackEmail.trim() : '';
  if (directEmail) return directEmail;

  const { data: household, error: householdError } = await admin
    .from('households')
    .select('email,user_id')
    .eq('id', booking.household_id)
    .maybeSingle();

  if (householdError) throw new Error(householdError.message);
  const householdEmail = typeof household?.email === 'string' ? household.email.trim() : '';
  if (householdEmail) return householdEmail;

  const candidateUserIds = new Set<string>();
  if (booking.created_by_user_id) candidateUserIds.add(booking.created_by_user_id);
  if (typeof household?.user_id === 'string' && household.user_id) candidateUserIds.add(household.user_id);

  const { data: members, error: membersError } = await admin
    .from('household_members')
    .select('user_id,created_at')
    .eq('household_id', booking.household_id)
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

async function loadBooking(admin: SupabaseClient, bookingId: string) {
  const { data, error } = await admin
    .from('party_bookings')
    .select('id,household_id,start_time,end_time,headcount_expected,price_quote_cents,notes,status,created_by_user_id,birthday_child_name,birthday_age,occasion_details,final_child_count,final_adult_count,final_total_count,confirmation_email_sent_at,two_week_reminder_sent_at,final_details_email_sent_at,remaining_balance_cents,remaining_balance_payment_url,square_environment,square_invoice_id,square_invoice_url,deposit_paid_cents,balance_paid_cents,payment_review_required')
    .eq('id', bookingId)
    .maybeSingle();

  if (error) {
    if (!/column .* does not exist|Could not find the '.*' column/i.test(error.message)) {
      throw new Error(error.message);
    }

    const fallback = await admin
      .from('party_bookings')
      .select('id,household_id,start_time,end_time,headcount_expected,price_quote_cents,notes,status,created_by_user_id,birthday_child_name,birthday_age,occasion_details')
      .eq('id', bookingId)
      .maybeSingle();

    if (fallback.error) throw new Error(fallback.error.message);
    return fallback.data as PartyBookingRow | null;
  }
  return data as PartyBookingRow | null;
}

function partyRows(booking: PartyBookingRow) {
  return [
    ['Date and time', formatPartyRange(booking.start_time, booking.end_time)],
    ['Setup arrival', formatSetupArrival(booking.start_time)],
    ['Expected guests', booking.headcount_expected ?? '-'],
    ['Birthday child', booking.birthday_child_name],
    ['Age', booking.birthday_age],
    ['Occasion', booking.occasion_details],
  ] as Array<[string, string | number | null | undefined]>;
}

export async function sendPartyConfirmationEmail(admin: SupabaseClient, bookingId: string, fallbackEmail?: string | null) {
  const booking = await loadBooking(admin, bookingId);
  if (!booking) return { ok: false as const, error: 'booking not found' };

  if (booking.status !== 'confirmed' || booking.payment_review_required || (booking.square_invoice_id && (booking.deposit_paid_cents ?? 0) < 15000)) {
    return { ok: true as const, skipped: true, reason: 'deposit_not_verified' };
  }
  if (booking.confirmation_email_sent_at) return { ok: true as const, skipped: true, reason: 'already_sent' };
  if (booking.square_environment === 'sandbox' && !process.env.SQUARE_SANDBOX_EMAIL_TO) {
    return { ok: true as const, skipped: true, reason: 'sandbox_email_disabled' };
  }
  const to = booking.square_environment === 'sandbox' ? process.env.SQUARE_SANDBOX_EMAIL_TO! : await getPartyRecipientEmail(admin, booking, fallbackEmail);
  if (!to) return { ok: true as const, skipped: true, reason: 'missing_email' };

  const html = renderShell(
    'Your Little Wanderers party is confirmed',
    `
      <p>Thank you for registering your party with Little Wanderers. We saved your party information and your booking is confirmed.</p>
      ${infoTable(partyRows(booking))}
      <h2 style="font-size:17px;color:#4f3f82;margin:18px 0 6px;">What to bring</h2>
      ${listItems(PARTY_WHAT_TO_BRING)}
      <h2 style="font-size:17px;color:#4f3f82;margin:18px 0 6px;">What we provide</h2>
      ${listItems(PARTY_WHAT_WE_PROVIDE)}
      <h2 style="font-size:17px;color:#4f3f82;margin:18px 0 6px;">Final details</h2>
      ${listItems(PARTY_FINAL_DETAILS)}
    `
  );

  const email = await sendResendEmail({
    to,
    subject: 'Party booking confirmation',
    idempotencyKey: `party-confirmed-${booking.id}`,
    html,
  });

  if (email.ok) {
    const notification = await sendPartyBookingNotification({ bookingId:booking.id,startTime:booking.start_time,endTime:booking.end_time,
      status:'confirmed',familyEmail:to,birthdayChildName:booking.birthday_child_name,birthdayAge:booking.birthday_age,
      headcountExpected:booking.headcount_expected,occasionDetails:booking.occasion_details,notes:booking.notes,
      ...(booking.square_environment === 'sandbox' ? { recipientOverride:process.env.SQUARE_SANDBOX_EMAIL_TO } : {}) });
    if (!notification.ok) return notification;
    const { error } = await admin.from('party_bookings').update({ confirmation_email_sent_at: new Date().toISOString() }).eq('id', booking.id);
    if (error) throw new Error(error.message);
  }
  return email;
}

export async function sendPartyTwoWeekReminderEmail(admin: SupabaseClient, booking: PartyBookingRow) {
  if (booking.square_environment === 'sandbox' && !process.env.SQUARE_SANDBOX_EMAIL_TO) return { ok: true as const, skipped: true, reason: 'sandbox_email_disabled' };
  const to = booking.square_environment === 'sandbox' ? process.env.SQUARE_SANDBOX_EMAIL_TO! : await getPartyRecipientEmail(admin, booking);
  if (!to) return { ok: true as const, skipped: true, reason: 'missing_email' };

  const html = renderShell(
    'Your party is coming up!',
    `
      <p>Your Little Wanderers party is coming up. Here is a quick reminder of your booking details.</p>
      ${infoTable(partyRows(booking))}
      <h2 style="font-size:17px;color:#4f3f82;margin:18px 0 6px;">What to bring</h2>
      ${listItems(PARTY_WHAT_TO_BRING)}
      <p>Food and decoration rules are included above so setup stays smooth and safe for everyone.</p>
      <p>Final headcount and remaining balance details will be requested 3 days before the party.</p>
    `
  );

  const email = await sendResendEmail({
    to,
    subject: 'Your party is coming up!',
    idempotencyKey: `party-two-week-${booking.id}`,
    html,
  });

  if (email.ok) {
    await admin.from('party_bookings').update({ two_week_reminder_sent_at: new Date().toISOString() }).eq('id', booking.id);
  }
  return email;
}

export async function sendPartyFinalDetailsEmail(admin: SupabaseClient, booking: PartyBookingRow) {
  if (booking.square_environment === 'sandbox' && !process.env.SQUARE_SANDBOX_EMAIL_TO) return { ok: true as const, skipped: true, reason: 'sandbox_email_disabled' };
  const to = booking.square_environment === 'sandbox' ? process.env.SQUARE_SANDBOX_EMAIL_TO! : await getPartyRecipientEmail(admin, booking);
  if (!to) return { ok: true as const, skipped: true, reason: 'missing_email' };

  // Legacy reservations stay manual. Never manufacture a new $150 charge from an assumed deposit.
  if (!booking.square_invoice_id || booking.square_environment !== squareEnvironment()) {
    return { ok: true as const, skipped: true, reason: 'no_linked_invoice' };
  }
  const { data: full, error } = await admin.from('party_bookings').select('*').eq('id', booking.id).single();
  if (error) throw new Error(error.message);
  const verified = await reconcilePartyInvoice(admin, full as InvoiceBooking);
  if (verified.status !== 'confirmed' || verified.deposit_paid_cents < 15000 || verified.payment_review_required) {
    return { ok: true as const, skipped: true, reason: 'deposit_not_verified' };
  }
  const remainingBalanceCents = Math.max(0, 30000 - verified.deposit_paid_cents - verified.balance_paid_cents);
  const paymentUrl = remainingBalanceCents > 0 ? verified.square_invoice_url : null;
  const finalHeadcount = booking.final_total_count == null
    ? 'Please reply with total guests, adults, and children.'
    : `${booking.final_total_count} total (${booking.final_adult_count ?? 0} adults, ${booking.final_child_count ?? 0} children)`;

  const html = renderShell(
    'Final party details needed',
    `
      <p>Your party is 3 days away. Please confirm the final details below.</p>
      ${infoTable([
        ...partyRows(booking),
        ['Final headcount', finalHeadcount],
        ['Remaining balance', formatMoney(remainingBalanceCents)],
        ['Setup arrival', formatSetupArrival(booking.start_time)],
      ])}
      ${remainingBalanceCents === 0 ? '<p>Your invoice is paid in full. Thank you!</p>' : paymentUrl ? `<p style="margin:20px 0;"><a href="${escapeHtml(paymentUrl)}" style="display:inline-block;background:#5f3da4;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px;">Pay remaining balance</a></p>` : '<p>Please reply to this email and we will send your remaining balance payment link.</p>'}
      <h2 style="font-size:17px;color:#4f3f82;margin:18px 0 6px;">Food and decor reminder</h2>
      ${listItems(PARTY_WHAT_TO_BRING)}
    `
  );

  const email = await sendResendEmail({
    to,
    subject: 'Final party details needed',
    idempotencyKey: `party-final-details-${booking.id}`,
    html,
  });

  if (email.ok) {
    await admin
      .from('party_bookings')
      .update({
        final_details_email_sent_at: new Date().toISOString(),
        remaining_balance_cents: remainingBalanceCents,
        remaining_balance_payment_url: paymentUrl,
      })
      .eq('id', booking.id);
  }
  return email;
}

export async function sendDuePartyReminderEmails(admin: SupabaseClient, now = new Date()) {
  const windowStart = now.toISOString();
  const twoWeekEnd = new Date(now.getTime() + 14 * DAY_MS).toISOString();

  // Reconcile/notify confirmed invoice bookings even if a webhook email attempt exhausted its retries.
  const pendingConfirmations = await admin.from('party_bookings').select('*').eq('status','confirmed')
    .eq('square_environment',squareEnvironment()).not('square_invoice_id','is',null)
    .is('confirmation_email_sent_at',null).gte('start_time',windowStart).limit(50);
  if (pendingConfirmations.error) throw new Error(pendingConfirmations.error.message);
  for (const booking of pendingConfirmations.data ?? []) {
    const verified = await reconcilePartyInvoice(admin,booking as InvoiceBooking);
    if (verified.status === 'confirmed' && !verified.payment_review_required && verified.deposit_paid_cents >= 15000) {
      const result = await sendPartyConfirmationEmail(admin,verified.id);
      if (!result.ok) logger.error({action:'party.confirmation_retry_failed',bookingId:verified.id},new Error(result.error));
    }
  }

  const { data: rows, error } = await admin
    .from('party_bookings')
    .select('id,household_id,start_time,end_time,headcount_expected,price_quote_cents,notes,status,created_by_user_id,birthday_child_name,birthday_age,occasion_details,final_child_count,final_adult_count,final_total_count,confirmation_email_sent_at,two_week_reminder_sent_at,final_details_email_sent_at,remaining_balance_cents,remaining_balance_payment_url,square_environment,square_invoice_id,square_invoice_url,deposit_paid_cents,balance_paid_cents,payment_review_required')
    .eq('status', 'confirmed')
    .gte('start_time', windowStart)
    .lte('start_time', twoWeekEnd)
    .order('start_time', { ascending: true })
    .limit(50);

  if (error) throw new Error(error.message);

  let twoWeekSent = 0;
  let finalSent = 0;
  const errors: Array<{ booking_id: string; error: string }> = [];

  for (const booking of (rows ?? []) as PartyBookingRow[]) {
    const startsAt = new Date(booking.start_time).getTime();
    const msUntil = startsAt - now.getTime();

    try {
      if (booking.square_environment === 'sandbox' && !process.env.SQUARE_SANDBOX_EMAIL_TO) continue;
      if (booking.square_invoice_id && ((booking.deposit_paid_cents ?? 0) < 15000 || booking.payment_review_required || booking.square_environment !== squareEnvironment())) continue;
      if (msUntil <= 14 * DAY_MS && msUntil > 3 * DAY_MS && !booking.two_week_reminder_sent_at) {
        const result = await sendPartyTwoWeekReminderEmail(admin, booking);
        if (result.ok && !('skipped' in result)) twoWeekSent += 1;
      }

      if (msUntil <= 3 * DAY_MS && !booking.final_details_email_sent_at) {
        const result = await sendPartyFinalDetailsEmail(admin, booking);
        if (result.ok && !('skipped' in result)) finalSent += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ booking_id: booking.id, error: message });
      logger.error({ action: 'party.reminder_email_failed', bookingId: booking.id }, err);
    }
  }

  return { ok: true as const, checked: rows?.length ?? 0, two_week_sent: twoWeekSent, final_sent: finalSent, errors };
}
