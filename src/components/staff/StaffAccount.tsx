'use client';
import { useCallback, useEffect, useState } from 'react';
import { staffTimeLabel, closedShiftHours } from '@/lib/staff-time-display';
import styles from './StaffPortal.module.css';
type Entry = { id: string; clock_in: string; clock_out: string | null; close_note: string | null };
export default function StaffAccount() {
  const [data, setData] = useState<{ is_kiosk: boolean; display_name: string; pin_set: boolean; active: boolean; entries: Entry[] } | null>(null);
  const [name, setName] = useState(''); const [pin, setPin] = useState(''); const [confirm, setConfirm] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const res = await fetch('/api/staff/account', { cache: 'no-store' }); const json = await res.json(); if (!res.ok || !json.ok) throw Error(json.error ?? 'Unable to load account.'); setData(json); setName(json.display_name); }
    catch(e) { setMessage(e instanceof Error ? e.message : 'Unable to load account.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (pin !== confirm) { setMessage('PINs do not match.'); return; }
    setBusy(true); setMessage('');
    try { const res = await fetch('/api/staff/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: name, pin }) }); const json = await res.json(); if (!res.ok || !json.ok) throw Error(json.error ?? 'Could not save PIN.'); setPin('');setConfirm(''); await load(); setMessage('PIN saved. You can now choose your name and enter your PIN on the registered iPad.'); }
    catch(e) { setMessage(e instanceof Error ? e.message : 'Could not save PIN.'); } finally { setBusy(false); }
  }
  return <main className={styles.main}><h1>My PIN & Timecards</h1><p>Your phone login stays signed in. Only an iPad PIN login starts a shift; its logout records clock-out.</p>
    {message && <p role="status" className={styles.message}>{message}</p>}
    {!data ? <button onClick={() => void load()}>Refresh</button> : <>
      {data.is_kiosk ? <p>Set or change your PIN from your personal phone login.</p> : <section className={styles.card}><h2>{data.pin_set ? 'Change iPad PIN' : 'Set your iPad PIN'}</h2><form className={styles.form} onSubmit={save}>
        <label>Your name on the iPad<input value={name} maxLength={100} required onChange={e => setName(e.target.value)} /></label>
        <label>4-digit PIN<input className={styles.pin} type="password" inputMode="numeric" pattern="[0-9]{4}" autoComplete="new-password" maxLength={4} required value={pin} onChange={e => setPin(e.target.value.replace(/\D/g,''))} /></label>
        <label>Confirm PIN<input type="password" inputMode="numeric" pattern="[0-9]{4}" autoComplete="new-password" maxLength={4} required value={confirm} onChange={e => setConfirm(e.target.value.replace(/\D/g,''))} /></label><button disabled={busy || !data.active}>{busy ? 'Saving…' : 'Save PIN'}</button>
      </form>{!data.active && <p>Your iPad login is disabled. Ask the owner.</p>}</section>}
      <section className={styles.card}><h2>My timecards</h2><p className={styles.subtle}>Studio time (Eastern). Open shifts are not included in completed hours.</p><p>Completed hours shown: {data.entries.reduce((sum,item) => sum + (closedShiftHours(item.clock_in,item.clock_out) ?? 0),0).toFixed(2)}</p>
        <div className={styles.scroll}><table className={styles.table}><thead><tr><th>Clock in</th><th>Clock out</th><th>Hours</th><th>Owner correction</th></tr></thead><tbody>{data.entries.map(item => <tr key={item.id}><td>{staffTimeLabel(item.clock_in)}</td><td>{staffTimeLabel(item.clock_out)}</td><td>{closedShiftHours(item.clock_in,item.clock_out)?.toFixed(2) ?? 'In progress'}</td><td>{item.close_note ?? '—'}</td></tr>)}</tbody></table></div>{!data.entries.length && <p>No shifts recorded yet.</p>}
      </section>
    </>}
  </main>;
}
