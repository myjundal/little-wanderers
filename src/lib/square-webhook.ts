import crypto from 'node:crypto';

/** Square signs the configured notification URL followed by the untouched body. */
export function verifySquareWebhook(rawBody: string, signature: string | null, key: string | undefined, notificationUrl: string) {
  if (!key || !signature) return false;
  const expected = crypto.createHmac('sha256', key).update(notificationUrl + rawBody, 'utf8').digest('base64');
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}
