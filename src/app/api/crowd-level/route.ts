import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getOccupancyStatus } from '@/lib/occupancy';
import { getPublicOpenPlayPhase, publicCrowdMessage, publicCrowdStatus } from '@/lib/public-crowd';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
const CACHE_HEADERS = { 'cache-control': 'public, max-age=0, s-maxage=30' };
const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };

export async function GET() {
  try {
    const admin = createAdminSupabaseClient();
    const phase = await getPublicOpenPlayPhase(admin);
    if (phase !== 'open') {
      return Response.json(publicCrowdMessage(phase), { headers: CACHE_HEADERS });
    }
    const summary = await getOccupancyStatus(admin);
    if (!summary.source) throw new Error('Occupancy status is unavailable.');
    return Response.json(publicCrowdMessage(publicCrowdStatus(summary.crowdLevel)), { headers: CACHE_HEADERS });
  } catch (e: unknown) {
    logger.warn({ action: 'public-crowd-status' }, e);
    return Response.json(publicCrowdMessage('unavailable'), { status: 503, headers: NO_STORE_HEADERS });
  }
}
