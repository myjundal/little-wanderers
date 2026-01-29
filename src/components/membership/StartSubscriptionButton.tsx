'use client';
import { useState } from 'react';

export default function StartSubscriptionButton({ plan = 'monthly' }: { plan?: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/checkout/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.url) throw new Error(json?.error || 'Checkout init failed');
      window.location.assign(json.url); // Square hosted checkout로 이동
    } catch (err: any) {
      alert(err?.message || 'Failed to start checkout. Please try again.');
    } finally {
      setLoading(false);
    }
  }

return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        background: loading ? '#a3bffa' : '#4f46e5', // indigo-600
        color: 'white',
        border: 'none',
        borderRadius: 8,
        fontSize: 16,
        fontWeight: 500,
        padding: '10px 16px',
        cursor: loading ? 'default' : 'pointer',
        boxShadow: loading
          ? 'none'
          : '0 2px 6px rgba(0,0,0,0.15)',
        transition: 'all 0.25s ease',
      }}
      onMouseEnter={(e) => {
        if (!loading) (e.currentTarget.style.background = '#4338ca'); // darker indigo
      }}
      onMouseLeave={(e) => {
        if (!loading) (e.currentTarget.style.background = '#4f46e5');
      }}
      onMouseDown={(e) => {
        if (!loading) {
          e.currentTarget.style.transform = 'scale(0.97)';
          e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
        }
      }}
      onMouseUp={(e) => {
        if (!loading) {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
        }
      }}
    >
      {loading ? 'Starting…' : 'Start Monthly Membership'}
    </button>
  );
}
