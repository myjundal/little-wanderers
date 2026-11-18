// Start network refreshes only while this tab is visible. Resume immediately on
// return, and coalesce focus/pageshow/visibility events into one request.
export function startVisiblePolling(
  refresh: () => void | Promise<unknown>,
  intervalMs: number,
  { immediate = true }: { immediate?: boolean } = {},
) {
  let stopped = false;
  let inFlight = false;
  let lastStarted = -Infinity;
  let timer: number | undefined;

  const run = async () => {
    if (stopped || document.hidden || inFlight || Date.now() - lastStarted < 1000) return;
    inFlight = true;
    lastStarted = Date.now();
    try {
      await refresh();
    } catch {
      // Refresh callbacks own their error UI; a failed background read must not
      // stop subsequent retries or produce an unhandled promise rejection.
    } finally {
      inFlight = false;
    }
  };
  const stopTimer = () => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  };
  const resume = () => {
    stopTimer();
    if (stopped || document.hidden) return;
    void run();
    timer = window.setInterval(() => { void run(); }, intervalMs);
  };

  document.addEventListener('visibilitychange', resume);
  window.addEventListener('focus', resume);
  window.addEventListener('pageshow', resume);
  if (immediate) resume();
  else if (!document.hidden) timer = window.setInterval(() => { void run(); }, intervalMs);

  return () => {
    stopped = true;
    stopTimer();
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('focus', resume);
    window.removeEventListener('pageshow', resume);
  };
}
