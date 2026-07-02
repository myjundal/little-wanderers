import { requireStaffContext } from '@/lib/authz';

export const dynamic = 'force-dynamic';

const DEFAULT_TAGS = ['customer', 'waitlist', 'party_early_access'];

export async function GET() {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const [{ data: tagRows, error: tagError }, { data: contacts, error: contactsError }] = await Promise.all([
      context.admin.from('contact_tags').select('tag,contact_id'),
      context.admin
        .from('contacts')
        .select('id')
        .is('unsubscribed_at', null)
        .is('bounced_at', null)
        .is('complained_at', null),
    ]);

    if (tagError) throw new Error(tagError.message);
    if (contactsError) throw new Error(contactsError.message);

    const eligibleIds = new Set((contacts ?? []).map((contact) => contact.id as string));
    const counts = new Map<string, number>();

    (tagRows ?? []).forEach((row) => {
      if (!eligibleIds.has(row.contact_id as string)) return;
      const tag = row.tag as string;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });

    const allTags = [...new Set([...DEFAULT_TAGS, ...counts.keys()])].sort((a, b) => a.localeCompare(b));

    return Response.json({
      ok: true,
      total_count: eligibleIds.size,
      tags: allTags.map((tag) => ({ tag, count: counts.get(tag) ?? 0 })),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
