export const PRODUCTION_HOSTNAME = 'thelittlewanderers.com';

function hasIgnoreCookie() {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((part) => part.trim() === 'lw_ignore_analytics=true');
}

export function shouldLoadAnalytics() {
  if (typeof window === 'undefined') return false;
  // Set lw_ignore_analytics=true in your browser cookies to exclude your own testing traffic.
  if (hasIgnoreCookie()) return false;

  const isProdNodeEnv = process.env.NODE_ENV === 'production';
  const isProdVercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV === 'production';
  const isProdHost = window.location.hostname === PRODUCTION_HOSTNAME;
  return isProdNodeEnv && isProdVercelEnv && isProdHost;
}
