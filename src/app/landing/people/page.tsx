'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import AccountLoginLinker from '@/components/family/AccountLoginLinker';
import NotificationPreferences from '@/components/pwa/NotificationPreferences';
import { formatBirthdateInput, parseBirthdate } from '@/lib/birthdate';
import FamilyMemberEditor, { type FamilyPerson as Person } from '@/components/family/FamilyMemberEditor';

type Invite = {
  id: string;
  email: string;
  role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  created_at: string;
  expires_at: string;
};

function normalizeUsPhone(input: string) {
  const digits = input.replace(/\D/g, '');
  if (!digits) return '';
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return `+1${local}`;
}

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
  const [contactForm, setContactForm] = useState({ phone: '', city: '', state: 'CT' });
  const [openAdd, setOpenAdd] = useState(false);
  const [openNotify, setOpenNotify] = useState(false);
  const [openInvite, setOpenInvite] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [loading, setLoading] = useState(true);
  const contactInFlight = useRef(false);
  const addInFlight = useRef(false);
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return;

      const hid = await getLatestHouseholdIdForUser(supabase, uid);
      if (!hid) return;

      const { data: household, error: householdError } = await supabase.from('households').select('phone,city,state').eq('id', hid).maybeSingle();
      if (householdError) throw householdError;

      const [{ data: ppl, error: peopleError }, invitesRes] = await Promise.all([
        supabase.from('people').select('id, role, first_name, last_name, gender, birthdate').eq('household_id', hid).order('created_at', { ascending: true }),
        fetch('/api/family/invites', { cache: 'no-store' }),
      ]);

      if (peopleError) throw peopleError;
      const invitesJson = await invitesRes.json();
      if (version !== loadVersion.current) return;
      setHouseholdId(hid);
      setContactForm({ phone: household ? household.phone ?? '' : userData.user?.phone ?? '', city: household?.city ?? '', state: household?.state ?? 'CT' });
      setPeople((ppl ?? []) as Person[]);
      if (invitesRes.ok && invitesJson.ok) {
        setInvites((invitesJson.items ?? []) as Invite[]);
      }
    } catch {
      if (version === loadVersion.current) setUiError('Unable to load your family information. Please refresh and try again.');
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const addPerson = async () => {
    if (addInFlight.current) return;
    setUiError(null);
    setUiMessage(null);

    if (!householdId || !form.first_name.trim()) {
      setUiError('Please add at least a first name.');
      return;
    }

    const birthdate = form.birthdate.trim() ? parseBirthdate(form.birthdate) : null;
    if (form.birthdate.trim() && !birthdate) {
      setUiError('Enter the birthday as MM/DD/YYYY (for example, 03/15/2022). Use a real date that is not in the future.');
      return;
    }

    addInFlight.current = true;
    setAddingPerson(true);
    try {
      const { data: person, error } = await supabase.from('people').insert({
        household_id: householdId,
        role: form.role as 'adult' | 'child',
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim() || null,
        gender: form.gender || null,
        birthdate,
      }).select('id,role,first_name,last_name,gender,birthdate').single();

      if (error || !person) throw new Error('Unable to save family member.');

      ++loadVersion.current;
      setPeople(current => [...current, person as Person]);
      setForm({ role: form.role, first_name: '', last_name: '', gender: '', birthdate: '' });
      setUiMessage('Family member added.');
    } catch {
      setUiError('Something went wrong while saving your family member. Please try again.');
    } finally {
      addInFlight.current = false;
      setAddingPerson(false);
    }
  };
  const saveHouseholdLocation = async () => {
    if (!householdId || contactInFlight.current) return;
    setUiError(null);
    setUiMessage(null);

    const normalizedPhone = normalizeUsPhone(contactForm.phone);
    if (contactForm.phone.trim() && !/^\+1\d{10}$/.test(normalizedPhone)) {
      setUiError('Please enter a valid US phone number.');
      return;
    }

    contactInFlight.current = true;
    setSavingContact(true);
    try {
      const response = await fetch('/api/family/profile', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: normalizedPhone || null, city: contactForm.city.trim() || null, state: contactForm.state || 'CT' }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok || !result.household) throw new Error(result.error || 'Something went wrong while saving your family information.');
      ++loadVersion.current;
      setContactForm({ phone: result.household.phone ?? '', city: result.household.city ?? '', state: result.household.state ?? 'CT' });
      setUiMessage('Family information updated.');

      // The contact save is already complete; phone-login verification is separate.
      try {
        const { data: userData } = await supabase.auth.getUser();
        const authPhone = userData.user?.phone ?? '';
        if (normalizedPhone && normalizedPhone !== authPhone) {
          const { error: authError } = await supabase.auth.updateUser({ phone: normalizedPhone });
          if (authError) throw authError;
          setUiMessage('Family information updated. Please check your text messages to confirm phone login.');
        }
      } catch {
        setUiMessage('Family information updated, but phone login could not be enabled yet. Please try the phone number again later.');
      }
    } catch (cause) {
      setUiError(cause instanceof Error ? cause.message : 'Something went wrong while saving your family information. Please try again.');
    } finally {
      contactInFlight.current = false;
      setSavingContact(false);
    }
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
    if (json.email_sent !== true) {
      setUiError('The invitation was saved, but its email could not be sent. Please contact Little Wanderers for help.');
    } else {
      setUiMessage('Invite sent.');
    }
    const invitesRes = await fetch('/api/family/invites', { cache: 'no-store' });
    const invitesJson = await invitesRes.json();
    if (invitesRes.ok && invitesJson.ok) setInvites(invitesJson.items ?? []);
  };

  const removePerson = async (id: string) => {
    setUiError(null);
    setUiMessage(null);
    try {
      const { data, error } = await supabase.from('people').delete().eq('id', id).eq('household_id', householdId!).select('id').single();
      if (error || !data) throw new Error('Unable to remove family member.');
      ++loadVersion.current;
      setPeople(current => current.filter(person => person.id !== id));
      setUiMessage('Family member removed.');
    } catch {
      setUiError('Unable to remove this family member. Please try again.');
    }
  };

  return (
    <main style={{ padding: '16px clamp(12px, 4vw, 24px)', maxWidth: 760, margin: '0 auto', boxSizing: 'border-box' }}>
      <h1>My Info/People</h1>
      <p style={{ color: '#6d6480' }}>Share access with your family so everyone can manage visits and bookings together.</p>
      <AccountLoginLinker />
      <section style={{ marginTop: 24, overflow: 'visible' }}>
        <h3 style={{ margin: 0, padding: '0 2px' }}>Family Members</h3>
        {loading ? <p>Loading family members…</p> : people.length === 0 && <p>No one is registered yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {people.map(person => <FamilyMemberEditor key={person.id} person={person} onRemove={removePerson} onSaved={saved => {
            ++loadVersion.current;
            setPeople(current => current.map(item => item.id === saved.id ? saved : item));
          }} />)}
        </ul>
      </section>
      <section style={{ marginTop: 16, padding: 14, border: '1px solid #ddd', borderRadius: 12 }}>
        <h3 style={{ marginTop: 0 }}>Family information</h3>
        <fieldset disabled={savingContact || loading} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={{ width: '100%' }}
            type="tel"
            aria-label="Phone number"
            placeholder="Phone number"
            value={contactForm.phone}
            onChange={(e) => setContactForm((p) => ({ ...p, phone: e.target.value }))}
            autoComplete="tel"
          />
          <input style={{ width: '100%' }} aria-label="City" placeholder="City" value={contactForm.city} onChange={(e) => setContactForm((p) => ({ ...p, city: e.target.value }))} />
          <select aria-label="State" style={{ width: '100%' }} value={contactForm.state} onChange={(e) => setContactForm((p) => ({ ...p, state: e.target.value }))}>
            {['CT', 'MA', 'NY', 'RI', 'NJ', 'NH', 'VT', 'ME'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" onClick={saveHouseholdLocation} disabled={!householdId}>{savingContact ? 'Saving…' : 'Save family information'}</button>
        </fieldset>
      </section>

      <section style={{ marginTop: 16, padding: 14, border: '1px solid #ddd', borderRadius: 12 }}>
        <button type="button" onClick={() => setOpenAdd((v) => !v)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', fontWeight: 700, color: '#4f3f82' }}>{openAdd ? '▾' : '▸'} Add Family Member</button>
        {openAdd && <>
        <fieldset disabled={addingPerson || loading} style={{ border: 0, margin: '8px 0 0', padding: 0, minWidth: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select aria-label="Family member role" style={{ width: '100%', minWidth: 0 }} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="adult">Adult</option>
            <option value="child">Child</option>
          </select>
          <input style={{ width: '100%', minWidth: 0 }} aria-label="First name (required)" placeholder="First name (required)" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <input style={{ width: '100%', minWidth: 0 }} aria-label="Last name (optional)" placeholder="Last name (optional)" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          <select aria-label="Gender (optional)" style={{ width: '100%', minWidth: 0 }} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="">Gender (optional)</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="non_binary">Non-binary</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </select>
          <label style={{ display: 'grid', gap: 6, width: '100%', color: '#6d6480' }}>
            Birthday (optional, MM/DD/YYYY)
            <input style={{ width: '100%', minWidth: 0 }} type="text" inputMode="numeric" maxLength={10} placeholder="03/15/2022" value={form.birthdate} onChange={(e) => setForm({ ...form, birthdate: formatBirthdateInput(e.target.value) })} aria-describedby="family-birthday-help" />
          </label>
          <p id="family-birthday-help" style={{ margin: 0, color: '#6d6480', fontSize: 14 }}>Month / day / four-digit year. For a child, enter their date of birth, not their age. You can leave this blank and add it later.</p>
          <button style={{ width: '100%' }} type="button" onClick={addPerson} disabled={!householdId}>{addingPerson ? 'Adding…' : 'Add Family Member'}</button>
        </fieldset>
        </>}
      </section>

      <section style={{ marginTop: 16, padding: 14, border: '1px solid #ddd', borderRadius: 12 }}>
        <button type="button" onClick={() => setOpenNotify((v) => !v)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', fontWeight: 700, color: '#4f3f82' }}>{openNotify ? '▾' : '▸'} Notification Preferences</button>
        {openNotify && <NotificationPreferences />}
      </section>

      {(uiError || uiMessage) && (
        <p role={uiError ? 'alert' : 'status'} style={{ color: uiError ? '#8a3f6b' : '#2f7a44', marginTop: 10 }}>{uiError ?? uiMessage}</p>
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
