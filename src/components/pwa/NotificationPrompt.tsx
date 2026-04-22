'use client';

import { useEffect, useState } from 'react';

const DISMISS_KEY = 'lw_push_prompt_dismissed_v1';

function decodeBase64Url(base64Url: string) {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const normalized = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export default function NotificationPrompt() {
  const [hidden, setHidden] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (Notification.permission === 'granted' || localStorage.getItem(DISMISS_KEY) === '1') return;
    setHidden(false);
  }, []);

  const enable = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setMessage('Notifications are not supported on this device yet.');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setMessage('Maybe later — you can enable notifications anytime in your browser settings.');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    if (!publicKey) {
      setMessage('Notifications are enabled, but setup is incomplete. Please contact support.');
      return;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(publicKey),
    });

    const res = await fetch('/api/push/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...subscription,
        less_crowded_enabled: true,
        notify_when_level_at_or_below: 'moderate',
        quiet_hours_enabled: false,
        timezone_offset_minutes: new Date().getTimezoneOffset(),
      }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage('Unable to save your notification setting right now.');
      return;
    }

    setMessage('Notifications are enabled. You’ll be notified when it’s a great time to visit.');
    localStorage.setItem(DISMISS_KEY, '1');
    setHidden(true);
  };

  if (hidden) return null;

  return (
    <aside style={{ position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 999, borderRadius: 16, padding: 14, background: '#eef6ff', border: '1px solid #b9d9ff', boxShadow: '0 10px 24px rgba(0,0,0,0.12)' }}>
      <p style={{ margin: 0, color: '#284f7c', fontWeight: 700 }}>Get notified when it’s less busy and a great time to visit.</p>
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button type="button" onClick={enable} style={{ borderRadius: 999, border: 'none', background: '#3273c9', color: '#fff', padding: '9px 14px', fontWeight: 700 }}>
          Enable Notifications
        </button>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, '1');
            setHidden(true);
          }}
          style={{ borderRadius: 999, border: '1px solid #b9d9ff', background: '#fff', color: '#284f7c', padding: '9px 14px' }}
        >
          Maybe later
        </button>
      </div>
      {message && <p style={{ margin: '8px 0 0', color: '#2f7a44' }}>{message}</p>}
    </aside>
  );
}
