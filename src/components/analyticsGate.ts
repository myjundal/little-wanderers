export const PRODUCTION_HOSTNAME = 'thelittlewanderers.com';
const PRODUCTION_HOSTNAME_ALIASES = new Set([PRODUCTION_HOSTNAME, `www.${PRODUCTION_HOSTNAME}`]);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

const OPT_OUT_COOKIE = 'lw_ignore_analytics=true';
const OPT_OUT_COOKIE_CLEAR = 'lw_ignore_analytics=; Max-Age=0; Path=/; SameSite=Lax';
const OPT_OUT_STORAGE_KEY = 'lw_ignore_analytics';
const OPT_OUT_STORAGE_VALUE = 'true';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10;

function hasIgnoreCookie() {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((part) => part.trim() === OPT_OUT_COOKIE);
}

function hasIgnoreLocalStorage() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(OPT_OUT_STORAGE_KEY) === OPT_OUT_STORAGE_VALUE;
}

export function setAnalyticsOptOut() {
  if (typeof window === 'undefined') return;
  document.cookie = `${OPT_OUT_COOKIE}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
  window.localStorage.setItem(OPT_OUT_STORAGE_KEY, OPT_OUT_STORAGE_VALUE);
}

export function clearAnalyticsOptOut() {
  if (typeof window === 'undefined') return;
  document.cookie = OPT_OUT_COOKIE_CLEAR;
  window.localStorage.removeItem(OPT_OUT_STORAGE_KEY);
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

  if (hasIgnoreCookie() || hasIgnoreLocalStorage()) return false;

  const hostname = window.location.hostname;
  if (LOCAL_HOSTNAMES.has(hostname)) return false;

  return PRODUCTION_HOSTNAME_ALIASES.has(hostname);
}
