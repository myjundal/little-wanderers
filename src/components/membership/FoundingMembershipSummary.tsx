'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MEMBERSHIP_PRICES, type MembershipTier } from '@/lib/founding-membership';

export default function FoundingMembershipSummary() {
  const [status, setStatus] = useState<string | null>(null);
  const [tier, setTier] = useState<MembershipTier>('public');
  useEffect(() => {
    let active = true;
    void fetch('/api/founding-membership', { cache: 'no-store' }).then(response => response.json()).then(data => { if (active && data.ok && data.enrollment) { setStatus(data.enrollment.status); setTier(data.enrollment.pricing_tier); } }).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!status || status === 'draft') return null;
  return <section style={{ margin: '20px 0', padding: 20, background: '#f6f1fa', border: '1px solid #e4d9ec', borderRadius: 18 }} aria-label="My founding membership">
    <strong>{MEMBERSHIP_PRICES[tier].label} · {status === 'pending' ? 'Card saved, awaiting first membership visit' : status.replace('_', ' ')}</strong>
    <p style={{ fontSize: 13, lineHeight: 1.8 }}>{status === 'canceled' ? 'Rejoining uses regular $60/month + $20/month per eligible sibling.' : `$${MEMBERSHIP_PRICES[tier].base_cents / 100}/month first child + $${MEMBERSHIP_PRICES[tier].sibling_cents / 100}/month per eligible sibling.`} {['pending', 'saving_card'].includes(status) && 'No payment today. Monthly billing starts on your first membership visit.'}</p>
    {['pending', 'activating', 'scheduled', 'active'].includes(status) && <p><Link href="/landing/soft-opening">Reserve a visit →</Link></p>}
    <Link href="/founding-membership">{status === 'canceled' ? 'View my membership' : 'Manage or cancel my membership'} →</Link>
  </section>;
}
