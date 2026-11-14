import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getOccupancyStatus } from '@/lib/occupancy';
import { isPublicOpenPlayOpen, publicCrowdMessage, publicCrowdStatus } from '@/lib/public-crowd';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };

export async function GET() {
  try {
    const admin = createAdminSupabaseClient();
    if (!await isPublicOpenPlayOpen(admin)) {
      return Response.json(publicCrowdMessage('closed'), { headers: NO_STORE_HEADERS });
    }
    const summary = await getOccupancyStatus(admin);
    if (!summary.source) throw new Error('Occupancy status is unavailable.');
    return Response.json(publicCrowdMessage(publicCrowdStatus(summary.crowdLevel)), { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    logger.warn({ action: 'public-crowd-status' }, e);
    return Response.json(publicCrowdMessage('unavailable'), { status: 503, headers: NO_STORE_HEADERS });
  }
}
