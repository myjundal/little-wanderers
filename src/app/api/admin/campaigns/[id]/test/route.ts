import { requireStaffContext } from '@/lib/authz';
import { getSiteUrl, renderMarketingEmail, sendResendEmail, validateEmail } from '@/lib/email-campaigns';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const body = (await req.json()) as { to?: string };
    const to = validateEmail(String(body.to ?? context.user.email ?? ''));
    if (!to) return Response.json({ ok: false, error: 'Please enter a valid test email.' }, { status: 400 });

    const { data: campaign, error } = await context.admin
      .from('email_campaigns')
      .select('id,subject,preview_text,body_html')
      .eq('id', params.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!campaign) return Response.json({ ok: false, error: 'Campaign not found.' }, { status: 404 });
    if (!campaign.subject || !campaign.body_html) {
      return Response.json({ ok: false, error: 'Save a subject and body before sending a test.' }, { status: 400 });
    }

    const html = renderMarketingEmail({
      campaign,
      unsubscribeUrl: `${getSiteUrl()}/unsubscribe?token=test`,
    });

    const { data: sendRow, error: insertError } = await context.admin
      .from('email_sends')
      .insert({
        campaign_id: params.id,
        send_type: 'test',
        email: to,
        status: 'queued',
        metadata: { sent_by: context.user.id },
      })
      .select('id')
      .single();

    if (insertError) throw new Error(insertError.message);

    const result = await sendResendEmail({ to, subject: `[TEST] ${campaign.subject}`, html });
    const status = result.ok ? 'sent' : 'failed';

    await context.admin
      .from('email_sends')
      .update({
        status,
        provider_message_id: result.ok ? result.id : null,
        error_message: result.ok ? null : result.error,
        sent_at: result.ok ? new Date().toISOString() : null,
      })
      .eq('id', sendRow.id);

    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 502 });

    await context.admin.from('email_campaigns').update({ test_sent_at: new Date().toISOString(), updated_by: context.user.id }).eq('id', params.id);

    return Response.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
