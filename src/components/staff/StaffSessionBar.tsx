'use client';
import { useState } from 'react';
import { useOperatorAccess } from '@/lib/use-owner-dashboard-access';
import styles from './StaffPortal.module.css';
export default function StaffSessionBar() {
  const { canUseOwnerDashboard, isInstructor, isKiosk } = useOperatorAccess();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!isKiosk || (!canUseOwnerDashboard && !isInstructor)) return null;
  async function logout() {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/staff/kiosk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Clock-out failed. Try again.');
      window.location.replace('/staff-login?clocked_out=1');
    } catch (e) { setError(e instanceof Error ? e.message : 'Clock-out failed.'); setBusy(false); }
  }
  return <div className={styles.session}>
    <strong>iPad shift is active</strong><button disabled={busy} onClick={() => void logout()}>{busy ? 'Recording clock-out…' : 'Log out & clock out'}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
