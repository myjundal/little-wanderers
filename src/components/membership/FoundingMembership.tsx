'use client';

import Link from 'next/link';
import Script from 'next/script';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { membershipTerms, MEMBERSHIP_PRICES, FOUNDING_TERMS_VERSION, easternDate, foundingMonthlyCents, type MembershipOffer, type MembershipTier } from '@/lib/founding-membership';
import { formatBirthdateInput, parseBirthdate } from '@/lib/birthdate';
import styles from './founding.module.css';

type Gender = '' | 'female' | 'male' | 'non_binary' | 'prefer_not_to_say';
type Child = { id: string; firstName: string; lastName: string; gender: Gender; birthdate: string; existing?: boolean };
type Profile = { adultFirstName: string; adultLastName: string; adultGender: Gender; email: string; phone: string; city: string; state: string; children: Child[] };
type Enrollment = { status: string; pricing_tier: MembershipTier; base_cents: number; sibling_cents: number; card_brand: string | null; card_last4: string | null; amount_cents: number; start_date: string | null; paid_through: string | null };
type Config = { applicationId: string; locationId: string; environment: string };
type Card = { attach(selector: string): Promise<void>; destroy(): Promise<void>; tokenize(details: Record<string, unknown>): Promise<{ status: string; token?: string }> };
type SquareWindow = Window & { Square?: { payments(applicationId: string, locationId: string): { card(): Promise<Card> } } };
type Person = { id: string; role: string; first_name: string; last_name: string; gender: Gender; birthdate: string };
const emptyProfile: Profile = { adultFirstName: '', adultLastName: '', adultGender: '', email: '', phone: '', city: '', state: 'CT', children: [] };
const money = (cents: number) => `$${(cents / 100).toFixed(0)}`;
const blankChild = (): Child => ({ id: crypto.randomUUID(), firstName: '', lastName: '', gender: '', birthdate: '' });

function GenderSelect({ id, value, onChange }: { id: string; value: Gender; onChange(value: Gender): void }) {
  return <select id={id} required value={value} onChange={event => onChange(event.target.value as Gender)}><option value="">Select</option><option value="female">Female</option><option value="male">Male</option><option value="non_binary">Non-binary</option><option value="prefer_not_to_say">Prefer not to say</option></select>;
}

