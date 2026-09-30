import { sendResendEmail } from '@/lib/email-campaigns';

const DEFAULT_OWNER_EMAIL = 'myjundal11@gmail.com';

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatOptional(value: string | number | null | undefined) {
  if (value == null || value === '') return '-';
  return escapeHtml(String(value));
}

function formatEasternRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
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

function formatAgeFromBirthdate(birthdate: string | null | undefined) {
  if (!birthdate) return null;
  const born = new Date(`${birthdate}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;

  const now = new Date();
  let months = (now.getUTCFullYear() - born.getUTCFullYear()) * 12 + now.getUTCMonth() - born.getUTCMonth();
  if (now.getUTCDate() < born.getUTCDate()) months -= 1;
  if (months < 0) return null;
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (remainingMonths === 0) return `${years} year${years === 1 ? '' : 's'}`;
  return `${years} year${years === 1 ? '' : 's'} ${remainingMonths} month${remainingMonths === 1 ? '' : 's'}`;
}

function formatPersonName(input: { firstName?: string | null; lastName?: string | null }) {
  return [input.firstName, input.lastName].filter(Boolean).join(' ').trim() || null;
}

function formatPrice(cents: number | null | undefined) {
  if (cents == null || !Number.isFinite(cents)) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

function getOwnerNotificationEmail() {
  return (
    process.env.OWNER_EMAIL?.trim() ||
    process.env.ADMIN_NOTIFICATION_EMAIL?.trim() ||
    process.env.OWNER_NOTIFICATION_EMAIL?.trim() ||
    DEFAULT_OWNER_EMAIL
  );
}

function renderOperationalNotification(input: {
  title: string;
  rows: Array<[string, string | number | null | undefined]>;
  ctaHref?: string | null;
  ctaLabel?: string;
}) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#ffffff;color:#3f355a;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
    <main style="max-width:620px;margin:0 auto;">
      <h1 style="font-size:22px;margin:0 0 14px;color:#4f3f82;">${escapeHtml(input.title)}</h1>
      <table style="width:100%;border-collapse:collapse;">
        <tbody>
          ${input.rows.map(([label, value]) => `
            <tr>
              <th style="text-align:left;width:140px;padding:8px 10px;border-bottom:1px solid #eadff3;color:#6d6480;">${escapeHtml(String(label))}</th>
              <td style="padding:8px 10px;border-bottom:1px solid #eadff3;color:#3f355a;">${formatOptional(value)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${input.ctaHref ? `<p style="margin:18px 0 0;"><a href="${escapeHtml(input.ctaHref)}" style="color:#5f3da4;font-weight:700;">${escapeHtml(input.ctaLabel ?? 'Open dashboard')}</a></p>` : ''}
    </main>
  </body>
</html>`;
}

export async function sendNewSignupNotification() {
  const to = getOwnerNotificationEmail();

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
  const html = renderOperationalNotification({
    title: 'New Little Wanderers onboarding completed',
    rows: [
      ['Event', 'Family onboarding completed'],
      ['When', new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })],
    ],
    ctaHref: siteUrl ? `${siteUrl}/staff/families` : null,
    ctaLabel: 'Open family management',
  });

  return sendResendEmail({
    to,
    subject: 'New signup completed',
    html,
  });
}

export async function sendPartyBookingNotification(input: {
  bookingId?: string | null;
  startTime: string;
  endTime: string;
  status: string;
  familyName?: string | null;
  familyEmail?: string | null;
  guardianFirstName?: string | null;
  guardianLastName?: string | null;
  birthdayChildName?: string | null;
  birthdayAge?: number | null;
  headcountExpected?: number | null;
  occasionDetails?: string | null;
  notes?: string | null;
}) {
  const to = getOwnerNotificationEmail();
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
  const partyTime = formatEasternRange(input.startTime, input.endTime);
  const html = renderOperationalNotification({
    title: 'New Little Wanderers party booking',
    rows: [
      ['Event', 'Party booking saved'],
      ['Family', input.familyName],
      ['Guardian', formatPersonName({ firstName: input.guardianFirstName, lastName: input.guardianLastName })],
      ['Email', input.familyEmail],
      ['Birthday child', input.birthdayChildName],
      ['Turning age', input.birthdayAge],
      ['Party time', partyTime],
      ['Expected guests', input.headcountExpected],
      ['Occasion/details', input.occasionDetails],
      ['Notes', input.notes],
      ['Status', input.status],
      ['Booking ID', input.bookingId],
    ],
    ctaHref: siteUrl ? `${siteUrl}/staff/parties` : null,
    ctaLabel: 'Open party management',
  });

  return sendResendEmail({
    to,
    subject: `New party booking: ${partyTime}`,
    html,
  });
}

export async function sendClassRegistrationNotification(input: {
  registrationId?: string | null;
  status: 'scheduled' | 'waitlist' | string;
  familyName?: string | null;
  familyEmail?: string | null;
  guardianFirstName?: string | null;
  guardianLastName?: string | null;
  childFirstName?: string | null;
  childLastName?: string | null;
  childBirthdate?: string | null;
  classTitle?: string | null;
  classCategory?: string | null;
  classStartTime?: string | null;
  classEndTime?: string | null;
  classScheduleLabel?: string | null;
  instructorName?: string | null;
  priceCents?: number | null;
}) {
  const to = getOwnerNotificationEmail();
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
  const childName = formatPersonName({ firstName: input.childFirstName, lastName: input.childLastName });
  const classTime = input.classStartTime && input.classEndTime ? formatEasternRange(input.classStartTime, input.classEndTime) : null;
  const registrationLabel = input.status === 'waitlist' ? 'Class waitlist joined' : 'Class pre-registration saved';

  const html = renderOperationalNotification({
    title: 'New Little Wanderers class registration',
    rows: [
      ['Event', registrationLabel],
      ['Family', input.familyName],
      ['Guardian', formatPersonName({ firstName: input.guardianFirstName, lastName: input.guardianLastName })],
      ['Email', input.familyEmail],
      ['Child', childName],
      ['Child age', formatAgeFromBirthdate(input.childBirthdate)],
      ['Class', input.classTitle],
      ['Category', input.classCategory],
      ['Class time', classTime],
      ['Schedule label', input.classScheduleLabel],
      ['Instructor', input.instructorName],
      ['Price', formatPrice(input.priceCents)],
      ['Status', input.status],
      ['Registration ID', input.registrationId],
    ],
    ctaHref: siteUrl ? `${siteUrl}/staff/classes` : null,
    ctaLabel: 'Open class management',
  });

  return sendResendEmail({
    to,
    subject: `${registrationLabel}: ${input.classTitle ?? 'Class'}`,
    html,
  });
}
