import type { SupabaseClient } from '@supabase/supabase-js';
import { sendResendEmail } from '@/lib/email-campaigns';
import { logger } from '@/lib/logger';
import { buildPrePopulatedData, logSquarePayload } from '@/lib/square';
import {
  PARTY_DEPOSIT_CENTS,
  PARTY_FINAL_DETAILS,
  PARTY_INCLUDED_GUESTS,
  PARTY_TOTAL_FEE_CENTS,
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

function getSquareBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT ?? process.env.SQUARE_ENV ?? 'sandbox').toLowerCase();
  return env === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
}

function getExtraGuestCents() {
  const value = Number(process.env.PARTY_EXTRA_GUEST_CENTS ?? '0');
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function calculateRemainingBalanceCents(booking: Pick<PartyBookingRow, 'price_quote_cents' | 'final_total_count' | 'headcount_expected'>) {
  const packageTotal = booking.price_quote_cents ?? PARTY_TOTAL_FEE_CENTS;
  const finalTotal = booking.final_total_count ?? booking.headcount_expected ?? PARTY_INCLUDED_GUESTS;
  const extraGuestCount = Math.max(0, finalTotal - PARTY_INCLUDED_GUESTS);
  return Math.max(0, packageTotal - PARTY_DEPOSIT_CENTS + extraGuestCount * getExtraGuestCents());
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
    .select('id,household_id,start_time,end_time,headcount_expected,price_quote_cents,notes,status,created_by_user_id,birthday_child_name,birthday_age,occasion_details,final_child_count,final_adult_count,final_total_count,confirmation_email_sent_at,two_week_reminder_sent_at,final_details_email_sent_at,remaining_balance_cents,remaining_balance_payment_url')
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

async function createPartyBalancePaymentLink(booking: PartyBookingRow, to: string, amountCents: number) {
  if (amountCents <= 0) return null;
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) return null;

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const payload = {
    idempotency_key: `party-balance-${booking.id}-${amountCents}`,
    quick_pay: {
      name: 'Little Wanderers Party Remaining Balance',
      price_money: {
        amount: amountCents,
        currency: 'USD',
      },
      location_id: process.env.SQUARE_LOCATION_ID,
    },
    checkout_options: {
      redirect_url: `${siteUrl}/landing/party?party_balance=success`,
      ask_for_shipping_address: false,
    },
    ...(buildPrePopulatedData(to) ? { pre_populated_data: buildPrePopulatedData(to) } : {}),
    reference_id: `party_balance_${booking.id.slice(0, 20)}`,
    note: JSON.stringify({ party_booking_id: booking.id, type: 'party_remaining_balance' }),
  };

  logSquarePayload('party balance checkout payload', payload as Record<string, unknown>);

  const response = await fetch(`${getSquareBaseUrl()}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2025-10-16',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`square_error: ${text}`);
  }

  const data = await response.json();
  return (data?.payment_link?.url as string | undefined) ?? null;
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

  const to = await getPartyRecipientEmail(admin, booking, fallbackEmail);
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
    html,
  });

  if (email.ok) {
    await admin.from('party_bookings').update({ confirmation_email_sent_at: new Date().toISOString() }).eq('id', booking.id);
  }
  return email;
}

export async function sendPartyTwoWeekReminderEmail(admin: SupabaseClient, booking: PartyBookingRow) {
  const to = await getPartyRecipientEmail(admin, booking);
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
    html,
  });

  if (email.ok) {
    await admin.from('party_bookings').update({ two_week_reminder_sent_at: new Date().toISOString() }).eq('id', booking.id);
  }
  return email;
}

export async function sendPartyFinalDetailsEmail(admin: SupabaseClient, booking: PartyBookingRow) {
  const to = await getPartyRecipientEmail(admin, booking);
  if (!to) return { ok: true as const, skipped: true, reason: 'missing_email' };

  const remainingBalanceCents = calculateRemainingBalanceCents(booking);
  const paymentUrl = booking.remaining_balance_payment_url || await createPartyBalancePaymentLink(booking, to, remainingBalanceCents);
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
      ${paymentUrl ? `<p style="margin:20px 0;"><a href="${escapeHtml(paymentUrl)}" style="display:inline-block;background:#5f3da4;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px;">Pay remaining balance</a></p>` : '<p>Please reply to this email and we will send your remaining balance payment link.</p>'}
      <h2 style="font-size:17px;color:#4f3f82;margin:18px 0 6px;">Food and decor reminder</h2>
      ${listItems(PARTY_WHAT_TO_BRING)}
    `
  );

  const email = await sendResendEmail({
    to,
    subject: 'Final party details needed',
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

  const { data: rows, error } = await admin
    .from('party_bookings')
    .select('id,household_id,start_time,end_time,headcount_expected,price_quote_cents,notes,status,created_by_user_id,birthday_child_name,birthday_age,occasion_details,final_child_count,final_adult_count,final_total_count,confirmation_email_sent_at,two_week_reminder_sent_at,final_details_email_sent_at,remaining_balance_cents,remaining_balance_payment_url')
    .neq('status', 'cancelled')
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
      if (msUntil <= 14 * DAY_MS && msUntil > 3 * DAY_MS && !booking.two_week_reminder_sent_at) {
        const result = await sendPartyTwoWeekReminderEmail(admin, booking);
        if (result.ok) twoWeekSent += 1;
      }

      if (msUntil <= 3 * DAY_MS && !booking.final_details_email_sent_at) {
        const result = await sendPartyFinalDetailsEmail(admin, booking);
        if (result.ok) finalSent += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ booking_id: booking.id, error: message });
      logger.error({ action: 'party.reminder_email_failed', bookingId: booking.id }, err);
    }
  }

  return { ok: true as const, checked: rows?.length ?? 0, two_week_sent: twoWeekSent, final_sent: finalSent, errors };
}
