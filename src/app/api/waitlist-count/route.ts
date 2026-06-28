import { getWaitlistCount } from '@/lib/waitlist-count';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { displayCount } = await getWaitlistCount();

  return Response.json({ displayCount }, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
