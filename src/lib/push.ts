import { logger } from '@/lib/logger';

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
};

type WebPushModule = {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;
};

let configured = false;
let webpushModule: WebPushModule | null = null;

function loadWebPush(): WebPushModule | null {
  if (webpushModule) return webpushModule;

  try {
    const req = eval('require') as (moduleName: string) => unknown;
    const loaded = req('web-push') as { default?: WebPushModule } | WebPushModule;
    webpushModule = (loaded as { default?: WebPushModule }).default ?? (loaded as WebPushModule);
    return webpushModule;
  } catch (error) {
    logger.warn({ action: 'push.webpush_module_missing' }, error);
    return null;
  }
}

function ensureConfigured() {
  if (configured) return true;
  const webpush = loadWebPush();
  if (!webpush) return false;

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
  const webpush = loadWebPush();
  if (!webpush || !ensureConfigured()) {
    logger.warn({ action: 'push.missing_vapid_keys_or_module' });
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
