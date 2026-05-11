export const PRODUCTION_HOSTNAME = 'thelittlewanderers.com';
const PRODUCTION_HOSTNAME_ALIASES = new Set([PRODUCTION_HOSTNAME, `www.${PRODUCTION_HOSTNAME}`]);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

function hasIgnoreCookie() {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((part) => part.trim() === 'lw_ignore_analytics=true');
}

export function shouldLoadAnalytics() {
  if (typeof window === 'undefined') return false;
  // Set lw_ignore_analytics=true in your browser cookies to exclude your own testing traffic.
  if (hasIgnoreCookie()) return false;

  const hostname = window.location.hostname;
  if (LOCAL_HOSTNAMES.has(hostname)) return false;

  return PRODUCTION_HOSTNAME_ALIASES.has(hostname);
}
