'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MEMBERSHIP_MANAGEMENT_LABELS, type MembershipSummary } from '@/lib/membership-summary';
import styles from './membership-management-summary.module.css';

export default function MembershipManagementSummary({ refreshKey = 0 }: { refreshKey?: number }) {
  const [summary, setSummary] = useState<MembershipSummary | null>(null), [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    const response = await fetch('/api/admin/membership-summary', { cache: 'no-store' });
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.error || 'Unable to load membership totals.');
    setSummary(json.summary);
  }, []);
  useEffect(() => { let active = true; const refresh = () => { void load().catch(e => { if (active) { setSummary(null); setError(e.message); } }); }; refresh(); window.addEventListener('focus', refresh); return () => { active = false; window.removeEventListener('focus', refresh); }; }, [load, refreshKey]);
  return <section className={styles.section} aria-label="Membership totals">
    <div className={styles.heading}><h2>Memberships</h2><Link href="/staff/founding-memberships">Membership management →</Link></div>
    {error ? <p role="alert">{error} <button type="button" onClick={() => void load().catch(e => setError(e.message))}>Retry</button></p> : !summary ? <p role="status">Loading membership totals…</p> : <div className={styles.grid}>{(['total', 'waitlist', 'public', 'regular'] as const).map(tier => <article key={tier} className={`${styles.card} ${tier === 'total' ? styles.total : ''}`} aria-label={`${tier === 'total' ? 'Total' : MEMBERSHIP_MANAGEMENT_LABELS[tier]} membership count`}><h3>{tier === 'total' ? 'Total' : MEMBERSHIP_MANAGEMENT_LABELS[tier]}</h3><strong>{summary[tier].memberships}</strong><span>{summary[tier].memberships === 1 ? 'family membership' : 'family memberships'}</span><small>{summary[tier].children} enrolled {summary[tier].children === 1 ? 'child' : 'children'}</small></article>)}</div>}
    <p className={styles.note}>Counts families with completed enrollment, including saved cards awaiting a first visit. Drafts and canceled enrollments are excluded.</p>
  </section>;
}
