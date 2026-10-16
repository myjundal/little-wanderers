/** Keep authentication redirects on this site, including URL-parser edge cases. */
export function safeAuthNextPath(value: string | null, origin: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/landing';
  try {
    const destination = new URL(value, origin);
    return destination.origin === new URL(origin).origin
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : '/landing';
  } catch {
    return '/landing';
  }
}
