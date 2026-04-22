import webpush from 'web-push';
import { logger } from '@/lib/logger';

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
};

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const contact = process.env.VAPID_SUBJECT || 'mailto:support@littlewanderersplay.com';

  if (!publicKey || !privateKey) {
    return false;
  }

  webpush.setVapidDetails(contact, publicKey, privateKey);
  configured = true;
  return true;
}

export async function sendPushBatch(items: PushSubscriptionRow[], payload: Record<string, unknown>) {
  if (!ensureConfigured()) {
    logger.warn({ action: 'push.missing_vapid_keys' });
    return { sent: 0, failed: 0 };
  }

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;

  await Promise.all(
    items.map(async (item) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: item.endpoint,
            keys: {
              p256dh: item.p256dh_key,
              auth: item.auth_key,
            },
          },
          body
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        logger.error({ action: 'push.send_failed', subscriptionId: item.id }, error);
      }
    })
  );

  return { sent, failed };
}
