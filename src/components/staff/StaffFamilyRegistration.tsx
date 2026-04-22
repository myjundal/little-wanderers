'use client';

import { useState } from 'react';

type MemberForm = {
  full_name: string;
  birthdate: string;
  role: 'adult' | 'child';
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid #d9c8f7',
  background: '#fff',
};

export default function StaffFamilyRegistration({ onSaved }: { onSaved: () => Promise<void> }) {
  const [householdName, setHouseholdName] = useState('');
  const [members, setMembers] = useState<MemberForm[]>([{ full_name: '', birthdate: '', role: 'adult' }]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateMember = (index: number, patch: Partial<MemberForm>) => {
    setMembers((prev) => prev.map((member, i) => (i === index ? { ...member, ...patch } : member)));
  };

  const addMember = () => {
    setMembers((prev) => [...prev, { full_name: '', birthdate: '', role: 'child' }]);
  };

  const saveFamily = async () => {
    setSaving(true);
    setMessage(null);

    const res = await fetch('/api/admin/families/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ household_name: householdName, members }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      setSaving(false);
      setMessage(json.error ?? 'Could not save this family yet.');
      return;
    }

    setHouseholdName('');
    setMembers([{ full_name: '', birthdate: '', role: 'adult' }]);
    setSaving(false);
    setMessage('Family saved successfully.');
    await onSaved();
  };

  return (
    <section style={{ marginTop: 24, border: '1px solid #ddcff7', borderRadius: 24, background: 'linear-gradient(180deg,#fff,#faf5ff)', padding: 20 }}>
      <h2 style={{ marginTop: 0, color: '#4f3f82' }}>Register New Family</h2>
      <p style={{ marginTop: 0, color: '#6d6480' }}>Quickly register a new family for check-in.</p>

      <div style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
        <label>
          <span style={{ display: 'block', marginBottom: 6, fontWeight: 700 }}>Family Name (optional)</span>
          <input value={householdName} onChange={(e) => setHouseholdName(e.target.value)} placeholder="The Johnson Family" style={inputStyle} />
        </label>
      </div>

      <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
        {members.map((member, index) => (
          <div key={index} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.8fr', gap: 8 }}>
            <input
              value={member.full_name}
              onChange={(e) => updateMember(index, { full_name: e.target.value })}
              placeholder="Full Name"
              style={inputStyle}
            />
            <input
              type="date"
              value={member.birthdate}
              onChange={(e) => updateMember(index, { birthdate: e.target.value })}
              style={inputStyle}
            />
            <select value={member.role} onChange={(e) => updateMember(index, { role: e.target.value as 'adult' | 'child' })} style={inputStyle}>
              <option value="adult">Adult</option>
              <option value="child">Child</option>
            </select>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={addMember}
          style={{ borderRadius: 12, border: '1px solid #d9c8f7', padding: '10px 14px', background: '#fff', color: '#5f3da4', fontWeight: 700 }}
        >
          Add Another Member
        </button>
        <button type="button" onClick={saveFamily} disabled={saving} style={{ borderRadius: 12, border: 'none', padding: '10px 14px', background: '#6d4bb7', color: '#fff', fontWeight: 700 }}>
          {saving ? 'Saving…' : 'Save Family'}
        </button>
      </div>

      {message && <p style={{ marginTop: 10, color: '#5f3da4' }}>{message}</p>}
    </section>
  );
}
