'use client';

import { useEffect, useState } from 'react';
import { clearAnalyticsOptOut, setAnalyticsOptOut } from '@/components/analyticsGate';

const panelStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  background: '#fbf7ff',
  color: '#4f3f82',
};

const cardStyle: React.CSSProperties = {
  width: 'min(100%, 560px)',
  border: '1px solid #eadff3',
  borderRadius: 18,
  padding: 24,
  background: '#fff',
  boxShadow: '0 18px 38px rgba(158,143,191,0.14)',
};

const buttonStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 12,
  padding: '12px 16px',
  background: '#5f3da4',
  color: '#fff',
  fontWeight: 800,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  border: '1px solid #d9c8f7',
  background: '#fff',
  color: '#5f3da4',
};

function hasOptOut() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('lw_ignore_analytics') === 'true'
    || document.cookie.split(';').some((part) => part.trim() === 'lw_ignore_analytics=true');
}

export default function AnalyticsOptOutPanel() {
  const [isOptedOut, setIsOptedOut] = useState(false);

  useEffect(() => {
    setAnalyticsOptOut();
    setIsOptedOut(true);
  }, []);

  const optOut = () => {
    setAnalyticsOptOut();
    setIsOptedOut(true);
  };

  const optIn = () => {
    clearAnalyticsOptOut();
    setIsOptedOut(hasOptOut());
  };

  return (
    <main style={panelStyle}>
      <section style={cardStyle}>
        <p style={{ margin: 0, color: '#7a63a5', fontWeight: 800, textTransform: 'uppercase' }}>Little Wanderers</p>
        <h1 style={{ margin: '8px 0 10px', fontSize: 'clamp(2rem, 6vw, 3rem)' }}>Analytics opt-out</h1>
        <p style={{ margin: 0, lineHeight: 1.65, color: '#6d6480' }}>
          This browser is {isOptedOut ? 'excluded from' : 'included in'} Little Wanderers website analytics.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
          <button type="button" onClick={optOut} style={buttonStyle}>
            Exclude this browser
          </button>
          <button type="button" onClick={optIn} style={secondaryButtonStyle}>
            Include this browser
          </button>
        </div>
      </section>
    </main>
  );
}
