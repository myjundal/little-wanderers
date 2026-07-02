import { requireStaffContext } from '@/lib/authz';
import { parseCampaignPayload } from '@/lib/email-campaigns';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const { data, error } = await context.admin
      .from('email_campaigns')
      .select('id,name,subject,preview_text,body_html,status,test_sent_at,sent_at,created_at,updated_at')
      .eq('id', params.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return Response.json({ ok: false, error: 'Campaign not found.' }, { status: 404 });

    return Response.json({ ok: true, campaign: data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const parsed = parseCampaignPayload((await req.json()) as Record<string, unknown>);
    if ('error' in parsed) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

    const { data, error } = await context.admin
      .from('email_campaigns')
      .update({ ...parsed.data, updated_by: context.user.id })
      .eq('id', params.id)
      .select('id,name,subject,preview_text,body_html,status,test_sent_at,sent_at,created_at,updated_at')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return Response.json({ ok: false, error: 'Campaign not found.' }, { status: 404 });

    return Response.json({ ok: true, campaign: data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
