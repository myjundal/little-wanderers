import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getPostAuthRedirectForUser } from '@/lib/waitlist-claim';

export const dynamic = 'force-dynamic';

function getRedirectUrl(request: NextRequest, path: string) {
  return new URL(path, request.url);
}

export async function GET(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(getRedirectUrl(request, '/login'));
  }

  const redirectPath = await getPostAuthRedirectForUser(user, '/landing');
  return NextResponse.redirect(getRedirectUrl(request, redirectPath));
}
