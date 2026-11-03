'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function FoundingMembershipSummary() {
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch('/api/founding-membership', { cache: 'no-store' }).then(response => response.json()).then(data => { if (active && data.ok && data.enrollment) setStatus(data.enrollment.status); }).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!status || status === 'draft') return null;
  return <section style={{ margin: '20px 0', padding: 20, background: '#f6f1fa', border: '1px solid #e4d9ec', borderRadius: 18 }} aria-label="My founding membership">
    <strong>Founding membership · {status === 'pending' ? 'Card saved, awaiting opening' : status.replace('_', ' ')}</strong>
    <p style={{ fontSize: 13, lineHeight: 1.8 }}>{['pending', 'saving_card'].includes(status) ? 'No payment today. The opening date is still to be announced.' : '$50/month first-child rate while active, plus eligible sibling add-ons.'}</p>
    <Link href="/founding-membership">{status === 'canceled' ? 'View my membership' : 'Manage or cancel my membership'} →</Link>
  </section>;
}
