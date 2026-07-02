'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { ensureHouseholdForUser, getLatestHouseholdIdForUser } from '@/lib/households';
import { US_CITIES_BY_STATE, US_STATE_OPTIONS, type UsStateCode } from '@/lib/us-cities';
import styles from './onboarding.module.css';

type Gender = 'female' | 'male' | 'non_binary' | 'prefer_not_to_say';
type ChildForm = {
  key: number;
  firstName: string;
  lastName: string;
  gender: Gender | '';
  birthdate: string;
};

const WAIVER_URL = process.env.NEXT_PUBLIC_WAIVER_URL ?? 'https://docs.google.com/forms/d/e/1FAIpQLSeleoqMn8UslZs8RiEg_02Ld4t-5WuIyhhHySoyb_3mCYJMUw/viewform?usp=dialog';

const genderOptions: Array<{ value: Gender; label: string }> = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const blankChild = (key: number): ChildForm => ({
  key,
  firstName: '',
  lastName: '',
  gender: '',
  birthdate: '',
});

function normalizeUsPhone(input: string) {
  const digits = input.replace(/\D/g, '');
  if (!digits) return '';
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return `+1${local}`;
}

function normalizeCityName(input: string) {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function getCookieValue(name: string) {
  if (typeof document === 'undefined') return null;
  const encodedName = `${encodeURIComponent(name)}=`;
  const match = document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(encodedName));
  return match ? decodeURIComponent(match.slice(encodedName.length)) : null;
}

