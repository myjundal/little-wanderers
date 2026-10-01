import { requireStaffContext } from '@/lib/authz';

export const dynamic = 'force-dynamic';

const CLASS_TIME_ZONE = 'America/New_York';

function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isMissingClassDetailColumn(message: string) {
  return /column .* does not exist|Could not find the '.*' column/i.test(message);
}

function isMissingDurationColumn(message: string) {
  return /duration_minutes/i.test(message) && isMissingClassDetailColumn(message);
}

function normalizedText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function localDateParts(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLASS_TIME_ZONE,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  if (!weekday || hour == null || minute == null) return null;
  return `${weekday}:${Number(hour)}:${Number(minute)}`;
}

function localSeriesTimeKey(row: { start_time: string; end_time: string }) {
  const start = localDateParts(row.start_time);
  const end = localDateParts(row.end_time);
  if (!start || !end) return null;
  return `${start}-${end}`;
}

function isSameEditableSeries(
  row: { id: string; title: string; start_time: string; end_time: string; schedule_label?: string | null },
  original: { id: string; title: string; start_time: string; end_time: string; schedule_label?: string | null }
) {
  if (row.id === original.id) return false;
  if (localSeriesTimeKey(row) !== localSeriesTimeKey(original)) return false;

  const originalSchedule = normalizedText(original.schedule_label);
  const rowSchedule = normalizedText(row.schedule_label);
  const sameSchedule = Boolean(originalSchedule && rowSchedule && originalSchedule === rowSchedule);
  return normalizedText(row.title) === normalizedText(original.title) || sameSchedule;
}

function parseClassPayload(body: Record<string, unknown>) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const category = normalizeOptionalText(body.category);
  const instructor_name = normalizeOptionalText(body.instructor_name);
  const description = normalizeOptionalText(body.description);
  const age_range = normalizeOptionalText(body.age_range);
  const caregiver_participation = normalizeOptionalText(body.caregiver_participation);
  const schedule_note = normalizeOptionalText(body.schedule_note);
  const schedule_label = normalizeOptionalText(body.schedule_label);
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

  const duration_minutes = Math.max(Math.round((end.getTime() - start.getTime()) / 60_000), 1);
  const baseData = {
    title,
    category,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    capacity,
    price_cents: Math.round(price_cents),
    status,
    instructor_name,
    description,
    age_range,
    caregiver_participation,
    schedule_note,
    schedule_label,
  };

  return {
    data: { ...baseData, duration_minutes },
    dataWithoutDuration: baseData,
  } as const;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const applyToSeries = body.apply_to_series === true;
    const parsed = parseClassPayload(body);
    if ('error' in parsed) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

    const { data: original, error: originalError } = applyToSeries
      ? await context.admin.from('classes').select('id,title,start_time,end_time,schedule_label').eq('id', params.id).maybeSingle()
      : { data: null, error: null };

    if (originalError) return Response.json({ ok: false, error: originalError.message }, { status: 500 });

    const primary = await context.admin.from('classes').update(parsed.data).eq('id', params.id);
    if (primary.error) {
      if (isMissingDurationColumn(primary.error.message)) {
        const fallback = await context.admin.from('classes').update(parsed.dataWithoutDuration).eq('id', params.id);
        if (!fallback.error) return Response.json({ ok: true });
        return Response.json({ ok: false, error: fallback.error.message }, { status: 500 });
      }
      if (isMissingClassDetailColumn(primary.error.message)) {
        return Response.json(
          { ok: false, error: 'Class detail columns are missing. Run the latest class metadata migration, then save the class again.' },
          { status: 500 }
        );
      }
      return Response.json({ ok: false, error: primary.error.message }, { status: 500 });
    }

    if (applyToSeries && original) {
      const { data: rows, error: rowsError } = await context.admin
        .from('classes')
        .select('id,title,start_time,end_time,schedule_label');

      if (rowsError) return Response.json({ ok: false, error: rowsError.message }, { status: 500 });

      const seriesIds = (rows ?? [])
        .filter((row) => isSameEditableSeries(row, original))
        .map((row) => row.id);

      if (seriesIds.length > 0) {
        const seriesData = {
          title: parsed.data.title,
          category: parsed.data.category,
          capacity: parsed.data.capacity,
          price_cents: parsed.data.price_cents,
          instructor_name: parsed.data.instructor_name,
          description: parsed.data.description,
          age_range: parsed.data.age_range,
          caregiver_participation: parsed.data.caregiver_participation,
          schedule_note: parsed.data.schedule_note,
          schedule_label: parsed.data.schedule_label,
          status: parsed.data.status,
        };
        const seriesUpdate = await context.admin.from('classes').update(seriesData).in('id', seriesIds);
        if (seriesUpdate.error) {
          return Response.json({ ok: false, error: seriesUpdate.error.message }, { status: 500 });
        }
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
    const { data: registrations, error: registrationErr } = await context.admin
      .from('class_registrations')
      .select('id')
      .eq('class_id', params.id)
      .limit(1);

    if (registrationErr) return Response.json({ ok: false, error: registrationErr.message }, { status: 500 });
    if ((registrations ?? []).length > 0) {
      return Response.json({ ok: false, error: 'This class has registrations. Cancel it instead of deleting it.' }, { status: 409 });
    }

    const { error } = await context.admin.from('classes').delete().eq('id', params.id);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
