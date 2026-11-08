import { requireOwnerContext } from '@/lib/authz';
import { createSeriesInvoiceDraft, updateSeriesDraftPaymentNote, publishSeriesInvoice, readSeriesSale, reconcileSeriesSales } from '@/lib/class-series-payments';

export const maxDuration = 60;
export async function POST(req: Request) {
  const ctx = await requireOwnerContext();
  if (!ctx.ok) return ctx.response;
  try {
    const body = await req.json();
    if (body.action === 'refresh') {
      await reconcileSeriesSales(ctx.admin);
      return Response.json({ ok: true });
    }
    if (body.action === 'update_draft_note') {
      if (typeof body.sale_id !== 'string') return Response.json({ ok: false, error: 'Choose an unsent draft.' }, { status: 400 });
      const { sale, description } = await updateSeriesDraftPaymentNote(ctx.admin, await readSeriesSale(ctx.admin, body.sale_id));
      return Response.json({ ok: true, id: sale.id, status: sale.status, sent: false, description });
    }
    if (body.action === 'send') {
      if (body.send_confirmed !== true || typeof body.sale_id !== 'string') return Response.json({ ok: false, error: 'Review the recipient, amount, and terms, then confirm Send.' }, { status: 400 });
      const sale = await publishSeriesInvoice(ctx.admin, await readSeriesSale(ctx.admin, body.sale_id), true);
      return Response.json({ ok: true, id: sale.id, status: sale.status, sent: Boolean(sale.sent_at) });
    }
    if (body.action !== 'draft' || typeof body.household_id !== 'string' || !Array.isArray(body.child_ids)) return Response.json({ ok: false, error: 'Choose a family invoice.' }, { status: 400 });
    const sale = await createSeriesInvoiceDraft(ctx.admin, { householdId: body.household_id, childIds: body.child_ids, userId: ctx.user.id, source: 'invoice' });
    return Response.json({ ok: true, id: sale.id, status: sale.status, sent: false });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to prepare invoice.' }, { status: 409 });
  }
}
