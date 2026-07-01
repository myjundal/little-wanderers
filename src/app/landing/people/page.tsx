'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import NotificationPreferences from '@/components/pwa/NotificationPreferences';

type Person = {
  id: string;
  role: 'adult' | 'child';
  first_name: string;
  last_name: string | null;
  gender: string | null;
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
  const [form, setForm] = useState({ role: 'adult', first_name: '', last_name: '', gender: '', birthdate: '' });
  const [inviteForm, setInviteForm] = useState({ email: '' });
  const [contactForm, setContactForm] = useState({ city: '', state: 'CT' });
  const [openAdd, setOpenAdd] = useState(false);
  const [openNotify, setOpenNotify] = useState(false);
  const [openInvite, setOpenInvite] = useState(false);

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return;

    const hid = await getLatestHouseholdIdForUser(supabase, uid);
    if (!hid) return;

    setHouseholdId(hid);
    const { data: household } = await supabase.from('households').select('city,state').eq('id', hid).maybeSingle();
    setContactForm({ city: household?.city ?? '', state: household?.state ?? 'CT' });

    const [{ data: ppl }, invitesRes] = await Promise.all([
      supabase.from('people').select('id, role, first_name, last_name, gender, birthdate').eq('household_id', hid).order('created_at', { ascending: true }),
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
      gender: form.gender || null,
      birthdate: form.birthdate || null,
    });

    if (error) {
      setUiError('Something went wrong while saving your family member.');
      return;
    }

    setForm({ role: form.role, first_name: '', last_name: '', gender: '', birthdate: '' });
    setUiMessage('Family member added.');
    await load();
  };
  const saveHouseholdLocation = async () => {
    if (!householdId) return;
    await supabase.from('households').update({ city: contactForm.city || null, state: contactForm.state || 'CT' }).eq('id', householdId);
    setUiMessage('Family information updated.');
  };

  const sendInvite = async () => {
    setUiError(null);
    setUiMessage(null);
    setSendingInvite(true);

    const res = await fetch('/api/family/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: inviteForm.email, role: 'member' }),
    });
    const json = await res.json();

    setSendingInvite(false);

    if (!res.ok || !json.ok) {
      setUiError(json.error ?? 'Unable to send invite right now.');
      return;
    }

    setInviteForm({ email: '' });
    setUiMessage('Invite sent.');
    await load();
  };

  const removePerson = async (id: string) => {
    await supabase.from('people').delete().eq('id', id);
    await load();
  };

  return (
    <main style={{ padding: '16px clamp(12px, 4vw, 24px)', maxWidth: 760, margin: '0 auto', boxSizing: 'border-box' }}>
      <h1>Family & Household</h1>
      <p style={{ color: '#6d6480' }}>Share access with your family so everyone can manage visits and bookings together.</p>
      <section style={{ marginTop: 24, overflow: 'visible' }}>
        <h3 style={{ margin: 0, padding: '0 2px' }}>Family Members</h3>
        {people.length === 0 && <p>No one is registered yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {people.map((p) => (
            <li key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, padding: 10, border: '1px solid #e6ddf4', borderRadius: 10 }}>
              <span style={{ fontSize: 13, textTransform: 'capitalize', color: '#6d6480' }}>{p.role}</span>
              <span style={{ fontWeight: 700 }}>{p.first_name} {p.last_name ?? ''}</span>
              <span style={{ color: '#666', fontSize: 14, textTransform: 'capitalize' }}>{p.gender ? p.gender.replaceAll('_', ' ') : '-'}</span>
              <span style={{ color: '#666', fontSize: 14 }}>{p.birthdate ?? '-'}</span>
              <button onClick={() => removePerson(p.id)} style={{ width: '100%' }}>Remove</button>
            </li>
          ))}
        </ul>
      </section>
      <section style={{ marginTop: 16, padding: 14, border: '1px solid #ddd', borderRadius: 12 }}>
        <h3 style={{ marginTop: 0 }}>Family information</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ width: '100%' }} placeholder="City" value={contactForm.city} onChange={(e) => setContactForm((p) => ({ ...p, city: e.target.value }))} />
          <select style={{ width: '100%' }} value={contactForm.state} onChange={(e) => setContactForm((p) => ({ ...p, state: e.target.value }))}>
            {['CT', 'MA', 'NY', 'RI', 'NJ', 'NH', 'VT', 'ME'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" onClick={saveHouseholdLocation}>Save family information</button>
        </div>
      </section>

      <section style={{ marginTop: 16, padding: 14, border: '1px solid #ddd', borderRadius: 12 }}>
        <button type="button" onClick={() => setOpenAdd((v) => !v)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', fontWeight: 700, color: '#4f3f82' }}>{openAdd ? '▾' : '▸'} Add Family Member</button>
        {openAdd && <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <select style={{ width: '100%', minWidth: 0 }} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="adult">Adult</option>
            <option value="child">Child</option>
          </select>
          <input style={{ width: '100%', minWidth: 0 }} placeholder="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <input style={{ width: '100%', minWidth: 0 }} placeholder="Last name (optional)" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          <select style={{ width: '100%', minWidth: 0 }} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="">Gender</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="non_binary">Non-binary</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </select>
          <input style={{ width: '100%', minWidth: 0 }} type="date" value={form.birthdate} onChange={(e) => setForm({ ...form, birthdate: e.target.value })} />
          <button style={{ width: '100%' }} type="button" onClick={addPerson}>Add Family Member</button>
        </div>
        </>}
      </section>

      <section style={{ marginTop: 16, padding: 14, border: '1px solid #ddd', borderRadius: 12 }}>
        <button type="button" onClick={() => setOpenNotify((v) => !v)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', fontWeight: 700, color: '#4f3f82' }}>{openNotify ? '▾' : '▸'} Notification Preferences</button>
        {openNotify && <NotificationPreferences />}
      </section>

      {(uiError || uiMessage) && (
        <p style={{ color: uiError ? '#8a3f6b' : '#2f7a44', marginTop: 10 }}>{uiError ?? uiMessage}</p>
      )}


      <section style={{ marginTop: 16, padding: 14, border: '1px solid #ddd', borderRadius: 12 }}>
        <button type="button" onClick={() => setOpenInvite((v) => !v)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', fontWeight: 700, color: '#4f3f82' }}>{openInvite ? '▾' : '▸'} Invite Family Member</button>
        {openInvite && <>
        <p style={{ color: '#6d6480' }}>Invite another family member by email.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input
            placeholder="Email"
            value={inviteForm.email}
            onChange={(e) => setInviteForm((prev) => ({ ...prev, email: e.target.value }))}
            style={{ width: '100%', minWidth: 0 }}
          />
          <button type="button" onClick={sendInvite} disabled={sendingInvite}>{sendingInvite ? 'Sending…' : 'Send Invite'}</button>
        </div>

        <h4 style={{ marginTop: 14 }}>Pending Invites</h4>
        {invites.filter((i) => i.status === 'pending').length === 0 && <p style={{ color: '#6d6480' }}>No pending invites right now.</p>}
        <ul>
          {invites
            .filter((i) => i.status === 'pending')
            .map((invite) => (
              <li key={invite.id}>{invite.email} · expires {new Date(invite.expires_at).toLocaleDateString()}</li>
            ))}
        </ul>
        </>}
      </section>

      <div style={{ marginTop: 18 }}>
        <Link href="/landing" style={{ display: 'inline-flex', border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 14px', color: '#5f3da4', textDecoration: 'none', fontWeight: 700 }}>
          ← Back to my dashboard
        </Link>
      </div>
    </main>
  );
}
