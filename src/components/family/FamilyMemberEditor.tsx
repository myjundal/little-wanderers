'use client';

import { useRef, useState } from 'react';
import { formatBirthdateInput, parseBirthdate } from '@/lib/birthdate';

export type FamilyPerson = {
  id: string;
  role: 'adult' | 'child';
  first_name: string;
  last_name: string | null;
  gender: string | null;
  birthdate: string | null;
};

function draftFor(person: FamilyPerson) {
  return { first_name: person.first_name, last_name: person.last_name ?? '', gender: person.gender ?? '', birthdate: person.birthdate ? formatBirthdateInput(person.birthdate) : '' };
}

export default function FamilyMemberEditor({ person, onSaved, onRemove }: {
  person: FamilyPerson;
  onSaved: (person: FamilyPerson) => void;
  onRemove: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFor(person));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function save() {
    if (inFlight.current) return;
    setError(null);
    setMessage(null);
    if (!draft.first_name.trim()) { setError('Please enter a first name.'); return; }
    const birthdate = draft.birthdate.trim() ? parseBirthdate(draft.birthdate) : null;
    if (draft.birthdate.trim() && !birthdate) { setError('Enter a valid birthday as MM/DD/YYYY that is not in the future.'); return; }
    inFlight.current = true;
    setSaving(true);
    try {
      const response = await fetch(`/api/family/people/${person.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ first_name: draft.first_name.trim(), last_name: draft.last_name.trim() || null, gender: draft.gender || null, birthdate }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok || !result.person) throw new Error(result.error || 'Unable to save your family member. Please try again.');
      onSaved(result.person);
      setDraft(draftFor(result.person));
      setEditing(false);
      setMessage('Family member updated.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save your family member. Please try again.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return <li style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid #e6ddf4', borderRadius: 10 }}>
    <span style={{ fontSize: 13, textTransform: 'capitalize', color: '#6d6480' }}>{person.role}</span>
    {editing ? <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10, minWidth: 0 }}>
      <label>First name<input style={{ width: '100%' }} maxLength={80} value={draft.first_name} onChange={e => setDraft(previous => ({ ...previous, first_name: e.target.value }))} /></label>
      <label>Last name (optional)<input style={{ width: '100%' }} maxLength={80} value={draft.last_name} onChange={e => setDraft(previous => ({ ...previous, last_name: e.target.value }))} /></label>
      <label>Gender (optional)<select aria-label="Gender (optional)" style={{ width: '100%' }} value={draft.gender} onChange={e => setDraft(previous => ({ ...previous, gender: e.target.value }))}>
        <option value="">Not specified</option><option value="female">Female</option><option value="male">Male</option><option value="non_binary">Non-binary</option><option value="prefer_not_to_say">Prefer not to say</option>
      </select></label>
      <label>Birthday (optional, MM/DD/YYYY)<input style={{ width: '100%' }} inputMode="numeric" placeholder="03/15/2022" maxLength={10} value={draft.birthdate} onChange={e => setDraft(previous => ({ ...previous, birthdate: formatBirthdateInput(e.target.value) }))} /></label>
      <button type="button" onClick={save}>{saving ? 'Saving…' : 'Save family member'}</button>
      <button type="button" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
    </fieldset> : <>
      <span style={{ fontWeight: 700 }}>{person.first_name} {person.last_name ?? ''}</span>
      <span style={{ color: '#666', fontSize: 14, textTransform: 'capitalize' }}>{person.gender?.replaceAll('_', ' ') || 'Gender not specified'}</span>
      <span style={{ color: '#666', fontSize: 14 }}>Birthday: {person.birthdate ? formatBirthdateInput(person.birthdate) : 'Not added'}</span>
      <button type="button" onClick={() => { setDraft(draftFor(person)); setEditing(true); setError(null); setMessage(null); }}>Edit family member</button>
      <button type="button" onClick={() => onRemove(person.id)}>Remove</button>
    </>}
    {error && <p role="alert" style={{ color: '#8a3f6b', margin: 0 }}>{error}</p>}
    {message && <p role="status" style={{ color: '#2f7a44', margin: 0 }}>{message}</p>}
  </li>;
}
