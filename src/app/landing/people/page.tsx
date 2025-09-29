'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabaseBrowser } from '@/lib/supabaseClient';

type Person = {
  id: string;
  role: 'adult' | 'child';
  first_name: string;
  last_name: string | null;
  birthdate: string | null; // ISO
};

export default function PeoplePage() {
  const supabase = supabaseBrowser;
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [form, setForm] = useState({ role: 'child', first_name: '', last_name: '', birthdate: '' });

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return;

    // 내 household 찾기
    const { data: hs } = await supabase
      .from('households')
      .select('id')
      .eq('owner_user_id', uid)
      .maybeSingle();

    if (!hs) return;
    setHouseholdId(hs.id);

    // 해당 household 의 people 목록
    const { data: ppl } = await supabase
      .from('people')
      .select('id, role, first_name, last_name, birthdate')
      .eq('household_id', hs.id)
      .order('created_at', { ascending: true });

    setPeople((ppl ?? []) as Person[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addPerson = async () => {
    if (!householdId || !form.first_name) return;
    await supabase.from('people').insert({
      household_id: householdId,
      role: form.role as 'adult' | 'child',
      first_name: form.first_name,
      last_name: form.last_name || null,
      birthdate: form.birthdate || null,
    });
    setForm({ role: form.role, first_name: '', last_name: '', birthdate: '' });
    await load();
  };

  const removePerson = async (id: string) => {
    await supabase.from('people').delete().eq('id', id);
    await load();
  };

  return (
    <main style={{ padding: 24, maxWidth: 640 }}>
      <h1>My People</h1>

      <section style={{ marginTop: 16, padding: 12, border: '1px solid #ddd' }}>
        <h3>Add New Person</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            <option value="adult">Adult</option>
            <option value="child">Child</option>
          </select>
          <input placeholder="First name"
                 value={form.first_name}
                 onChange={e => setForm({ ...form, first_name: e.target.value })}/>
          <input placeholder="Last name (optional)"
                 value={form.last_name}
                 onChange={e => setForm({ ...form, last_name: e.target.value })}/>
          <input type="date"
                 value={form.birthdate}
                 onChange={e => setForm({ ...form, birthdate: e.target.value })}/>
          <button onClick={addPerson}>Add</button>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h3>My People</h3>
        {people.length === 0 && <p>No one is registered yet.</p>}
        <ul>
          {people.map(p => (
            <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
              <span style={{ width: 64, textTransform: 'capitalize' }}>{p.role}</span>
              <span style={{ minWidth: 160 }}>{p.first_name} {p.last_name ?? ''}</span>
              <span style={{ color: '#666' }}>{p.birthdate ?? '-'}</span>
              <button onClick={() => removePerson(p.id)} style={{ marginLeft: 'auto' }}>삭제</button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

