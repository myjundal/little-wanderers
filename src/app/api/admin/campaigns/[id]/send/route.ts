import { requireStaffContext } from '@/lib/authz';
import {
  CAMPAIGN_BATCH_SIZE,
  chunkArray,
  getCampaignRecipients,
  getSiteUrl,
  normalizeCampaignTags,
  renderMarketingEmail,
  sendResendEmail,
} from '@/lib/email-campaigns';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const body = (await req.json()) as {
      dry_run?: boolean;
      confirm?: boolean;
      tags?: string[];
    };

    const tags = normalizeCampaignTags(body.tags);
    const recipients = await getCampaignRecipients(context.admin, params.id, { tags });

    if (body.dry_run) {
      return Response.json({
        ok: true,
        dry_run: true,
        recipient_count: recipients.length,
        batch_size: CAMPAIGN_BATCH_SIZE,
        batches: Math.ceil(recipients.length / CAMPAIGN_BATCH_SIZE),
        sample: recipients.slice(0, 5).map((item) => item.email),
        tags,
      });
    }

    if (body.confirm !== true) {
      return Response.json({ ok: false, error: 'Please confirm the campaign send.' }, { status: 400 });
    }

    const { data: campaign, error } = await context.admin
      .from('email_campaigns')
      .select('id,subject,preview_text,body_html,status,test_sent_at')
      .eq('id', params.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!campaign) return Response.json({ ok: false, error: 'Campaign not found.' }, { status: 404 });
    if (campaign.status === 'sending') return Response.json({ ok: false, error: 'This campaign is already sending.' }, { status: 409 });
    if (!campaign.test_sent_at) {
      return Response.json({ ok: false, error: 'Send a test email successfully before sending this campaign.' }, { status: 400 });
    }
    if (!campaign.subject || !campaign.body_html) {
      return Response.json({ ok: false, error: 'Campaign subject and body are required.' }, { status: 400 });
    }

    await context.admin.from('email_campaigns').update({ status: 'sending', updated_by: context.user.id }).eq('id', params.id);

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    const siteUrl = getSiteUrl();
    const batches = chunkArray(recipients, CAMPAIGN_BATCH_SIZE);

    for (const batch of batches) {
      await Promise.all(
        batch.map(async (recipient) => {
          const { data: sendRow, error: insertError } = await context.admin
            .from('email_sends')
            .insert({
              campaign_id: params.id,
              contact_id: recipient.id,
              send_type: 'campaign',
              email: recipient.email,
              status: 'queued',
              metadata: { sent_by: context.user.id },
            })
            .select('id')
            .single();

          if (insertError) {
            if (/duplicate key|already exists/i.test(insertError.message)) {
              skipped += 1;
              return;
            }
            failed += 1;
            return;
          }

          const html = renderMarketingEmail({
            campaign,
            unsubscribeUrl: `${siteUrl}/unsubscribe?token=${encodeURIComponent(recipient.unsubscribe_token)}`,
          });
          const result = await sendResendEmail({ to: recipient.email, subject: campaign.subject, html });

          await context.admin
            .from('email_sends')
            .update({
              status: result.ok ? 'sent' : 'failed',
              provider_message_id: result.ok ? result.id : null,
              error_message: result.ok ? null : result.error,
              sent_at: result.ok ? new Date().toISOString() : null,
            })
            .eq('id', sendRow.id);

          if (result.ok) sent += 1;
          else failed += 1;
        })
      );
    }

    await context.admin
      .from('email_campaigns')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        updated_by: context.user.id,
      })
      .eq('id', params.id);

    return Response.json({
      ok: true,
      recipient_count: recipients.length,
      sent,
      failed,
      skipped,
      batch_size: CAMPAIGN_BATCH_SIZE,
      batches: batches.length,
      tags,
    });
  } catch (e: unknown) {
    await context.admin.from('email_campaigns').update({ status: 'draft' }).eq('id', params.id);
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
