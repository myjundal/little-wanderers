import { requireStaffContext } from '@/lib/authz';
import { normalizeCampaignTags, normalizeContactEmail, validateEmail } from '@/lib/email-campaigns';
import type { SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

type ContactRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  source: string;
  unsubscribed_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  created_at: string;
};

async function loadContactItems(admin: SupabaseClient, q: string) {
  let query = admin
    .from('contacts')
    .select('id,email,first_name,last_name,source,unsubscribed_at,bounced_at,complained_at,created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (q) {
    const pattern = `%${q.replace(/[%_]/g, '')}%`;
    query = query.or(`email.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern},source.ilike.${pattern}`);
  }

  const { data: contacts, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (contacts ?? []) as ContactRow[];
  const ids = rows.map((item) => item.id);
  const tagsByContact = new Map<string, string[]>();

  if (ids.length > 0) {
    const { data: tags, error: tagError } = await admin
      .from('contact_tags')
      .select('contact_id,tag')
      .in('contact_id', ids);

    if (tagError) throw new Error(tagError.message);

    (tags ?? []).forEach((row) => {
      const contactId = row.contact_id as string;
      const list = tagsByContact.get(contactId) ?? [];
      list.push(row.tag as string);
      tagsByContact.set(contactId, list);
    });
  }

  return rows.map((item) => ({
    ...item,
    tags: (tagsByContact.get(item.id) ?? []).sort((a, b) => a.localeCompare(b)),
  }));
}

export async function GET(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
    const items = await loadContactItems(context.admin, q);

    return Response.json({ ok: true, items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const body = (await req.json()) as {
      email?: string;
      first_name?: string;
      last_name?: string;
      tags?: string[];
    };

    const email = validateEmail(String(body.email ?? ''));
    if (!email) return Response.json({ ok: false, error: 'Please enter a valid email.' }, { status: 400 });

    const normalizedEmail = normalizeContactEmail(email);
    if (!normalizedEmail) return Response.json({ ok: false, error: 'Please enter a valid email.' }, { status: 400 });

    const firstName = typeof body.first_name === 'string' && body.first_name.trim() ? body.first_name.trim() : null;
    const lastName = typeof body.last_name === 'string' && body.last_name.trim() ? body.last_name.trim() : null;
    const tags = normalizeCampaignTags(body.tags);

    const existing = await context.admin
      .from('contacts')
      .select('id,first_name,last_name,source,raw_metadata')
      .eq('normalized_email', normalizedEmail)
      .maybeSingle();

    if (existing.error) throw new Error(existing.error.message);

    let contactId = existing.data?.id as string | undefined;

    if (contactId) {
      const { error: updateError } = await context.admin
        .from('contacts')
        .update({
          email,
          first_name: firstName ?? existing.data?.first_name ?? null,
          last_name: lastName ?? existing.data?.last_name ?? null,
          raw_metadata: {
            ...((existing.data?.raw_metadata as Record<string, unknown> | null) ?? {}),
            manually_updated_by: context.user.id,
          },
        })
        .eq('id', contactId);
      if (updateError) throw new Error(updateError.message);
    } else {
      const { data: inserted, error: insertError } = await context.admin
        .from('contacts')
        .insert({
          email,
          normalized_email: normalizedEmail,
          first_name: firstName,
          last_name: lastName,
          source: 'manual',
          raw_metadata: { manually_added_by: context.user.id },
        })
        .select('id')
        .single();

      if (insertError) throw new Error(insertError.message);
      contactId = inserted.id as string;
    }

    if (tags.length > 0 && contactId) {
      const { error: tagError } = await context.admin
        .from('contact_tags')
        .upsert(tags.map((tag) => ({ contact_id: contactId, tag })), { onConflict: 'contact_id,tag' });
      if (tagError) throw new Error(tagError.message);
    }

    return Response.json({ ok: true, id: contactId, items: await loadContactItems(context.admin, email) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const body = (await req.json()) as {
      contact_ids?: string[];
      tag?: string;
      action?: 'add' | 'remove';
    };

    const contactIds = [...new Set((Array.isArray(body.contact_ids) ? body.contact_ids : [])
      .filter((item) => typeof item === 'string' && /^[0-9a-f-]{36}$/i.test(item))
    )];
    const tag = normalizeCampaignTags([body.tag])[0];
    const action = body.action === 'remove' ? 'remove' : 'add';

    if (contactIds.length === 0) {
      return Response.json({ ok: false, error: 'Select at least one contact.' }, { status: 400 });
    }

    if (contactIds.length > 200) {
      return Response.json({ ok: false, error: 'Please update 200 contacts or fewer at a time.' }, { status: 400 });
    }

    if (!tag) {
      return Response.json({ ok: false, error: 'Tag must use lowercase letters, numbers, underscores, dashes, or colons.' }, { status: 400 });
    }

    if (action === 'remove') {
      const { error } = await context.admin
        .from('contact_tags')
        .delete()
        .in('contact_id', contactIds)
        .eq('tag', tag);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.admin
        .from('contact_tags')
        .upsert(contactIds.map((contactId) => ({ contact_id: contactId, tag })), { onConflict: 'contact_id,tag' });
      if (error) throw new Error(error.message);
    }

    return Response.json({ ok: true, updated_count: contactIds.length });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
