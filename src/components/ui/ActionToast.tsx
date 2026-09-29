'use client';

import { useEffect } from 'react';

type ActionToastProps = {
  message: string | null;
  tone?: 'success' | 'warning' | 'error';
  onDone: () => void;
};

export default function ActionToast({ message, tone = 'success', onDone }: ActionToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDone, 3600);
    return () => window.clearTimeout(timer);
  }, [message, onDone]);

  if (!message) return null;

  const palette = {
    success: { border: '#bfe9c9', background: '#f2fbf4', color: '#2f7a47' },
    warning: { border: '#f2d99b', background: '#fff8e6', color: '#805500' },
    error: { border: '#f1bfd0', background: '#fff5f8', color: '#8a3f6b' },
  }[tone];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        top: 'max(22px, env(safe-area-inset-top))',
        transform: 'translateX(-50%)',
        zIndex: 80,
        width: 'min(420px, calc(100vw - 28px))',
        border: `1px solid ${palette.border}`,
        borderRadius: 14,
        background: palette.background,
        color: palette.color,
        boxShadow: '0 18px 40px rgba(54, 42, 77, 0.16)',
        padding: '12px 14px',
        fontWeight: 800,
        textAlign: 'center',
      }}
    >
      {message}
    </div>
  );
}
