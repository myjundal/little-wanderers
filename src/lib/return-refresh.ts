// Refresh on returning to a page, without a background polling timer.
export function startReturnRefresh(refresh: () => Promise<unknown>) {
  let stopped = false;
  let inFlight = false;
  let lastStarted = Date.now();

  const resume = async () => {
    if (stopped || document.hidden || inFlight || Date.now() - lastStarted < 1000) return;
    inFlight = true;
    lastStarted = Date.now();
    try { await refresh(); }
    catch { /* The caller owns the error UI; later returns can retry. */ }
    finally { inFlight = false; }
  };

  document.addEventListener('visibilitychange', resume);
  window.addEventListener('focus', resume);
  window.addEventListener('pageshow', resume);
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('focus', resume);
    window.removeEventListener('pageshow', resume);
  };
}
