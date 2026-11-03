import { safeAuthNextPath } from '@/lib/auth-redirect';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getPostAuthRedirectForUser } from '@/lib/waitlist-claim';

export const dynamic = 'force-dynamic';

function getRedirectUrl(request: NextRequest, path: string) {
  return new URL(path, request.url);
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const requestedNext = request.nextUrl.searchParams.get('next');
  const next = safeAuthNextPath(requestedNext, request.url);
  if (!user) {
    const login = getRedirectUrl(request, '/login');
    login.searchParams.set('next', next);
    if (/^\/founding-membership(?:\/(?:public|waitlist))?$/.test(next)) login.searchParams.set('mode', 'continue');
    return NextResponse.redirect(login);
  }
  const redirectPath = await getPostAuthRedirectForUser(user, next);
  return NextResponse.redirect(getRedirectUrl(request, redirectPath));
}