function clearCookie(name: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0`;
}

function getSafeRedirect(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/landing';
  return value;
}

export default function OnboardingPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [ready, setReady] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [existingPeopleCount, setExistingPeopleCount] = useState(0);
  const [authEmail, setAuthEmail] = useState('');
  const [authPhone, setAuthPhone] = useState('');

  const [adultFirstName, setAdultFirstName] = useState('');
  const [adultLastName, setAdultLastName] = useState('');
  const [adultGender, setAdultGender] = useState<Gender | ''>('');
  const [children, setChildren] = useState<ChildForm[]>([blankChild(1)]);
  const [city, setCity] = useState('');
  const [state, setState] = useState<UsStateCode>('CT');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [waiverConfirmed, setWaiverConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);

  const stateCities = useMemo(() => US_CITIES_BY_STATE[state] ?? [], [state]);
  const suggestedCities = useMemo(() => {
    const query = normalizeCityName(city);
    if (!query) return stateCities.slice(0, 80);
    const starts = stateCities.filter((name) => normalizeCityName(name).startsWith(query));
    const contains = stateCities.filter((name) => !normalizeCityName(name).startsWith(query) && normalizeCityName(name).includes(query));
    return [...starts, ...contains].slice(0, 80);
  }, [city, stateCities]);

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const previewHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const preview = previewHost && params.get('preview') === '1';
      if (preview) {
        setIsPreview(true);
        setReady(true);
        setHouseholdId('preview');
        setAuthEmail('hello@example.com');
        setEmail('hello@example.com');
        setPhone('');
        setCity('West Hartford');
        return;
      }

      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      if (!user) {
        window.location.replace('/login');
        return;
      }

      setAuthEmail(user.email ?? '');
      setAuthPhone(user.phone ?? '');
      setEmail(user.email ?? '');
      setPhone(user.phone ?? '');

      let hid = await getLatestHouseholdIdForUser(supabase, user.id);
      if (!hid) {
        hid = await ensureHouseholdForUser(supabase, user.id, user.email?.split('@')[0] ?? user.phone ?? 'My Household');
      }
      setHouseholdId(hid);

      const [{ data: household }, { data: people }, { data: waivers }] = await Promise.all([
        supabase.from('households').select('name,email,phone,city,state').eq('id', hid).maybeSingle(),
        supabase.from('people').select('id,role,first_name,last_name,gender,birthdate').eq('household_id', hid).order('created_at', { ascending: true }),
        supabase.from('waivers').select('signed_at,signed_date').eq('household_id', hid).order('created_at', { ascending: false }).limit(5),
      ]);

      const existingPeople = people ?? [];
      const hasSignedWaiver = (waivers ?? []).some((row) => row.signed_at || row.signed_date);
      if (existingPeople.length > 0 && hasSignedWaiver) {
        window.location.replace('/landing');
        return;
      }

      setExistingPeopleCount(existingPeople.length);
      const adult = existingPeople.find((person) => person.role === 'adult');
      if (adult) {
        setAdultFirstName(adult.first_name ?? '');
        setAdultLastName(adult.last_name ?? '');
        setAdultGender((adult.gender as Gender | null) ?? '');
      }

      setEmail(user.email ?? household?.email ?? '');
      setPhone(user.phone ?? household?.phone ?? '');
      setCity(household?.city ?? '');
      if (household?.state && household.state in US_CITIES_BY_STATE) {
        setState(household.state as UsStateCode);
      }

      setReady(true);
    };

    void run();
  }, [supabase]);

  const updateChild = (key: number, next: Partial<ChildForm>) => {
    setChildren((current) => current.map((child) => child.key === key ? { ...child, ...next } : child));
  };

  const addChild = () => {
    setChildren((current) => [...current, blankChild((current.at(-1)?.key ?? 0) + 1)]);
  };

  const removeChild = (key: number) => {
    setChildren((current) => current.length === 1 ? current : current.filter((child) => child.key !== key));
  };

  const completeOnboarding = async () => {
    setError(null);

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = normalizeUsPhone(phone);
    const cityMatch = stateCities.find((name) => normalizeCityName(name) === normalizeCityName(city));
    const childRows = children.filter((child) => child.firstName.trim() || child.lastName.trim() || child.gender || child.birthdate);

    if (!adultFirstName.trim() || !adultLastName.trim() || !adultGender) {
      setError('Please add your first name, last name, and gender.');
      return;
    }

    if (childRows.length === 0 || childRows.some((child) => !child.firstName.trim() || !child.gender || !child.birthdate)) {
      setError('Please add each child’s first name, gender, and birthday.');
      return;
    }

    if (!cityMatch) {
      setError('Please choose a city from the suggestions for the selected state.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!/^\+1\d{10}$/.test(normalizedPhone)) {
      setError('Please enter a valid US phone number.');
      return;
    }

    if (!waiverConfirmed) {
      setError('Please confirm that you have read and signed the waiver.');
      return;
    }

    setSaving(true);

    const parentName = `${adultFirstName.trim()} ${adultLastName.trim()}`.trim();
    const nextRedirect = getSafeRedirect(sessionStorage.getItem('post_onboarding_redirect') || getCookieValue('post_onboarding_redirect'));
    sessionStorage.removeItem('post_onboarding_redirect');
    clearCookie('post_onboarding_redirect');

    if (!isPreview) {
      if (!householdId) {
        setError('We could not find your household. Please sign in again.');
        setSaving(false);
        return;
      }

      const householdName = adultLastName.trim() ? `${adultLastName.trim()} Family` : parentName;
      const { error: householdError } = await supabase
        .from('households')
        .update({
          name: householdName,
          email: normalizedEmail,
          phone: normalizedPhone,
          city: cityMatch,
          state,
        })
        .eq('id', householdId);

      if (householdError) {
        setError('Something went wrong while saving your household information.');
        setSaving(false);
        return;
      }

      if (existingPeopleCount === 0) {
        const peopleRows = [
          {
            household_id: householdId,
            role: 'adult',
            first_name: adultFirstName.trim(),
            last_name: adultLastName.trim(),
            gender: adultGender,
            birthdate: null,
          },
          ...childRows.map((child) => ({
            household_id: householdId,
            role: 'child',
            first_name: child.firstName.trim(),
            last_name: child.lastName.trim() || null,
            gender: child.gender,
            birthdate: child.birthdate,
          })),
        ];

        const { error: peopleError } = await supabase.from('people').insert(peopleRows);
        if (peopleError) {
          setError('Something went wrong while saving your family members.');
          setSaving(false);
          return;
        }
      }

      const now = new Date().toISOString();
      const waiverPayload = {
        household_id: householdId,
        signed_at: now,
        signed_date: now,
        parent_name: parentName,
        email: normalizedEmail,
        phone: normalizedPhone,
        child_1_name: childRows[0] ? `${childRows[0].firstName.trim()} ${childRows[0].lastName.trim()}`.trim() : null,
        child_1_dob: childRows[0]?.birthdate || null,
        child_2_name: childRows[1] ? `${childRows[1].firstName.trim()} ${childRows[1].lastName.trim()}`.trim() : null,
        child_2_dob: childRows[1]?.birthdate || null,
        child_3_name: childRows[2] ? `${childRows[2].firstName.trim()} ${childRows[2].lastName.trim()}`.trim() : null,
        child_3_dob: childRows[2]?.birthdate || null,
        additional_children: childRows.length > 3
          ? childRows.slice(3).map((child) => `${child.firstName.trim()} ${child.lastName.trim()} (${child.birthdate})`.trim()).join('; ')
          : null,
        electronic_signature: parentName,
        source: 'onboarding',
      };

      const { error: waiverError } = await supabase.from('waivers').insert(waiverPayload);
      if (waiverError) {
        setError('Your family was saved, but we could not confirm the waiver. Please try the confirmation again.');
        setSaving(false);
        return;
      }

      await fetch('/api/waitlist/claim', { method: 'POST' }).catch(() => null);
    }

    setWelcome(true);
    setSaving(false);
    window.setTimeout(() => {
      window.location.replace(isPreview ? '/onboarding?preview=1' : nextRedirect);
    }, 1700);
  };

  if (!ready) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>Loading…</div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.hero}>
          <section className={styles.intro}>
            <div>
              <p className={styles.eyebrow}>Little Wanderers</p>
              <h1>Welcome. Let’s get your family set up.</h1>
              <p className={styles.introCopy}>
                Add yourself, your child, your contact details, and confirm your waiver so visits, QR codes, classes, and bookings are ready from your dashboard.
              </p>
            </div>
            <div className={styles.steps} aria-label="Onboarding steps">
              <div className={styles.step}><span className={styles.stepNumber}>1</span><span>Tell us who is in your family.</span></div>
              <div className={styles.step}><span className={styles.stepNumber}>2</span><span>Confirm where you live and how we can reach you.</span></div>
              <div className={styles.step}><span className={styles.stepNumber}>3</span><span>Read and sign the waiver before heading to your dashboard.</span></div>
            </div>
          </section>

          <section className={styles.formCard}>
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>About You</h2>
              <div className={styles.gridThree}>
                <div className={styles.field}>
                  <label htmlFor="adult-first">First name</label>
                  <input id="adult-first" value={adultFirstName} onChange={(event) => setAdultFirstName(event.target.value)} autoComplete="given-name" />
                </div>
                <div className={styles.field}>
                  <label htmlFor="adult-last">Last name</label>
                  <input id="adult-last" value={adultLastName} onChange={(event) => setAdultLastName(event.target.value)} autoComplete="family-name" />
                </div>
                <div className={styles.field}>
                  <label htmlFor="adult-gender">Gender</label>
                  <select id="adult-gender" value={adultGender} onChange={(event) => setAdultGender(event.target.value as Gender | '')}>
                    <option value="">Select</option>
                    {genderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Children</h2>
              {children.map((child, index) => (
                <div className={styles.childCard} key={child.key}>
                  <div className={styles.childHeader}>
                    <span>Child {index + 1}</span>
                    {children.length > 1 && (
                      <button className={styles.ghostButton} type="button" onClick={() => removeChild(child.key)}>Remove</button>
                    )}
                  </div>
                  <div className={styles.gridTwo}>
                    <div className={styles.field}>
                      <label htmlFor={`child-first-${child.key}`}>First name</label>
                      <input id={`child-first-${child.key}`} value={child.firstName} onChange={(event) => updateChild(child.key, { firstName: event.target.value })} />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor={`child-last-${child.key}`}>Last name (optional)</label>
                      <input id={`child-last-${child.key}`} value={child.lastName} onChange={(event) => updateChild(child.key, { lastName: event.target.value })} />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor={`child-gender-${child.key}`}>Gender</label>
                      <select id={`child-gender-${child.key}`} value={child.gender} onChange={(event) => updateChild(child.key, { gender: event.target.value as Gender | '' })}>
                        <option value="">Select</option>
                        {genderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor={`child-birthdate-${child.key}`}>Birthday</label>
                      <input id={`child-birthdate-${child.key}`} type="date" value={child.birthdate} onChange={(event) => updateChild(child.key, { birthdate: event.target.value })} />
                    </div>
                  </div>
                </div>
              ))}
              <button className={styles.secondaryButton} type="button" onClick={addChild}>Add another child</button>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Home & Contact</h2>
              <div className={`${styles.gridTwo} ${styles.contactGrid}`}>
                <div className={styles.field}>
                  <label htmlFor="city">City</label>
                  <input id="city" list="city-options" value={city} onChange={(event) => setCity(event.target.value)} autoComplete="address-level2" />
                  <datalist id="city-options">
                    {suggestedCities.map((name) => <option key={name} value={name} />)}
                  </datalist>
                  <p className={styles.hint}>Start typing and choose the city that matches your selected state.</p>
                </div>
                <div className={styles.field}>
                  <label htmlFor="state">State</label>
                  <select id="state" value={state} onChange={(event) => { setState(event.target.value as UsStateCode); setCity(''); }} autoComplete="address-level1">
                    {US_STATE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="email">Email</label>
                  <input id="email" type="email" value={email} readOnly={Boolean(authEmail)} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
                  {authEmail && <p className={styles.hint}>Pulled from your email sign-in.</p>}
                </div>
                <div className={styles.field}>
                  <label htmlFor="phone">Phone</label>
                  <input id="phone" type="tel" value={phone} readOnly={Boolean(authPhone)} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" placeholder="(555) 123-4567" />
                  {authPhone && <p className={styles.hint}>Pulled from your phone sign-in.</p>}
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Waiver</h2>
              <div className={styles.waiverPanel}>
                <p className={styles.hint}>
                  Please read and sign the current Little Wanderers waiver. When you are finished, confirm it here and we will mark your family waiver as complete.
                </p>
                <div className={styles.waiverActions}>
                  <a href={WAIVER_URL} target="_blank" rel="noreferrer">Open waiver form</a>
                </div>
                <label className={styles.checkRow}>
                  <input type="checkbox" checked={waiverConfirmed} onChange={(event) => setWaiverConfirmed(event.target.checked)} />
                  <span className={styles.checkLabel}>I have read and signed the waiver for my family.</span>
                </label>
              </div>
            </div>

            <div className={styles.submitRow}>
              <button className={styles.primaryButton} type="button" onClick={completeOnboarding} disabled={saving || welcome}>
                {saving ? 'Saving…' : 'Complete setup'}
              </button>
              {welcome && <p className={styles.message}>Welcome to Little Wanderers. Taking you to your dashboard…</p>}
              {error && <p className={styles.error}>{error}</p>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
