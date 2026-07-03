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

function cleanCityName(input: string) {
  return input.trim().replace(/\s+/g, ' ');
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

      const [{ data: household }, { data: people }] = await Promise.all([
        supabase.from('households').select('name,email,phone,city,state').eq('id', hid).maybeSingle(),
        supabase.from('people').select('id,role,first_name,last_name,gender,birthdate').eq('household_id', hid).order('created_at', { ascending: true }),
      ]);

      const existingPeople = people ?? [];
      if (existingPeople.length > 0) {
        window.location.replace('/landing');
        return;
      }

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
    const submittedCity = cityMatch ?? cleanCityName(city);
    const childRows = children.filter((child) => child.firstName.trim() || child.lastName.trim() || child.gender || child.birthdate);

    if (!adultFirstName.trim() || !adultLastName.trim() || !adultGender) {
      setError('Please add your first name, last name, and gender.');
      return;
    }

    if (childRows.length === 0 || childRows.some((child) => !child.firstName.trim() || !child.gender || !child.birthdate)) {
      setError('Please add each child’s first name, gender, and birthday.');
      return;
    }

    if (!submittedCity) {
      setError('Please enter your city or town.');
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

    setSaving(true);

    const nextRedirect = getSafeRedirect(sessionStorage.getItem('post_onboarding_redirect') || getCookieValue('post_onboarding_redirect'));
    sessionStorage.removeItem('post_onboarding_redirect');
    clearCookie('post_onboarding_redirect');

    if (!isPreview) {
      if (!householdId) {
        setError('We could not find your household. Please sign in again.');
        setSaving(false);
        return;
      }

      const response = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          adultFirstName: adultFirstName.trim(),
          adultLastName: adultLastName.trim(),
          adultGender,
          children: childRows.map((child) => ({
            firstName: child.firstName.trim(),
            lastName: child.lastName.trim(),
            gender: child.gender,
            birthdate: child.birthdate,
          })),
          city: submittedCity,
          state,
          email: normalizedEmail,
          phone: normalizedPhone,
        }),
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!response.ok || !json?.ok) {
        setError(json?.error ?? 'Something went wrong while saving your family setup.');
        setSaving(false);
        return;
      }
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
                Add yourself, your child, and your contact details so your family dashboard and early access party holds are ready.
              </p>
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
                  <label htmlFor="city">City or town</label>
                  <input id="city" list="city-options" value={city} onChange={(event) => setCity(event.target.value)} autoComplete="address-level2" />
                  <datalist id="city-options">
                    {suggestedCities.map((name) => <option key={name} value={name} />)}
                  </datalist>
                  <p className={styles.hint}>Choose a suggestion or type your town if it is not listed.</p>
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
