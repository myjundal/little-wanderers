import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getPostAuthRedirectForUser } from '@/lib/waitlist-claim';

export const dynamic = 'force-dynamic';

function getSafeNextPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/landing';
  return value;
}

function getRedirectUrl(request: NextRequest, path: string) {
  return new URL(path, request.url);
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = getSafeNextPath(requestUrl.searchParams.get('next'));
  const response = NextResponse.redirect(getRedirectUrl(request, next));

  if (!code) {
    return NextResponse.redirect(getRedirectUrl(request, '/login?error=missing-code'));
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options) {
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(getRedirectUrl(request, `/login?error=${encodeURIComponent(error.message)}`));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirectPath = user
    ? await getPostAuthRedirectForUser(user, next)
    : next;

  if (redirectPath === '/onboarding') {
    response.cookies.set('post_onboarding_redirect', next, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 10,
    });
  }

  response.headers.set('location', getRedirectUrl(request, redirectPath).toString());
  return response;
}
