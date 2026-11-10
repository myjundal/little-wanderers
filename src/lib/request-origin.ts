/** Compare the browser Origin with its public Host; Next can use an internal hostname in request.url. */
export function isSameOriginRequest(request: Request) {
  try {
    const origin = new URL(request.headers.get('origin') ?? '');
    const internal = new URL(request.url);
    return origin.host === (request.headers.get('host') ?? internal.host) && origin.protocol === internal.protocol;
  } catch { return false; }
}
