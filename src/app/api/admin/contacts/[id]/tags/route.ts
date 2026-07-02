import { requireStaffContext } from '@/lib/authz';
import { normalizeCampaignTags } from '@/lib/email-campaigns';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const body = (await req.json()) as { tag?: string; action?: 'add' | 'remove' };
    const tag = normalizeCampaignTags([body.tag])[0];
    const action = body.action === 'remove' ? 'remove' : 'add';

    if (!tag) return Response.json({ ok: false, error: 'Tag must use lowercase letters, numbers, underscores, dashes, or colons.' }, { status: 400 });

    if (action === 'remove') {
      const { error } = await context.admin
        .from('contact_tags')
        .delete()
        .eq('contact_id', params.id)
        .eq('tag', tag);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.admin
        .from('contact_tags')
        .upsert({ contact_id: params.id, tag }, { onConflict: 'contact_id,tag' });
      if (error) throw new Error(error.message);
    }

    return Response.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
