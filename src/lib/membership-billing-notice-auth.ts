import { createHmac, timingSafeEqual } from 'node:crypto';

/** A purpose-bound trigger credential; the email provider key never leaves the server. */
export function membershipNoticeTriggerToken() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('Membership email transport is not configured.');
  return createHmac('sha256', key).update('little-wanderers:membership-billing-notices:trigger:v1').digest('hex');
}

export function authorizeMembershipNoticeTrigger(req: Request) {
  try {
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('authorization') ?? '');
    if (!match) return false;
    return timingSafeEqual(Buffer.from(match[1], 'hex'), Buffer.from(membershipNoticeTriggerToken(), 'hex'));
  } catch { return false; }
}
