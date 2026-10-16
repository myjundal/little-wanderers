'use client';

import { useCallback, useEffect, useState } from 'react';

type ClassItem = { id: string; title: string; start_time: string; instructor_note: string | null };
type Assignment = { class_id: string; user_id: string; email: string };

export default function InstructorAssignments() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [classId, setClassId] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [notesReady, setNotesReady] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/instructors', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Unable to load instructors.');
      setClasses(json.classes);
      setNotesReady(json.notes_ready === true);
      setAssignments(json.assignments);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to load instructors.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function save(action: string, userId?: string) {
    setBusy(true); setMessage('');
    try {
      const res = await fetch('/api/admin/instructors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, class_id: classId, email, user_id: userId, note }) });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Unable to save.');
      await load();
      setMessage(action === 'assign' ? 'Instructor assigned. Existing staff and customer access is preserved.' : 'Saved.');
      if (action === 'assign') setEmail('');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to save.'); }
    finally { setBusy(false); }
  }
  return <section style={{ marginTop: 24, padding: 20, border: '1px solid #e3d0fb', borderRadius: 18, background: '#fffdf9', color: '#4f3f82' }}>
    <h2>Instructor assignments & class notes</h2><button disabled={busy} onClick={() => void load()}>Refresh sessions</button><p>Assign each session to an existing account. Multiple instructors can teach the same session.</p>
    <div style={{ display: 'grid', gap: 12, maxWidth: 620 }}>
      <label>Class session <select style={{ display: 'block', width: '100%', padding: 10 }} value={classId} disabled={busy} onChange={e => { setClassId(e.target.value); setNote(classes.find(item => item.id === e.target.value)?.instructor_note ?? ''); }}><option value="">Select a session</option>{classes.map(item => <option key={item.id} value={item.id}>{item.title} · {new Date(item.start_time).toLocaleString('en-US', { timeZone: 'America/New_York' })}</option>)}</select></label>
      {classId && <>
        <form onSubmit={e => { e.preventDefault(); void save('assign'); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><label>Instructor’s account email <input required type="email" value={email} disabled={busy} onChange={e => setEmail(e.target.value)} style={{ padding: 10, maxWidth: '100%' }} /></label><button disabled={busy || !email.trim()} type="submit">Assign instructor</button></form>
        <div>{assignments.filter(item => item.class_id === classId).map(item => <p key={item.user_id}>{item.email} <button disabled={busy} onClick={() => void save('remove', item.user_id)}>Remove from session</button></p>)}</div>
        <label>Notes for assigned instructors<textarea maxLength={4000} rows={3} style={{ display: 'block', width: '100%' }} value={note} onChange={e => setNote(e.target.value)} disabled={busy || !notesReady} placeholder="Room, supplies, preparation and class instructions" /></label><button disabled={busy || !notesReady} onClick={() => void save('note')}>Save class notes</button>{!notesReady && <p>Private class notes are being set up. Instructor assignments remain available.</p>}
      </>}
    </div>
    {message && <p role="status">{message}</p>}
  </section>;
}
