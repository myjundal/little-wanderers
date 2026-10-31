'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatBirthdateInput } from '@/lib/birthdate';
import { WAIVER_VERSION, WAIVER_TITLE, WAIVER_PARAGRAPHS, WAIVER_AGREEMENTS, WAIVER_SIGNATURE_TEXT } from '@/lib/waiver-content';
import type { GuestChild } from '@/lib/guest-waivers';
import styles from '@/app/landing/waiver/waiver.module.css';

type ChildDraft = { first_name: string; last_name: string; birthdate: string };
type Context = { verified: boolean; email?: string; children: GuestChild[]; family_revision: string; party_id?: string | null; party_date?: string | null; waiver_id?: string | null; existing_waiver?: { id: string; expires_at: string } | null };
const emptyChild = (): ChildDraft => ({ first_name: '', last_name: '', birthdate: '' });

export default function GuestWaiverForm() {
  const [context, setContext] = useState<Context | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [children, setChildren] = useState<ChildDraft[]>([]);
  const [guardian, setGuardian] = useState(false);
  const [electronic, setElectronic] = useState(false);
  const [agreements, setAgreements] = useState<Record<string, boolean>>({});
  const [photo, setPhoto] = useState('');
  const [signature, setSignature] = useState('');
  const [complete, setComplete] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [party, setParty] = useState('');
  const [renew, setRenew] = useState(false);

  async function refresh() {
    const r = await fetch('/api/guest-waivers', { cache: 'no-store' });
    const result = await r.json();
    if (!r.ok || !result.ok) throw new Error(result.error || 'Unable to load your waiver.');
    setContext(result);
    setComplete(Boolean(result.waiver_id));
    if (result.verified) { setEmail(result.email); if (!result.children.length) setChildren(previous => previous.length ? previous : [emptyChild()]); }
    return result;
  }
  useEffect(() => {
    setParty(new URLSearchParams(window.location.search).get('party') || '');
    void refresh().catch(cause => setError(cause.message));
  }, []);

  async function post(payload: Record<string, unknown>) {
    const r = await fetch('/api/guest-waivers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await r.json();
    if (!r.ok || !result.ok) throw new Error(result.error || 'Unable to continue. Please try again.');
    return result;
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!codeSent) {
        await post({ mode: 'request_code', email, party_id: party || null });
        setCodeSent(true); setNotice('We sent a six-digit code. Check your inbox and spam folder.');
      } else {
        await post({ mode: 'verify_code', code });
        const current = await refresh();
        // A shared iPad can retain the previous guest's session. A new party link
        // must be verified for that party rather than silently using the old one.
        if ((party || null) !== (current.party_id || null)) throw new Error('Please verify your email again using this party link.');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to verify your email.'); }
    finally { setBusy(false); }
  }
  async function sign(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !context?.verified) return;
    setBusy(true); setError('');
    try {
      const result = await post({ mode: 'sign', version: WAIVER_VERSION, family_revision: context.family_revision,
        first_name: firstName, last_name: lastName, phone, children, signature,
        is_guardian: guardian, electronic_consent: electronic, photo_consent: photo === 'yes', agreements });
      setComplete(true); setExpiresAt(result.expires_at); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save your waiver.'); }
    finally { setBusy(false); }
  }
  async function resetGuest() {
    // Clearing the cookie happens on the server; sensitive family details must
    // disappear from the shared-iPad UI before another guest starts.
    setContext({ verified: false, children: [], family_revision: '' });
    setComplete(false); setEmail(''); setCode(''); setCodeSent(false); setChildren([]);
    setFirstName(''); setLastName(''); setPhone(''); setSignature(''); setPhoto(''); setGuardian(false); setElectronic(false); setAgreements({}); setError(''); setNotice('');
    setRenew(false); setBusy(true);
    try { await post({ mode: 'end_session' }); }
    catch { setError('Please close this tab before the next guest starts.'); }
    finally { setBusy(false); }
  }
  async function applySavedWaiver() {
    setBusy(true); setError('');
    try { const result = await post({ mode: 'use_saved' }); setExpiresAt(result.expires_at); setComplete(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Please review your waiver.'); }
    finally { setBusy(false); }
  }

  const wrongParty = context?.verified && (party || null) !== (context.party_id || null);
  return <main className={styles.main}>
    <p className={styles.eyebrow}>LITTLE WANDERERS</p>
    <h1>Guest family waiver</h1>
    <p>Visiting for a party? A parent or legal guardian can sign here. <strong>No account or membership is needed.</strong></p>
    <p>We verify your email so your family’s waiver can be found on your next visit. This does not subscribe you to marketing.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!context && !error && <p role="status">Loading waiver…</p>}
    {wrongParty ? <section className={styles.card}><p>A previous guest session is open. Start again for this party.</p><button type="button" className={styles.submit} onClick={resetGuest}>Start this guest’s waiver</button></section>
    : complete ? <section className={styles.success}>
      <h2>Waiver saved</h2><p>Your family waiver is on file. Tell the front desk your name or email when you arrive.</p>
      {expiresAt && <p>Valid until {new Date(expiresAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} (Eastern).</p>}
      <p>If you create an account later with this verified email, we can connect these same family records.</p>
      <button type="button" className={styles.submit} onClick={resetGuest}>Done · clear this screen</button>
    </section> : context?.verified && context.existing_waiver && !renew ? <section className={styles.success}>
      <h2>Your family already has a valid waiver</h2>
      <p>Valid until {new Date(context.existing_waiver.expires_at).toLocaleString('en-US', { timeZone: 'America/New_York' })} (Eastern). You can use it again.</p>
      <ul>{context.children.map(child => <li key={child.id}>{child.first_name} {child.last_name}</li>)}</ul>
      <button type="button" className={styles.submit} disabled={busy} onClick={() => void applySavedWaiver()}>Use saved waiver{party ? ' for this party' : ''}</button>
      <p><button type="button" disabled={busy} onClick={() => setRenew(true)}>Add a child or review and renew</button></p>
    </section> : !context?.verified ? <section className={styles.card}>
      <h2>{codeSent ? 'Check your email' : 'Start with your email'}</h2>
      <form onSubmit={verify}>
        <label htmlFor="guest-email">Parent or legal guardian’s email</label>
        <input className={styles.name} id="guest-email" type="email" autoComplete="email" required maxLength={254} value={email} disabled={codeSent || busy} onChange={e => setEmail(e.target.value)} />
        {codeSent && <><label htmlFor="guest-code">Six-digit email code</label><input className={styles.name} id="guest-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></>}
        {notice && <p role="status">{notice}</p>}
        <button className={styles.submit} type="submit" disabled={busy}>{busy ? 'Please wait…' : codeSent ? 'Verify email and continue' : 'Email my waiver code'}</button>
        {codeSent && <p><button type="button" disabled={busy} onClick={() => { setCodeSent(false); setCode(''); setNotice(''); }}>Use another email or request a new code</button></p>}
      </form>
    </section> : <form onSubmit={sign}>
      <section className={styles.card}>
        <h2>Your family</h2><p>Email verified: {context.email}</p>
        {context.party_date && <p>Party: {new Date(context.party_date).toLocaleString('en-US', { timeZone: 'America/New_York' })} (Eastern)</p>}
        <div className={styles.fields}>
          <label>Guardian first name<input className={styles.name} autoComplete="given-name" required maxLength={100} value={firstName} onChange={e => setFirstName(e.target.value)} /></label>
          <label>Guardian last name<input className={styles.name} autoComplete="family-name" required maxLength={100} value={lastName} onChange={e => setLastName(e.target.value)} /></label>
        </div>
        <label>Phone number<input className={styles.name} type="tel" autoComplete="tel" required maxLength={40} value={phone} onChange={e => setPhone(e.target.value)} /></label>
        <h3>Children covered by this waiver</h3>
        {!!context.children.length && <><p>We found your family records. These children will keep their existing records.</p><ul>{context.children.map(child => <li key={child.id}>{child.first_name} {child.last_name} · Born {child.birthdate || 'birthday missing — please ask the front desk'}</li>)}</ul></>}
        {children.map((child, index) => <fieldset className={styles.child} key={index}>
          <legend>{context.children.length ? 'Additional child' : 'Child'} {index + 1}</legend>
          <label>Child first name<input className={styles.name} required maxLength={100} value={child.first_name} onChange={e => setChildren(previous => previous.map((c, i) => i === index ? { ...c, first_name: e.target.value } : c))} /></label>
          <label>Child last name<input className={styles.name} required maxLength={100} value={child.last_name} onChange={e => setChildren(previous => previous.map((c, i) => i === index ? { ...c, last_name: e.target.value } : c))} /></label>
          <label>Birthday (MM/DD/YYYY)<input className={styles.name} inputMode="numeric" required placeholder="MM/DD/YYYY" maxLength={10} value={child.birthdate} onChange={e => setChildren(previous => previous.map((c, i) => i === index ? { ...c, birthdate: formatBirthdateInput(e.target.value) } : c))} /></label>
          {(children.length > 1 || context.children.length > 0) && <button type="button" onClick={() => setChildren(previous => previous.filter((_, i) => i !== index))}>Remove additional child</button>}
        </fieldset>)}
        {children.length < 10 && <button type="button" onClick={() => setChildren(previous => [...previous, emptyChild()])}>Add another child</button>}
      </section>
      <section className={styles.card}><h2>{WAIVER_TITLE}</h2>{WAIVER_PARAGRAPHS.map(text => <p key={text}>{text}</p>)}</section>
      <section className={styles.card}>
        <h2>Required agreements</h2>
        <label className={styles.check}><input type="checkbox" required checked={guardian} onChange={e => setGuardian(e.target.checked)} />I am the parent or legal guardian of all children listed above.</label>
        {WAIVER_AGREEMENTS.map(item => <label className={styles.check} key={item.id}><input type="checkbox" required checked={agreements[item.id] ?? false} onChange={e => setAgreements({ ...agreements, [item.id]: e.target.checked })} />{item.text}</label>)}
      </section>
      <fieldset className={styles.card}><legend>Photo/marketing preference</legend><p>May Little Wanderers use photos or videos of your child for social media, website, or marketing purposes?</p>
        <label className={styles.check}><input type="radio" name="photo" required checked={photo === 'yes'} onChange={() => setPhoto('yes')} />Yes, I give permission</label>
        <label className={styles.check}><input type="radio" name="photo" required checked={photo === 'no'} onChange={() => setPhoto('no')} />No, I do not give permission</label>
      </fieldset>
      <section className={styles.card}><h2>Electronic signature</h2><p>{WAIVER_SIGNATURE_TEXT}</p>
        <label>Your full legal name<input className={styles.name} autoComplete="name" required minLength={2} maxLength={150} value={signature} onChange={e => setSignature(e.target.value)} /></label>
        <label className={styles.check}><input type="checkbox" required checked={electronic} onChange={e => setElectronic(e.target.checked)} />I agree to use this typed name as my electronic signature for this waiver.</label>
        <p>The date and time of signing will be recorded when you submit. Valid for 90 days unless replaced by an updated waiver.</p>
        <button className={styles.submit} type="submit" disabled={busy}>{busy ? 'Saving signed waiver…' : 'Sign and submit waiver'}</button>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </section>
    </form>}
    {!complete && <p>Already have an account? <Link href="/login?next=/landing/waiver">Sign in to your family waiver</Link>.</p>}
    {context?.verified && !complete && !wrongParty && <p><button type="button" disabled={busy} onClick={resetGuest}>Not your family? Clear this guest session</button></p>}
  </main>;
}
