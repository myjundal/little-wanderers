'use client';

import { useCallback, useEffect, useState } from 'react';

type ClassItem = { id: string; title: string; start_time: string; instructor_note: string | null };
type Course = { title: string; session_count: number; email: string; user_id: string | null; has_session_assignments: boolean };

export default function InstructorAssignments() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [classId, setClassId] = useState('');
  const [note, setNote] = useState('');
  const [notesReady, setNotesReady] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const res = await fetch('/api/admin/instructors', { cache: 'no-store' });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error ?? 'Unable to load instructors.');
    setClasses(json.classes); setCourses(json.courses); setNotesReady(json.notes_ready === true);
  }, []);
  useEffect(() => { void load().catch(e => setMessage(e.message)).finally(() => setLoading(false)); }, [load]);
  const course = courses.find(item => item.title === title);
  const sessions = classes.filter(item => item.title === title);
  async function save(action: 'assign_course' | 'remove_course' | 'note') {
    setBusy(true); setMessage('');
    try {
      const res = await fetch('/api/admin/instructors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, course_title: title, class_id: classId, email, note }) });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Unable to save.');
      await load();
      if (action === 'remove_course') setEmail('');
      setMessage(action === 'assign_course' ? 'Instructor saved for every session of this class, including sessions added later.' : action === 'remove_course' ? 'Instructor removed from this class and all its sessions.' : 'Private session notes saved.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to save.'); }
    finally { setBusy(false); }
  }
  return <section style={{ marginTop: 24, padding: 20, border: '1px solid #e3d0fb', borderRadius: 18, background: '#fffdf9', color: '#4f3f82' }}>
    <h2>Class instructor</h2>
    <p>One class, one instructor email. The assignment applies to all existing and future sessions with this class name.</p>
    {loading ? <p>Loading classes…</p> : <div style={{ display: 'grid', gap: 14, maxWidth: 620 }}>
      <label>Class<select style={{ display: 'block', width: '100%', padding: 12 }} value={title} disabled={busy} onChange={e => { setTitle(e.target.value); setEmail(courses.find(item => item.title === e.target.value)?.email ?? ''); setClassId(''); setNote(''); setMessage(''); }}><option value="">Choose a class</option>{courses.map(item => <option key={item.title} value={item.title}>{item.title}</option>)}</select></label>
      {course && <>
        <p style={{ margin: 0 }}>{course.session_count} sessions · {course.email || 'No class instructor assigned'}</p>
        <form onSubmit={e => { e.preventDefault(); void save('assign_course'); }} style={{ display: 'grid', gap: 10 }}><label>Instructor’s account email<input required type="email" value={email} disabled={busy} onChange={e => setEmail(e.target.value)} style={{ display: 'block', padding: 12, width: '100%', boxSizing: 'border-box' }} /></label><button disabled={busy || !email.trim()} type="submit">{busy ? 'Saving…' : 'Save class instructor'}</button></form>
        {course.user_id && <button disabled={busy} onClick={() => void save('remove_course')}>Remove class instructor</button>}
        {course.has_session_assignments && <p>There are previous session assignments. Saving one email here replaces them for this entire class.</p>}
        <details><summary style={{ cursor: 'pointer' }}>Session notes (optional)</summary><div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <label>Session<select style={{ display: 'block', width: '100%', padding: 10 }} value={classId} disabled={busy} onChange={e => {setClassId(e.target.value);setNote(sessions.find(item => item.id === e.target.value)?.instructor_note ?? '');}}><option value="">Choose a date for notes</option>{sessions.map(item => <option key={item.id} value={item.id}>{new Date(item.start_time).toLocaleString('en-US', { timeZone: 'America/New_York' })}</option>)}</select></label>
          {classId && <><label>Private notes for the instructor<textarea maxLength={4000} rows={3} style={{ display: 'block', width: '100%', boxSizing: 'border-box' }} value={note} onChange={e => setNote(e.target.value)} disabled={busy || !notesReady} /></label><button disabled={busy || !notesReady} onClick={() => void save('note')}>Save session notes</button></>}
        </div></details>
      </>}
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
