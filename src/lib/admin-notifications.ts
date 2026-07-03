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
  startTime: string;
  endTime: string;
  status: string;
}) {
  const to = getOwnerNotificationEmail();
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
  const partyTime = formatEasternRange(input.startTime, input.endTime);
  const html = renderOperationalNotification({
    title: 'New Little Wanderers party booking',
    rows: [
      ['Event', 'Party booking saved'],
      ['Party time', partyTime],
      ['Status', input.status],
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
