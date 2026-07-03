import { sendResendEmail } from '@/lib/email-campaigns';

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

export async function sendNewSignupNotification(input: {
  householdId: string;
  householdName: string;
  adultName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  childCount: number;
}) {
  const to = process.env.OWNER_EMAIL?.trim();
  if (!to) return { ok: false as const, error: 'OWNER_EMAIL is not configured.' };

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
  const familyUrl = siteUrl ? `${siteUrl}/staff/families/${input.householdId}` : null;
  const rows = [
    ['Family', input.householdName],
    ['Adult', input.adultName],
    ['Email', input.email],
    ['Phone', input.phone],
    ['City', `${input.city}, ${input.state}`],
    ['Children', input.childCount],
  ];

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#ffffff;color:#3f355a;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
    <main style="max-width:620px;margin:0 auto;">
      <h1 style="font-size:22px;margin:0 0 14px;color:#4f3f82;">New Little Wanderers signup</h1>
      <table style="width:100%;border-collapse:collapse;">
        <tbody>
          ${rows.map(([label, value]) => `
            <tr>
              <th style="text-align:left;width:140px;padding:8px 10px;border-bottom:1px solid #eadff3;color:#6d6480;">${escapeHtml(String(label))}</th>
              <td style="padding:8px 10px;border-bottom:1px solid #eadff3;color:#3f355a;">${formatOptional(value)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${familyUrl ? `<p style="margin:18px 0 0;"><a href="${escapeHtml(familyUrl)}" style="color:#5f3da4;font-weight:700;">Open family profile</a></p>` : ''}
    </main>
  </body>
</html>`;

  return sendResendEmail({
    to,
    subject: `New signup: ${input.householdName}`,
    html,
  });
}
