import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // Square opens the iOS default browser, whose cookies can differ from a Home
  // Screen app. Render a public return bridge before the protected staff layout.
  // Staff APIs still require the original authenticated operator.
  if (request.nextUrl.pathname === '/staff/checkin' && request.nextUrl.searchParams.has('data')) {
    const destination = request.nextUrl.clone();
    destination.pathname = '/square-pos-return';
    const response = NextResponse.rewrite(destination);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }
  const headers = new Headers(request.headers);
  headers.set('x-lw-next-path', request.nextUrl.pathname + request.nextUrl.search);
  let response = NextResponse.next({ request: { headers } });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        headers.set('cookie', request.headers.get('cookie') ?? '');
        response = NextResponse.next({ request: { headers } });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/landing/:path*', '/staff/:path*'] };
