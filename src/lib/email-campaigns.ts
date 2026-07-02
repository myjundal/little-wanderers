import type { SupabaseClient } from '@supabase/supabase-js';
import { isLikelyEmail, normalizeWaitlistEmail } from '@/lib/waitlist';

export const CAMPAIGN_BATCH_SIZE = 100;
export const DEFAULT_MARKETING_ADDRESS = "Little Wanderers, Bishop's Corner, West Hartford, CT";

export type CampaignRecipient = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  unsubscribe_token: string;
};

export type EmailCampaign = {
  id: string;
  name: string;
  subject: string;
  preview_text: string;
  body_html: string;
  status: 'draft' | 'sending' | 'sent';
  test_sent_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

export function normalizeContactEmail(input: string) {
  return normalizeWaitlistEmail(input);
}

export function parseCampaignPayload(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled campaign';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const preview_text = typeof body.preview_text === 'string' ? body.preview_text.trim() : '';
  const body_html = typeof body.body_html === 'string' ? body.body_html.trim() : '';

  if (!subject) return { error: 'Subject is required.' } as const;
  if (!body_html) return { error: 'Email body is required.' } as const;

  return { data: { name, subject, preview_text, body_html } } as const;
}

export function validateEmail(input: string) {
  const email = input.trim().toLowerCase();
  if (!isLikelyEmail(email)) return null;
  return email;
}

export function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMarketingEmail(input: {
  campaign: Pick<EmailCampaign, 'subject' | 'preview_text' | 'body_html'>;
  unsubscribeUrl: string;
  physicalAddress?: string;
}) {
  const address = input.physicalAddress?.trim() || process.env.MARKETING_PHYSICAL_ADDRESS || DEFAULT_MARKETING_ADDRESS;
  const preheader = input.campaign.preview_text
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.campaign.preview_text)}</div>`
    : '';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#fbf8f3;color:#4f3f82;font-family:Arial,sans-serif;">
    ${preheader}
    <main style="max-width:640px;margin:0 auto;background:#ffffff;padding:24px;line-height:1.6;">
      ${input.campaign.body_html}
      <hr style="border:0;border-top:1px solid #eadff3;margin:28px 0 16px;" />
      <p style="font-size:12px;color:#6d6480;margin:0 0 8px;">
        You are receiving this because you joined Little Wanderers updates.
      </p>
      <p style="font-size:12px;color:#6d6480;margin:0 0 8px;">
        ${escapeHtml(address)}
      </p>
      <p style="font-size:12px;color:#6d6480;margin:0;">
        <a href="${input.unsubscribeUrl}" style="color:#5f3da4;">Unsubscribe</a>
      </p>
    </main>
  </body>
</html>`;
}

export async function sendResendEmail(input: SendEmailInput) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { ok: false as const, error: 'RESEND_API_KEY is not configured.' };

  const from = process.env.RESEND_FROM_EMAIL ?? 'Little Wanderers <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  });

  const text = await res.text();
  let parsed: { id?: string; message?: string; error?: string } = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text };
    }
  }

  if (!res.ok) {
    return { ok: false as const, error: parsed.message || parsed.error || text || 'Failed to send email.' };
  }

  return { ok: true as const, id: parsed.id ?? null };
}

async function getContactIdsForTag(admin: SupabaseClient, tag: string) {
  const { data, error } = await admin.from('contact_tags').select('contact_id').eq('tag', tag);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => row.contact_id as string));
}

export function normalizeCampaignTags(input: unknown) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter((item) => /^[a-z0-9_:-]+$/.test(item))
  )];
}

export async function getCampaignRecipients(
  admin: SupabaseClient,
  campaignId: string,
  options: { tags?: string[]; includeAlreadySent?: boolean } = {}
) {
  const tags = normalizeCampaignTags(options.tags);
  const eligibleIds = new Set<string>();

  for (const tag of tags) {
    const ids = await getContactIdsForTag(admin, tag);
    ids.forEach((id) => eligibleIds.add(id));
  }

  let query = admin
    .from('contacts')
    .select('id,email,first_name,last_name,unsubscribe_token')
    .is('unsubscribed_at', null)
    .is('bounced_at', null)
    .is('complained_at', null)
    .order('created_at', { ascending: true });

  if (tags.length > 0) {
    if (eligibleIds.size === 0) return [];
    query = query.in('id', [...eligibleIds]);
  }

  const { data: contacts, error } = await query;

  if (error) throw new Error(error.message);

  let recipients = (contacts ?? []) as CampaignRecipient[];
  if (options.includeAlreadySent) return recipients;

  const { data: sends, error: sendsError } = await admin
    .from('email_sends')
    .select('contact_id')
    .eq('campaign_id', campaignId)
    .eq('send_type', 'campaign')
    .not('contact_id', 'is', null);

  if (sendsError) throw new Error(sendsError.message);

  const alreadySent = new Set((sends ?? []).map((row) => row.contact_id as string));
  recipients = recipients.filter((contact) => !alreadySent.has(contact.id));
  return recipients;
}

export function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
}
