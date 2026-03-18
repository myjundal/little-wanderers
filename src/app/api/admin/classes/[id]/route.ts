import { requireStaffContext } from '@/lib/authz';

function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isMissingColumnError(message: string) {
  return /column .* does not exist|Could not find the '.*' column/i.test(message);
}

function parseClassPayload(body: Record<string, unknown>) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const category = normalizeOptionalText(body.category);
  const instructor_name = normalizeOptionalText(body.instructor_name);
  const description = normalizeOptionalText(body.description);
  const start_time = typeof body.start_time === 'string' ? body.start_time : '';
  const end_time = typeof body.end_time === 'string' ? body.end_time : '';
  const capacity = body.capacity == null || body.capacity === '' ? null : Number(body.capacity);
  const price_cents = body.price_cents == null || body.price_cents === '' ? 0 : Number(body.price_cents);
  const status = body.status === 'cancelled' ? 'cancelled' : 'scheduled';

  const start = new Date(start_time);
  const end = new Date(end_time);

  if (!title) return { error: 'class title is required' } as const;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { error: 'start time and end time must form a valid range' } as const;
  }
  if (capacity != null && (!Number.isInteger(capacity) || capacity < 0)) {
    return { error: 'capacity must be a whole number greater than or equal to 0' } as const;
  }
  if (!Number.isFinite(price_cents) || price_cents < 0) {
    return { error: 'price must be greater than or equal to 0' } as const;
  }

  const baseData = {
    title,
    category,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    capacity,
    price_cents: Math.round(price_cents),
    status,
  };

  return {
    data: {
      ...baseData,
      duration_minutes: Math.max(Math.round((end.getTime() - start.getTime()) / 60_000), 1),
      instructor_name,
      description,
    },
    fallbackData: baseData,
  } as const;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const parsed = parseClassPayload((await req.json()) as Record<string, unknown>);
    if ('error' in parsed) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

    const primary = await context.admin.from('classes').update(parsed.data).eq('id', params.id);
    if (primary.error) {
      if (!isMissingColumnError(primary.error.message)) {
        return Response.json({ ok: false, error: primary.error.message }, { status: 500 });
      }

      const fallback = await context.admin.from('classes').update(parsed.fallbackData).eq('id', params.id);
      if (fallback.error) {
        return Response.json({ ok: false, error: fallback.error.message }, { status: 500 });
      }
    }

    return Response.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const { error } = await context.admin.from('classes').delete().eq('id', params.id);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
