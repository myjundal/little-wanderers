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

export default function FoundingMembership() {
  const [auth, setAuth] = useState<'loading' | 'guest' | 'signedIn' | 'error'>('loading');
  const [profile, setProfile] = useState<Profile>(emptyProfile);
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
  const cardRef = useRef<Card | null>(null);
  const submitting = useRef(false);
  const locked = enrollment && !['draft', 'saving_card'].includes(enrollment.status);

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
      setEnrollment(data.enrollment); setConfig(data.config); setAuth('signedIn');
    }).catch(() => { if (active) { setAuth('error'); setError('We could not load your family account. Please refresh to try again.'); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!sdkReady || !config || locked) return;
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
  }, [sdkReady, config, locked]);

  const patch = (key: keyof Omit<Profile, 'children'>, value: string) => setProfile(current => ({ ...current, [key]: value }));
  const patchChild = (id: string, next: Partial<Child>) => { setProfile(current => ({ ...current, children: current.children.map(child => child.id === id ? { ...child, ...next } : child) })); setBirthdaysConfirmed(false); };
  const tier = enrollment && enrollment.status !== 'canceled' ? enrollment.pricing_tier : offer.tier;
  const price = MEMBERSHIP_PRICES[tier];
  const founding = tier !== 'regular';
  const terms = membershipTerms(tier);
  let estimate: number | null = null;
  try { estimate = foundingMonthlyCents(profile.children.map(child => parseBirthdate(child.birthdate) || ''), easternDate(), tier); } catch { /* Show a total once the dates are complete. */ }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !cardRef.current || !consent || !birthdaysConfirmed || !offer.can_enroll) return;
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
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>{founding ? price.label : 'Monthly membership'}</span>
        <h1>Little moments.<br /><em>{founding ? 'Founding families.' : 'More days to play.'}</em></h1>
        <p>A familiar place to play, grow, and come back to. Make Little Wanderers part of your everyday.</p>
        <a className={styles.primary} href="#join">{founding ? 'Become a founding member' : 'Join our membership'} <span aria-hidden="true">↗</span></a>
        <span className={styles.small}>Save your card today. Pay $0 today.</span>
      </div>
      <div className={styles.priceCard}>
        <span className={styles.eyebrow}>{price.label}</span>
        <div className={styles.price}>{money(price.base_cents)}<span>/mo</span></div>
        {founding && <p className={styles.regular}>Regularly <s>$60/month</s></p>}
        <p className={styles.rateNote}>{founding ? <>Both rates locked in for life,<br />while your membership stays active.</> : 'Regular monthly pricing.'}</p>
        <div className={styles.priceDivider} />
        <p><strong>+{money(price.sibling_cents)}/mo</strong> for each sibling 6 months or older</p>
        <p className={styles.small}>Baby siblings under 6 months: no additional charge.</p>
        {founding && <p className={styles.small}>Two children (sibling 6mo+): {money(price.base_cents + price.sibling_cents)}/mo · {price.two_child_discount}% off the regular $80/mo.</p>}<div className={styles.badge}>Cancel anytime · No commitment</div>
      </div>
    </section>

    <section className={styles.benefits} aria-label="Membership includes">
      <article><span aria-hidden="true">✳</span><h2>More days to play</h2><p>Unlimited open play during regular open play hours, with up to two accompanying adults.</p></article>
      <article><span aria-hidden="true">♡</span><h2>Be here from the start</h2><p>A free visit during our soft opening period. Reservations, capacity limits, and a signed waiver apply.</p></article>
      <article><span aria-hidden="true">↗</span><h2>A little head start</h2><p>Priority registration for select classes and special events.</p></article>
    </section>

    <section className={styles.timing}><div><span className={styles.eyebrow}>Here’s how it works</span><h2>Join now. Your first payment can wait.</h2></div><ol><li><strong>Set up your family.</strong> Sign in or create an account, then confirm your contact and child information.</li><li><strong>Save your card with Square.</strong> There is no membership charge today.</li><li><strong>Start with us.</strong> Monthly billing begins on our announced soft opening date. The date is still to be determined.</li></ol></section>

    <section id="join" className={styles.join}>
      <div className={styles.joinIntro}><span className={styles.eyebrow}>Let’s get your family ready</span><h2>Your place in<br />{' '}<em>the beginning.</em></h2><p>{founding ? `Your ${money(price.base_cents)} first-child and ${money(price.sibling_cents)} sibling rates are locked in for the lifetime of your active membership.` : 'Regular membership is $60/month for the first child and $20/month per eligible sibling.'} Cancel anytime, with no commitment. If you cancel and rejoin, regular $60 + $20 pricing applies.</p><p>When a baby sibling turns 6 months, {money(price.sibling_cents)} sibling pricing begins with the following billing cycle.</p><p className={styles.small}>Questions? <a href="/contact">We’re here to help.</a></p></div>
      <div className={styles.formCard}>
        {auth === 'loading' && <p role="status">Loading your family account…</p>}
        {auth === 'guest' && <div className={styles.guest}><h3>{offer.phase === 'waitlist' ? 'Wanderlist families go first.' : founding ? 'Welcome, founding family.' : 'Welcome to Little Wanderers.'}</h3><p>Use your existing Little Wanderers account, or create one to get started. We confirm your offer from your account; Wanderlist pricing is reserved for original Wanderlist families. We’ll ask for your children’s details before you save your card.</p><Link className={styles.primary} href="/login?mode=existing&next=%2Ffounding-membership">Sign in to my account</Link><Link className={styles.secondary} href="/login?mode=new&next=%2Ffounding-membership">Create a family account</Link><p className={styles.small}>No payment today. Opening date to be announced.</p></div>}
        {auth === 'signedIn' && locked && <div id="founding-status" tabIndex={-1} className={styles.status}>
          <span className={styles.eyebrow}>{enrollment.status === 'canceled' ? 'Membership canceled' : price.label}</span>
          <h3>{enrollment.status === 'canceled' ? 'Your cancellation is confirmed.' : enrollment.status === 'pending' ? 'You’re in. We can’t wait to meet you.' : 'Your founding membership'}</h3>
          {enrollment.status !== 'canceled' && <><p>Card saved: {enrollment.card_brand} ending in {enrollment.card_last4}.</p><p>{enrollment.start_date ? `Monthly billing starts ${enrollment.start_date}.` : 'No payment has been taken for your reservation. Your first monthly payment begins on our announced soft opening date, which is not set yet.'}</p><p><strong>{money(enrollment.base_cents)}/month</strong> for the first child + {money(enrollment.sibling_cents)}/month per sibling age 6 months or older.{enrollment.pricing_tier !== 'regular' && ' Both rates stay locked in while your membership stays active.'}</p><p>Your free soft opening visit is included. <Link href="/landing/soft-opening">Reserve a visit</Link> when times become available.</p></>}
          {enrollment.status === 'canceled' && <p>Your founding rates have ended. Rejoining is $60/month for the first child + $20/month per eligible sibling.{enrollment.paid_through ? ` Any paid access continues through ${enrollment.paid_through}.` : ' No further monthly billing is scheduled.'}</p>}
          {enrollment.status === 'canceled' && <button type="button" className={styles.primary} onClick={() => { setEnrollment(null); setConsent(false); setBirthdaysConfirmed(false); }}>Rejoin at regular $60 + $20 pricing</button>}
          <Link className={styles.secondary} href="/landing">Go to my family dashboard</Link>
          {enrollment.status !== 'canceled' && <>{!cancelConfirm ? <button type="button" className={styles.textButton} onClick={() => setCancelConfirm(true)}>Cancel my membership</button> : <div className={styles.cancelBox}><p>Cancel anytime. Canceling ends your founding rates. Rejoining is $60/month + $20/month per eligible sibling. Future renewals stop.</p><button type="button" className={styles.secondary} disabled={busy} onClick={cancel}>{busy ? 'Canceling…' : 'Confirm cancellation'}</button><button className={styles.textButton} type="button" disabled={busy} onClick={() => setCancelConfirm(false)}>Keep my membership</button></div>}</>}
        </div>}
        {auth === 'signedIn' && !locked && <form onSubmit={submit}>
          <h3>Confirm your family details</h3><p className={styles.small}>All fields are required unless marked optional. Your existing family details are filled in below.</p>
          <fieldset disabled={busy}><legend>Parent or caregiver</legend><div className={styles.grid}>
            <label htmlFor="founding-first">First name<input id="founding-first" autoComplete="given-name" maxLength={80} required value={profile.adultFirstName} onChange={e => patch('adultFirstName', e.target.value)} /></label>
            <label htmlFor="founding-last">Last name<input id="founding-last" autoComplete="family-name" maxLength={80} required value={profile.adultLastName} onChange={e => patch('adultLastName', e.target.value)} /></label>
            <label htmlFor="founding-gender">Gender<GenderSelect id="founding-gender" value={profile.adultGender} onChange={value => patch('adultGender', value)} /></label>
            <label htmlFor="founding-email">Account email<input id="founding-email" type="email" autoComplete="email" required value={profile.email} readOnly /></label>
            <label htmlFor="founding-phone">US phone number<input id="founding-phone" type="tel" autoComplete="tel" placeholder="(860) 555-0123" required value={profile.phone} onChange={e => patch('phone', e.target.value)} /></label>
            <label htmlFor="founding-city">City or town<input id="founding-city" autoComplete="address-level2" required maxLength={100} value={profile.city} onChange={e => patch('city', e.target.value)} /></label>
            <label htmlFor="founding-state">State (two letters)<input id="founding-state" autoComplete="address-level1" required pattern="[A-Z]{2}" maxLength={2} value={profile.state} onChange={e => patch('state', e.target.value.toUpperCase())} /></label>
          </div></fieldset>
          <fieldset disabled={busy}><legend>Your children</legend><p className={styles.small}>Include every child who will be part of your family membership. Please confirm actual birthdays, including any previously entered as approximate ages.</p>
            {profile.children.map((child, index) => <div key={child.id} className={styles.child}><div className={styles.childHeading}><strong>Child {index + 1}</strong>{!child.existing && profile.children.length > 1 && <button type="button" className={styles.textButton} onClick={() => { setProfile(p => ({ ...p, children: p.children.filter(c => c.id !== child.id) })); setBirthdaysConfirmed(false); }}>Remove</button>}</div><div className={styles.grid}>
              <label htmlFor={`first-${child.id}`}>First name<input id={`first-${child.id}`} required maxLength={80} value={child.firstName} onChange={e => patchChild(child.id, { firstName: e.target.value })} /></label>
              <label htmlFor={`last-${child.id}`}>Last name (optional)<input id={`last-${child.id}`} maxLength={80} value={child.lastName} onChange={e => patchChild(child.id, { lastName: e.target.value })} /></label>
              <label htmlFor={`gender-${child.id}`}>Gender<GenderSelect id={`gender-${child.id}`} value={child.gender} onChange={value => patchChild(child.id, { gender: value })} /></label>
              <label htmlFor={`birth-${child.id}`}>Birthday (MM/DD/YYYY)<input id={`birth-${child.id}`} required inputMode="numeric" placeholder="03/15/2023" maxLength={10} value={child.birthdate} onChange={e => patchChild(child.id, { birthdate: formatBirthdateInput(e.target.value) })} /></label>
            </div></div>)}
            <button type="button" className={styles.secondary} disabled={profile.children.length >= 20} onClick={() => { setProfile(p => ({ ...p, children: [...p.children, blankChild()] })); setBirthdaysConfirmed(false); }}>+ Add a sibling</button>
            <label className={styles.checkbox}><input type="checkbox" required checked={birthdaysConfirmed} onChange={e => setBirthdaysConfirmed(e.target.checked)} /><span>I confirm every child’s name and actual birthday are correct.</span></label>
          </fieldset>
          <div className={styles.total}><span>Due today</span><strong>$0</strong><span>Monthly total at today’s ages</span><strong>{estimate === null ? 'Add birthdays' : `${money(estimate)}/mo`}</strong></div>
          <p className={styles.small}>Your first monthly total is based on your children’s ages when billing begins. {money(price.base_cents)} base rate + {money(price.sibling_cents)} for each eligible sibling.</p>
          <fieldset disabled={busy}><legend>Save your card securely</legend>
            {config ? <><div id="founding-card" className={styles.cardMount} />{!cardReady && <p className={styles.small}>Loading secure card form…</p>}</> : <p className={styles.notice}>{offer.can_enroll ? 'Card registration will be available soon. No payment is due today.' : 'Wanderlist families have first access. Public founding membership will open next.'}</p>}
            <details className={styles.terms}><summary>Monthly membership & card authorization</summary><p>{terms}</p></details>
            <label className={styles.checkbox}><input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} /><span>I authorize Square to save my card and monthly billing to begin on the announced soft opening date. I agree to the membership terms above, including sibling pricing and cancellation.</span></label>
            <button className={styles.primary} type="submit" disabled={busy || !cardReady || !consent || !birthdaysConfirmed || !offer.can_enroll}>{busy ? 'Saving your card…' : 'Save my card · $0 today'}</button>
            <p className={styles.small}>Card details go directly to Square. Your opening date is not yet set.</p>
          </fieldset>
        </form>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </div>
    </section>
    {config && !locked && <Script src={config.environment === 'production' ? 'https://web.squarecdn.com/v1/square.js' : 'https://sandbox.web.squarecdn.com/v1/square.js'} strategy="afterInteractive" onReady={() => setSdkReady(true)} onError={() => setError('The secure Square card form could not load. Please refresh and try again.')} />}
  </main>;
}
