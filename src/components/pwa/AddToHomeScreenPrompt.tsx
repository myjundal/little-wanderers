'use client';

import { useEffect, useState } from 'react';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'lw_a2hs_prompt_dismissed_v1';

export default function AddToHomeScreenPrompt() {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;

    const handler = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallEvent);
      setHidden(false);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (hidden || !deferred) return null;

  return (
    <aside style={{ position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 1000, borderRadius: 16, padding: 14, background: '#fff8ea', border: '1px solid #f2d9a6', boxShadow: '0 10px 24px rgba(0,0,0,0.12)' }}>
      <p style={{ margin: 0, color: '#5b4b2e', fontWeight: 700 }}>Add to Home Screen for a better experience</p>
      <p style={{ margin: '6px 0 0', color: '#6d6480' }}>Add Little Wanderers to your home screen for a faster, app-like experience.</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={async () => {
            await deferred.prompt();
            localStorage.setItem(DISMISS_KEY, '1');
            setHidden(true);
          }}
          style={{ borderRadius: 999, border: 'none', background: '#6d4bb7', color: '#fff', padding: '9px 14px', fontWeight: 700 }}
        >
          Add to Home Screen
        </button>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, '1');
            setHidden(true);
          }}
          style={{ borderRadius: 999, border: '1px solid #d8c7a2', background: '#fff', color: '#5b4b2e', padding: '9px 14px' }}
        >
          Not now
        </button>
      </div>
    </aside>
  );
}
