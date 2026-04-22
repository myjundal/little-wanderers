'use client';

import { useState, useCallback, useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { getLatestHouseholdIdForUser } from '@/lib/households';

type Person = {
  id: string;
  role: 'adult' | 'child';
  first_name: string;
  last_name: string | null;
  birthdate: string | null;
};

type Invite = {
  id: string;
  email: string;
  role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  created_at: string;
  expires_at: string;
};

export default function PeoplePage() {
  const supabase = createBrowserSupabaseClient();
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [uiError, setUiError] = useState<string | null>(null);
  const [uiMessage, setUiMessage] = useState<string | null>(null);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [form, setForm] = useState({ role: 'adult', first_name: '', last_name: '', birthdate: '' });
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'member' as 'admin' | 'member' });

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return;

    const hid = await getLatestHouseholdIdForUser(supabase, uid);
    if (!hid) return;

    setHouseholdId(hid);

    const [{ data: ppl }, invitesRes] = await Promise.all([
      supabase.from('people').select('id, role, first_name, last_name, birthdate').eq('household_id', hid).order('created_at', { ascending: true }),
      fetch('/api/family/invites', { cache: 'no-store' }),
    ]);

    setPeople((ppl ?? []) as Person[]);

    const invitesJson = await invitesRes.json();
    if (invitesRes.ok && invitesJson.ok) {
      setInvites((invitesJson.items ?? []) as Invite[]);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const addPerson = async () => {
    setUiError(null);
    setUiMessage(null);

    if (!householdId || !form.first_name) {
      setUiError('Please add at least a first name.');
      return;
    }

    const { error } = await supabase.from('people').insert({
      household_id: householdId,
      role: form.role as 'adult' | 'child',
      first_name: form.first_name,
      last_name: form.last_name || null,
      birthdate: form.birthdate || null,
    });

    if (error) {
      setUiError('Something went wrong while saving your family member.');
      return;
    }

    setForm({ role: form.role, first_name: '', last_name: '', birthdate: '' });
    setUiMessage('Family member added.');
    await load();
  };

  const sendInvite = async () => {
    setUiError(null);
    setUiMessage(null);
    setSendingInvite(true);

    const res = await fetch('/api/family/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(inviteForm),
    });
    const json = await res.json();

    setSendingInvite(false);

    if (!res.ok || !json.ok) {
      setUiError(json.error ?? 'Unable to send invite right now.');
      return;
    }

    setInviteForm({ email: '', role: 'member' });
    setUiMessage('Invite sent.');
    await load();
  };

  const removePerson = async (id: string) => {
    await supabase.from('people').delete().eq('id', id);
    await load();
  };

  return (
    <main style={{ padding: 24, maxWidth: 760 }}>
      <h1>Family & Household</h1>
      <p style={{ color: '#6d6480' }}>Share access with your family so everyone can manage visits and bookings together.</p>

      <section style={{ marginTop: 16, padding: 14, border: '1px solid #ddd', borderRadius: 12 }}>
        <h3>Invite Family Member</h3>
        <p style={{ color: '#6d6480' }}>Add Caregiver access for another adult in your household.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input
            placeholder="Email"
            value={inviteForm.email}
            onChange={(e) => setInviteForm((prev) => ({ ...prev, email: e.target.value }))}
            style={{ minWidth: 240 }}
          />
          <select value={inviteForm.role} onChange={(e) => setInviteForm((prev) => ({ ...prev, role: e.target.value as 'admin' | 'member' }))}>
            <option value="member">Caregiver</option>
            <option value="admin">Co-admin</option>
          </select>
          <button type="button" onClick={sendInvite} disabled={sendingInvite}>{sendingInvite ? 'Sending…' : 'Send Invite'}</button>
        </div>

        <h4 style={{ marginTop: 14 }}>Pending Invites</h4>
        {invites.filter((i) => i.status === 'pending').length === 0 && <p style={{ color: '#6d6480' }}>No pending invites right now.</p>}
        <ul>
          {invites
            .filter((i) => i.status === 'pending')
            .map((invite) => (
              <li key={invite.id}>{invite.email} · {invite.role} · expires {new Date(invite.expires_at).toLocaleDateString()}</li>
            ))}
        </ul>
      </section>

      <section style={{ marginTop: 16, padding: 14, border: '1px solid #ddd', borderRadius: 12 }}>
        <h3>Add Family Member</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="adult">Adult</option>
            <option value="child">Child</option>
          </select>
          <input placeholder="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <input placeholder="Last name (optional)" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          <input type="date" value={form.birthdate} onChange={(e) => setForm({ ...form, birthdate: e.target.value })} />
          <button type="button" onClick={addPerson}>Add Family Member</button>
        </div>
      </section>

      {(uiError || uiMessage) && (
        <p style={{ color: uiError ? '#8a3f6b' : '#2f7a44', marginTop: 10 }}>{uiError ?? uiMessage}</p>
      )}

      <section style={{ marginTop: 24 }}>
        <h3>Family Members</h3>
        {people.length === 0 && <p>No one is registered yet.</p>}
        <ul>
          {people.map((p) => (
            <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
              <span style={{ width: 64, textTransform: 'capitalize' }}>{p.role}</span>
              <span style={{ minWidth: 160 }}>{p.first_name} {p.last_name ?? ''}</span>
              <span style={{ color: '#666' }}>{p.birthdate ?? '-'}</span>
              <button onClick={() => removePerson(p.id)} style={{ marginLeft: 'auto' }}>Remove</button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
