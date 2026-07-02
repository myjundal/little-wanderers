import { requireStaffContext } from '@/lib/authz';
import { getCampaignRecipients, normalizeCampaignTags } from '@/lib/email-campaigns';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const url = new URL(req.url);
    const tags = normalizeCampaignTags(url.searchParams.getAll('tag'));
    const recipients = await getCampaignRecipients(context.admin, params.id, { tags });

    return Response.json({
      ok: true,
      count: recipients.length,
      sample: recipients.slice(0, 5).map((item) => item.email),
      filters: {
        unsubscribed_at: null,
        bounced_at: null,
        complained_at: null,
        tags,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
