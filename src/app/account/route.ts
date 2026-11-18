import { getCurrentUserRole, isStaffRole } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { user, role, roles } = await getCurrentUserRole();
  const destination = !user ? '/login' : isStaffRole(role) ? '/staff/dashboard'
    : roles.includes('instructor') ? '/teaching' : '/landing';
  const response = Response.redirect(new URL(destination, request.url), 307);
  // Do not let a browser or CDN reuse one person's account destination.
  return new Response(null, { status: response.status, headers: {
    Location: response.headers.get('location')!, 'Cache-Control': 'private, no-store',
  } });
}
