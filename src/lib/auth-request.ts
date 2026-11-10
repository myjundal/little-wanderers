export const AUTH_REQUEST_TIMEOUT_MS = 15_000;
const AUTH_FETCH_TIMEOUT_MS = 14_000;

export async function withAuthDeadline<T>(
  operation: () => Promise<T>,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('auth_request_timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Bound the actual transport too, so the SDK does not leave auth requests hanging.
// Other Supabase API requests keep their existing behavior.
export async function fetchWithAuthTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = AUTH_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes('/auth/v1/')) return fetch(input, init);

  const controller = new AbortController();
  const originalSignal = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
  const forwardAbort = () => controller.abort(originalSignal?.reason);
  if (originalSignal?.aborted) forwardAbort();
  else originalSignal?.addEventListener('abort', forwardAbort, { once: true });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error('auth_request_timeout');
    throw error;
  } finally {
    clearTimeout(timer);
    originalSignal?.removeEventListener('abort', forwardAbort);
  }
}