export default function FoundingMembership({ audience }: { audience?: 'waitlist' | 'public' } = {}) {
  const entryPath = audience === 'waitlist' ? '/wanderlist-founding' : audience === 'public' ? '/general-founding' : '/founding-membership';
  const signInHref = `/login?mode=continue&next=${encodeURIComponent(entryPath)}`;
  const [auth, setAuth] = useState<'loading' | 'guest' | 'signedIn' | 'error'>('loading');
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [emailLocked, setEmailLocked] = useState(true);
  const [signedInAs, setSignedInAs] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [offer, setOffer] = useState<MembershipOffer>({ phase: 'waitlist', tier: 'waitlist', can_enroll: false, base_cents: 5000, sibling_cents: 1000 });
  const [config, setConfig] = useState<Config | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [birthdaysConfirmed, setBirthdaysConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [step, setStep] = useState(0);
  const cardRef = useRef<Card | null>(null);
  const submitting = useRef(false);
  const locked = enrollment && !['draft', 'saving_card'].includes(enrollment.status);
  const waitlistUnavailable = audience === 'waitlist' && auth === 'signedIn' && offer.phase !== 'regular' && offer.tier !== 'waitlist';

  useEffect(() => {
    let active = true;
    void fetch('/api/founding-membership', { cache: 'no-store' }).then(async response => {
      if (!active) return;
      const data = await response.json();
      if (data.offer) setOffer(data.offer);
      if (response.status === 401) { setAuth('guest'); return; }
      if (!response.ok) throw new Error(data.error);
      if (!active) return;
      const adult = (data.people as Person[]).find(person => person.role === 'adult');
      const children = (data.people as Person[]).filter(person => person.role === 'child').map((person): Child => ({ id: person.id, firstName: person.first_name || '', lastName: person.last_name || '', gender: person.gender || '', birthdate: formatBirthdateInput(person.birthdate || ''), existing: true }));
      setProfile({ adultFirstName: adult?.first_name || '', adultLastName: adult?.last_name || '', adultGender: adult?.gender || '', email: data.household.email || '', phone: data.household.phone || '', city: data.household.city || '', state: data.household.state || 'CT', children: children.length ? children : [blankChild()] });
      setEmailLocked(Boolean(data.account?.email));
      setSignedInAs(data.account?.email || data.account?.phone || '');
      setEnrollment(data.enrollment); setConfig(data.config); setAuth('signedIn');
    }).catch(() => { if (active) { setAuth('error'); setError('We could not load your family account. Please refresh to try again.'); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (step !== 2 || !sdkReady || !config || locked || waitlistUnavailable) return;
    let disposed = false;
    let localCard: Card | undefined;
    const setup = async () => {
      const square = (window as SquareWindow).Square;
      if (!square) throw new Error('The secure card form could not load. Please refresh and try again.');
      localCard = await square.payments(config.applicationId, config.locationId).card();
      if (disposed) { await localCard.destroy(); return; }
      await localCard.attach('#founding-card');
      if (!disposed) { cardRef.current = localCard; setCardReady(true); }
    };
    void setup().catch(() => { if (!disposed) setError('The secure Square card form could not load. Please refresh and try again.'); });
    return () => { disposed = true; cardRef.current = null; setCardReady(false); if (localCard) void localCard.destroy(); };
  }, [step, sdkReady, config, locked, waitlistUnavailable]);

  const patch = (key: keyof Omit<Profile, 'children'>, value: string) => setProfile(current => ({ ...current, [key]: value }));
  const patchChild = (id: string, next: Partial<Child>) => { setProfile(current => ({ ...current, children: current.children.map(child => child.id === id ? { ...child, ...next } : child) })); setBirthdaysConfirmed(false); };
  // The entry page keeps its advertised identity after login. Checkout and saved
  // memberships always use the server-verified account rate, independently.
  const accountTier = enrollment && enrollment.status !== 'canceled' ? enrollment.pricing_tier : offer.tier;
  const tier = audience && offer.phase !== 'regular' ? audience : accountTier;
  const price = MEMBERSHIP_PRICES[tier];
  const accountPrice = MEMBERSHIP_PRICES[accountTier];
  const founding = tier !== 'regular';
  const terms = membershipTerms(accountTier);
  let estimate: number | null = null;
  try { estimate = foundingMonthlyCents(profile.children.map(child => parseBirthdate(child.birthdate) || ''), easternDate(), accountTier); } catch { /* Show a total once the dates are complete. */ }

  async function switchAccount() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const { createBrowserSupabaseClient } = await import('@/lib/supabase/browser');
      const { error } = await createBrowserSupabaseClient().auth.signOut({ scope: 'local' });
      if (error) throw error;
      window.location.assign(signInHref);
    } catch { setError('We could not switch accounts. Please refresh and try again.'); setBusy(false); }
  }

  function changeStep(next: number) {
    setStep(next); setError(null);
    if (next !== 2) setConsent(false);
    if (typeof document !== 'undefined') document.getElementById('join')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function continueFamily() {
    if (step === 0) {
      const digits = profile.phone.replace(/\D/g, '');
      const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
      if (!/^\d{10}$/.test(local)) { setError('Enter a 10-digit US phone number.'); return; }
      changeStep(1);
      return;
    }
    const dates = profile.children.map(child => parseBirthdate(child.birthdate));
    if (dates.some(date => !date || date > easternDate())) { setError('Enter each child’s actual birthday as MM/DD/YYYY.'); return; }
    if (!birthdaysConfirmed) { setError('Please confirm your children’s names and birthdays.'); return; }
    changeStep(2);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 2) { continueFamily(); return; }
    if (submitting.current || !cardRef.current || !consent || !birthdaysConfirmed || !offer.can_enroll || waitlistUnavailable) return;
    const dates = profile.children.map(child => parseBirthdate(child.birthdate));
    if (dates.some(date => !date)) { setError('Enter a real birthday for each child as MM/DD/YYYY.'); return; }
    const digits = profile.phone.replace(/\D/g, '');
    const phone = `+1${digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits}`;
    if (!/^\+1\d{10}$/.test(phone)) { setError('Enter a valid 10-digit US phone number.'); return; }
    submitting.current = true; setBusy(true); setError(null);
    try {
      const token = await cardRef.current.tokenize({ intent: 'STORE', customerInitiated: true, sellerKeyedIn: false, billingContact: { givenName: profile.adultFirstName, familyName: profile.adultLastName, email: profile.email, phone, city: profile.city, state: profile.state, countryCode: 'US' } });
      if (token.status !== 'OK' || !token.token) throw new Error('Please check your card information and try again.');
      const response = await fetch('/api/founding-membership', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...profile, phone, children: profile.children.map((child, i) => ({ ...child, birthdate: dates[i] })), sourceId: token.token, consent, birthdaysConfirmed, termsVersion: FOUNDING_TERMS_VERSION, pricingTier: offer.tier }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Unable to save your card. No payment was taken.');
      setEnrollment(data.enrollment);
      document.getElementById('founding-status')?.focus();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save your card. Please try again.'); }
    finally { submitting.current = false; setBusy(false); }
  }

  async function cancel() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch('/api/founding-membership', { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error);
      setEnrollment(current => current ? { ...current, status: 'canceled' } : current); setOffer(current => ({ ...current, tier: 'regular', base_cents: 6000, sibling_cents: 2000, can_enroll: true })); setConsent(false); setCancelConfirm(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Please retry cancellation.'); }
    finally { submitting.current = false; setBusy(false); }
  }

  return <main className={styles.page}>
    <div className={styles.layout}>
      <section className={`${styles.offer} ${auth === 'signedIn' ? styles.offerCompact : ''}`} aria-label="Membership offer">
        <span className={styles.eyebrow}>{price.label}</span>
        <h1>{founding ? 'Founding membership.' : 'Monthly membership.'}</h1>
        <p className={styles.tagline}>Unlimited open play for your family.</p>
        <div className={styles.price}>{money(price.base_cents)}<span>/mo</span></div>
        <p className={styles.firstChild}>First child{founding && <> · regularly <s>$60/mo</s></>}</p>
        <p className={styles.sibling}><strong>+{money(price.sibling_cents)}/mo</strong> per sibling, 6 months or older</p>
        <p className={styles.small}>Baby siblings under 6 months are free.</p>
        <p className={styles.rateNote}>{founding ? 'Lifetime rates while active.' : 'Regular monthly pricing.'} Cancel anytime.</p>
        <div className={styles.today}><strong>Pay $0 today.</strong><span>Monthly billing starts on your first membership visit, including during soft opening.</span></div>
        <details className={styles.offerDetails}>
          <summary>What’s included & membership details</summary>
          <ul><li>Unlimited open play, with up to two accompanying adults.</li><li>Visits throughout our soft opening period are included, with no separate admission charge. Reservations, capacity limits, and a signed waiver apply.</li><li>Priority registration for select classes and events.</li></ul>
          {founding && <p>Two children, both 6mo+: {money(price.base_cents + price.sibling_cents)}/mo · {price.two_child_discount}% off regular pricing.</p>}
          <p>No commitment. {founding && 'Both first-child and sibling rates stay locked in while your membership stays active.'} If you cancel and rejoin, regular $60 + $20 pricing applies. Sibling charges begin with the billing cycle after a baby turns 6 months.</p>
        </details>
      </section>

      <section id="join" className={styles.formCard} aria-label="Join membership">
        {auth === 'loading' && <p role="status">Checking your sign-in…</p>}
        {auth === 'error' && <div className={styles.guest}><h2>Let’s try that again.</h2><p>Your family details could not load.</p><button type="button" className={styles.primary} onClick={() => window.location.reload()}>Reload membership</button></div>}
        {auth === 'guest' && <div className={styles.guest}>
          <span className={styles.eyebrow}>Start here</span><h2>Join in a few simple steps.</h2>
          <ol className={styles.guestSteps}><li>Sign in</li><li>Add your family</li><li>Save your card</li></ol>
          <p>{audience === 'waitlist' ? 'Use the email you joined the Wanderlist with to unlock your $10 sibling rate.' : 'Use your email to continue. Your family account is created automatically if you’re new.'}</p>
          {audience === 'public' && offer.phase === 'waitlist' && <p className={styles.notice}>Public founding opens after Wanderlist families have had first access.</p>}
          <Link className={styles.primary} href={signInHref}>Continue with email</Link>
          <p className={styles.small}>Already have an account? Use the same email or a phone already linked to it. No separate signup.</p>
          <p className={styles.reassurance}>$0 today · No commitment</p>
        </div>}
        {auth === 'signedIn' && !locked && waitlistUnavailable && <div className={styles.guest}>
          <h2>Use your Wanderlist email.</h2>
          {signedInAs && <p className={styles.account}>Signed in as <strong>{signedInAs}</strong></p>}
          <p>We could not confirm eligibility with this account. Sign in with the email you joined the Wanderlist with for $50/month + $10 per eligible sibling.</p>
          <p className={styles.small}>First-time phone sign-in doesn’t connect to your Wanderlist email.</p>
          <button type="button" className={styles.primary} disabled={busy} onClick={switchAccount}>{busy ? 'Switching accounts…' : 'Use my Wanderlist email'}</button>
          <Link className={styles.secondary} href={offer.tier === 'regular' ? '/founding-membership' : '/general-founding'}>{offer.tier === 'regular' ? 'View regular membership' : 'View general founding membership'}</Link>
          <Link className={styles.help} href="/contact">Need a hand? Contact us</Link>
        </div>}
        {auth === 'signedIn' && locked && <div id="founding-status" tabIndex={-1} className={styles.status}>
          <span className={styles.eyebrow}>{enrollment.status === 'canceled' ? 'Membership canceled' : accountPrice.label}</span>
          <h3>{enrollment.status === 'canceled' ? 'Your cancellation is confirmed.' : enrollment.status === 'pending' ? 'You’re in. We can’t wait to meet you.' : 'Your founding membership'}</h3>
          {enrollment.status !== 'canceled' && <><p>Card saved: {enrollment.card_brand} ending in {enrollment.card_last4}.</p><p>{enrollment.start_date ? `Monthly billing starts ${enrollment.start_date}.` : 'No payment has been taken for your reservation. Your first monthly payment begins on your first membership visit, including during soft opening, when we activate your membership at the studio. Your billing start date is not set yet.'}</p><p><strong>{money(enrollment.base_cents)}/month</strong> for the first child + {money(enrollment.sibling_cents)}/month per sibling age 6 months or older.{enrollment.pricing_tier !== 'regular' && ' Both rates stay locked in while your membership stays active.'}</p><p>Your visits throughout the soft opening period are included with your membership, with no separate admission charge. <Link href="/landing/soft-opening">Reserve a visit</Link> when times become available.</p></>}
          {enrollment.status === 'canceled' && <p>Your founding rates have ended. Rejoining is $60/month for the first child + $20/month per eligible sibling.{enrollment.paid_through ? ` Any paid access continues through ${enrollment.paid_through}.` : ' No further monthly billing is scheduled.'}</p>}
          {enrollment.status === 'canceled' && (waitlistUnavailable ? <Link className={styles.primary} href="/founding-membership">Rejoin at regular $60 + $20 pricing</Link> : <button type="button" className={styles.primary} onClick={() => { setEnrollment(null); setStep(0); setConsent(false); setBirthdaysConfirmed(false); }}>Rejoin at regular $60 + $20 pricing</button>)}
          <Link className={styles.secondary} href="/landing">Go to my family dashboard</Link>
          {enrollment.status !== 'canceled' && <>{!cancelConfirm ? <button type="button" className={styles.textButton} onClick={() => setCancelConfirm(true)}>Cancel my membership</button> : <div className={styles.cancelBox}><p>Cancel anytime. Canceling ends your founding rates. Rejoining is $60/month + $20/month per eligible sibling. Future renewals stop.</p><button type="button" className={styles.secondary} disabled={busy} onClick={cancel}>{busy ? 'Canceling…' : 'Confirm cancellation'}</button><button className={styles.textButton} type="button" disabled={busy} onClick={() => setCancelConfirm(false)}>Keep my membership</button></div>}</>}
        </div>}
        {auth === 'signedIn' && !locked && !waitlistUnavailable && <form onSubmit={submit}>
          <ol className={styles.progress} aria-label="Membership setup">
            {['Your details', 'Children', 'Card'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} data-complete={step > index}><span>{step > index ? '✓' : index + 1}</span>{label}</li>)}
          </ol>
          <p className={styles.account}>Signed in as <strong>{signedInAs}</strong></p>
          {audience && audience !== accountTier && offer.can_enroll && <p className={styles.notice}>{accountTier === 'waitlist' ? 'Your account qualifies for original Wanderlist pricing: $50/month + $10/month per eligible sibling.' : accountTier === 'regular' ? 'Your account is eligible for regular membership: $60/month + $20/month per eligible sibling.' : 'Your account qualifies for public founding pricing: $50/month + $20/month per eligible sibling.'}</p>}
          {!offer.can_enroll && <p className={styles.notice}>Public founding registration opens next. We’re saving first access for Wanderlist families.</p>}

          {step === 0 && <fieldset disabled={busy}><legend>Your details</legend>
            <p className={styles.stepIntro}>Confirm your contact details. Saved information is filled in for you.</p>
            <div className={styles.grid}>
              <label htmlFor="founding-first">First name<input id="founding-first" autoComplete="given-name" maxLength={80} required value={profile.adultFirstName} onChange={e => patch('adultFirstName', e.target.value)} /></label>
              <label htmlFor="founding-last">Last name<input id="founding-last" autoComplete="family-name" maxLength={80} required value={profile.adultLastName} onChange={e => patch('adultLastName', e.target.value)} /></label>
              <label htmlFor="founding-phone">US phone number<input id="founding-phone" type="tel" autoComplete="tel" placeholder="(860) 555-0123" required value={profile.phone} onChange={e => patch('phone', e.target.value)} /></label>
              <label htmlFor="founding-gender">Gender<GenderSelect id="founding-gender" value={profile.adultGender} onChange={value => patch('adultGender', value)} /></label>
              {!emailLocked && <label className={styles.fullWidth} htmlFor="founding-email">Contact email<input id="founding-email" type="email" autoComplete="email" required value={profile.email} onChange={e => patch('email', e.target.value)} /></label>}
              <label htmlFor="founding-city">City or town<input id="founding-city" autoComplete="address-level2" required maxLength={100} value={profile.city} onChange={e => patch('city', e.target.value)} /></label>
              <label htmlFor="founding-state">State<input id="founding-state" autoComplete="address-level1" required pattern="[A-Z]{2}" maxLength={2} placeholder="CT" value={profile.state} onChange={e => patch('state', e.target.value.toUpperCase())} /></label>
            </div>
          </fieldset>}

          {step === 1 && <fieldset disabled={busy}><legend>Your children</legend>
            <p className={styles.stepIntro}>Add every child in your membership, with their actual birthday.</p>
            {profile.children.map((child, index) => <div key={child.id} className={styles.child}>
              <div className={styles.childHeading}><strong>Child {index + 1}</strong>{!child.existing && profile.children.length > 1 && <button type="button" className={styles.textButton} onClick={() => { setProfile(p => ({ ...p, children: p.children.filter(c => c.id !== child.id) })); setBirthdaysConfirmed(false); }}>Remove</button>}</div>
              <div className={styles.grid}>
                <label htmlFor={`first-${child.id}`}>First name<input id={`first-${child.id}`} required maxLength={80} value={child.firstName} onChange={e => patchChild(child.id, { firstName: e.target.value })} /></label>
                <label htmlFor={`birth-${child.id}`}>Birthday<input id={`birth-${child.id}`} required inputMode="numeric" placeholder="MM/DD/YYYY" maxLength={10} value={child.birthdate} onChange={e => patchChild(child.id, { birthdate: formatBirthdateInput(e.target.value) })} /></label>
                <label htmlFor={`gender-${child.id}`}>Gender<GenderSelect id={`gender-${child.id}`} value={child.gender} onChange={value => patchChild(child.id, { gender: value })} /></label>
                <label htmlFor={`last-${child.id}`}>Last name (optional)<input id={`last-${child.id}`} maxLength={80} value={child.lastName} onChange={e => patchChild(child.id, { lastName: e.target.value })} /></label>
              </div>
            </div>)}
            <button type="button" className={styles.secondary} disabled={profile.children.length >= 20} onClick={() => { setProfile(p => ({ ...p, children: [...p.children, blankChild()] })); setBirthdaysConfirmed(false); }}>+ Add a sibling</button>
            <label className={styles.checkbox}><input type="checkbox" required checked={birthdaysConfirmed} onChange={e => setBirthdaysConfirmed(e.target.checked)} /><span>My children’s names and birthdays are correct.</span></label>
          </fieldset>}

          {step === 2 && <fieldset disabled={busy}><legend>Save your card</legend>
            <p className={styles.stepIntro}>Last step. No membership payment today.</p>
            <div className={styles.review}><strong>{profile.adultFirstName} {profile.adultLastName}</strong><span>{profile.children.map(child => child.firstName).join(' · ')}</span><button type="button" className={styles.textButton} onClick={() => changeStep(0)}>Edit family details</button></div>
            <div className={styles.total}><span>Due today</span><strong>$0</strong><span>Monthly membership</span><strong>{estimate === null ? 'Check birthdays' : `${money(estimate)}/mo`}</strong></div>
            <p className={styles.small}>Starts on your first membership visit, including soft opening. Total is based on your children’s ages when billing begins.</p>
            {config ? <><div id="founding-card" className={styles.cardMount} />{!cardReady && <p role="status" className={styles.small}>Loading secure card form…</p>}</> : <p className={styles.notice}>Card registration is not available yet. No payment is due today.</p>}
            <details className={styles.terms}><summary>Membership terms & card authorization</summary><p>{terms}</p></details>
            <label className={styles.checkbox}><input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} /><span>I agree to the membership terms and authorize Square to save my card. Monthly billing starts on my first membership visit, including soft opening.</span></label>
          </fieldset>}
          {step < 2 ? <button className={styles.primary} type="submit" disabled={busy || !offer.can_enroll}>{step === 0 ? 'Continue to children' : 'Continue to card'}</button> : <button className={styles.primary} type="submit" disabled={busy || !cardReady || !consent || !birthdaysConfirmed || !offer.can_enroll}>{busy ? 'Saving your card…' : 'Save my card · $0 today'}</button>}
          {step > 0 && <button type="button" className={styles.textButton} disabled={busy} onClick={() => changeStep(step - 1)}>← Back</button>}
          <p className={styles.reassurance}>{step === 2 ? 'Card details go directly to Square.' : 'Your information stays linked to this family account.'}</p>
        </form>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <p className={styles.help}><Link href="/contact">Questions? We’re here to help.</Link></p>
      </section>
    </div>
    {step === 2 && config && !locked && !waitlistUnavailable && <Script src={config.environment === 'production' ? 'https://web.squarecdn.com/v1/square.js' : 'https://sandbox.web.squarecdn.com/v1/square.js'} strategy="afterInteractive" onReady={() => setSdkReady(true)} onError={() => setError('The secure Square card form could not load. Please refresh and try again.')} />}
  </main>;
}
