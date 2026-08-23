import { requireStaffContext } from '@/lib/authz';

export const dynamic = 'force-dynamic';

const SENDS_PAGE_SIZE = 1000;

type SendCounts = { sent: number; failed: number; queued: number };
type SendStatusRow = {
  campaign_id: string;
  status: string;
};

function emptyCounts(): SendCounts {
  return { sent: 0, failed: 0, queued: 0 };
}

function addSendCount(sendCounts: Map<string, SendCounts>, row: SendStatusRow) {
  const current = sendCounts.get(row.campaign_id) ?? emptyCounts();
  if (row.status === 'sent') current.sent += 1;
  if (row.status === 'failed') current.failed += 1;
  if (row.status === 'queued') current.queued += 1;
  sendCounts.set(row.campaign_id, current);
}

export async function GET() {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const { data, error } = await context.admin
      .from('email_campaigns')
      .select('id,name,subject,preview_text,body_html,status,test_sent_at,sent_at,created_at,updated_at')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    const campaignIds = (data ?? []).map((item) => item.id as string);
    const sendCounts = new Map<string, { sent: number; failed: number; queued: number }>();

    if (campaignIds.length > 0) {
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: sends, error: sendsError } = await context.admin
          .from('email_sends')
          .select('id,campaign_id,status')
          .in('campaign_id', campaignIds)
          .eq('send_type', 'campaign')
          .order('created_at', { ascending: true })
          .range(from, from + SENDS_PAGE_SIZE - 1);

        if (sendsError) throw new Error(sendsError.message);

        (sends ?? []).forEach((row) => addSendCount(sendCounts, row as SendStatusRow));
        hasMore = (sends ?? []).length === SENDS_PAGE_SIZE;
        from += SENDS_PAGE_SIZE;
      }
    }

    const items = (data ?? []).map((item) => ({
      ...item,
      send_counts: sendCounts.get(item.id as string) ?? { sent: 0, failed: 0, queued: 0 },
    }));

    return Response.json({
      ok: true,
      items,
      staff_email: context.user.email ?? '',
      resend_configured: Boolean(process.env.RESEND_API_KEY),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST() {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const { data, error } = await context.admin
      .from('email_campaigns')
      .insert({
        name: `Campaign ${new Date().toLocaleDateString('en-US')}`,
        subject: 'Little Wanderers update',
        preview_text: '',
        body_html: '<p>Hello from Little Wanderers.</p>',
        created_by: context.user.id,
        updated_by: context.user.id,
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);
    return Response.json({ ok: true, id: data.id });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
