import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getOccupancyStatus } from '@/lib/occupancy';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const summary = await getOccupancyStatus(createAdminSupabaseClient());

    return Response.json({
      ok: true,
      occupancy: summary.occupancy,
      capacity: summary.capacity,
      progress: summary.progress,
      crowd_level: summary.crowdLevel,
      label: summary.crowdMeta.label,
      description: summary.crowdMeta.description,
      accent: summary.crowdMeta.accent,
      accent_strong: summary.crowdMeta.accentStrong,
      last_updated_at: summary.lastUpdatedAt,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
