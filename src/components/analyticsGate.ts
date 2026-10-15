export const PRODUCTION_HOSTNAME = 'thelittlewanderers.com';
const PRODUCTION_HOSTNAME_ALIASES = new Set([PRODUCTION_HOSTNAME, `www.${PRODUCTION_HOSTNAME}`]);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0']);
const EXCLUDED_PATH_PREFIXES = ['/analytics-opt-out', '/owner', '/staff'];

const OPT_OUT_COOKIE = 'lw_ignore_analytics=true';
const OPT_OUT_COOKIE_CLEAR = 'lw_ignore_analytics=; Max-Age=0; Path=/; SameSite=Lax';
const OPT_OUT_STORAGE_KEY = 'lw_ignore_analytics';
const OPT_OUT_STORAGE_VALUE = 'true';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10;

declare global {
  interface Window {
    'ga-disable-G-RHZ3580FJ8'?: boolean;
  }
}

function hasIgnoreCookie() {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((part) => part.trim() === OPT_OUT_COOKIE);
}

function hasIgnoreLocalStorage() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(OPT_OUT_STORAGE_KEY) === OPT_OUT_STORAGE_VALUE;
  } catch {
    return false;
  }
}

export function setAnalyticsOptOut() {
  if (typeof window === 'undefined') return;
  window['ga-disable-G-RHZ3580FJ8'] = true;
  const domain = PRODUCTION_HOSTNAME_ALIASES.has(window.location.hostname) ? `; Domain=${PRODUCTION_HOSTNAME}; Secure` : '';
  document.cookie = `${OPT_OUT_COOKIE}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${domain}`;
  try { window.localStorage.setItem(OPT_OUT_STORAGE_KEY, OPT_OUT_STORAGE_VALUE); } catch { /* Cookie still excludes this browser. */ }
}

export function clearAnalyticsOptOut() {
  if (typeof window === 'undefined') return;
  window['ga-disable-G-RHZ3580FJ8'] = false;
  document.cookie = OPT_OUT_COOKIE_CLEAR;
  if (PRODUCTION_HOSTNAME_ALIASES.has(window.location.hostname)) {
    document.cookie = `${OPT_OUT_COOKIE_CLEAR}; Domain=${PRODUCTION_HOSTNAME}; Secure`;
  }
  try { window.localStorage.removeItem(OPT_OUT_STORAGE_KEY); } catch { /* Cookie preference is cleared above. */ }
}

export function syncAnalyticsOptPreferenceFromUrl() {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  const shouldOptOut = url.searchParams.get('ga_opt_out') === '1';
  const shouldOptIn = url.searchParams.get('ga_opt_in') === '1';

  if (!shouldOptOut && !shouldOptIn) return;

  if (shouldOptOut) setAnalyticsOptOut();
  if (shouldOptIn) clearAnalyticsOptOut();

  url.searchParams.delete('ga_opt_out');
  url.searchParams.delete('ga_opt_in');
  const normalizedUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, '', normalizedUrl || '/');
}

export function shouldLoadAnalytics() {
  if (typeof window === 'undefined') return false;

  syncAnalyticsOptPreferenceFromUrl();

  if (EXCLUDED_PATH_PREFIXES.some((prefix) => window.location.pathname.startsWith(prefix))) return false;

  if (hasIgnoreCookie() || hasIgnoreLocalStorage()) {
    setAnalyticsOptOut();
    return false;
  }

  const hostname = window.location.hostname;
  if (LOCAL_HOSTNAMES.has(hostname)) return false;

  return PRODUCTION_HOSTNAME_ALIASES.has(hostname);
}
