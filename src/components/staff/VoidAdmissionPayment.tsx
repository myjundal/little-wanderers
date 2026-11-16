'use client';
import { useRef, useState } from 'react';
export default function VoidAdmissionPayment({ householdId, checkinIds, total, disabled, onVoided, onBusyChange }: {
  householdId: string; checkinIds: string[]; total: number; disabled: boolean; onVoided: () => Promise<void>; onBusyChange: (busy: boolean) => void;
}) {
  const [reason, setReason] = useState('Complimentary visit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  async function voidPayment() {
    if (disabled || pending.current || total <= 0 || !checkinIds.length) return;
    const key = JSON.stringify([householdId, [...checkinIds].sort(), total, reason]);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    pending.current = true; setBusy(true); onBusyChange(true); setError('');
    let saved = false;
    try {
      const response = await fetch('/api/admin/admission/void', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: request.current.id, household_id: householdId, checkin_ids: checkinIds, expected_total_cents: total, reason }) });
      const result = await response.json();
      if (!response.ok || !result.ok || result.voided !== true || result.amount_cents !== 0) throw new Error(result.error || 'Unable to confirm the void. Refresh payment status.');
      saved = true;
      await onVoided();
    } catch (error) { setError(`${saved ? 'Payment is voided. ' : ''}${error instanceof Error ? error.message : 'Refresh payment status before retrying.'}`); }
    finally { pending.current = false; setBusy(false); onBusyChange(false); }
  }
  return <div style={{ marginTop: 18, padding: 14, border: '1px solid #d9c8f7', borderRadius: 12, background: '#f8f4fc' }}>
    <label>Free admission reason <select aria-label="Free admission reason" value={reason} disabled={disabled || busy} onChange={event => setReason(event.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 44, fontSize: 16, padding: 10, marginTop: 6 }}><option>Complimentary visit</option><option>Class cancelled</option></select></label>
    <p style={{ margin: '10px 0' }}>Keep this family checked in and change unpaid admission from ${(total / 100).toFixed(2)} to $0. No refund is issued.</p>
    <button type="button" disabled={disabled || busy || total <= 0} onClick={() => void voidPayment()} style={{ minHeight: 48, fontSize: 16, padding: '12px 18px', borderRadius: 10, border: '1px solid #65449b', background: '#fff', color: '#4f3f82', fontWeight: 700 }}>{busy ? 'Voiding payment…' : 'Void payment — $0'}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
