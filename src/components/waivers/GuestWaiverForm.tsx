'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatBirthdateInput } from '@/lib/birthdate';
import { WAIVER_VERSION, WAIVER_TITLE, WAIVER_PARAGRAPHS, WAIVER_AGREEMENTS, WAIVER_SIGNATURE_TEXT } from '@/lib/waiver-content';
import styles from '@/app/landing/waiver/waiver.module.css';

type ChildDraft = { first_name: string; last_name: string; birthdate: string };
const emptyChild = (): ChildDraft => ({ first_name: '', last_name: '', birthdate: '' });
async function post(payload: Record<string, unknown>) {
  const response = await fetch('/api/guest-waivers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to continue. Please try again.');
  return result;
}

export default function GuestWaiverForm() {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [children, setChildren] = useState<ChildDraft[]>([emptyChild()]);
  const [guardian, setGuardian] = useState(false);
  const [electronic, setElectronic] = useState(false);
  const [agreements, setAgreements] = useState<Record<string, boolean>>({});
  const [photo, setPhoto] = useState('');
  const [signature, setSignature] = useState('');
  const [complete, setComplete] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [party, setParty] = useState('');
  const submissionId = useRef('');
  const storageKey = useRef('');
  const saving = useRef(false);

  function remember(id: string) {
    try { window.sessionStorage.setItem(storageKey.current, JSON.stringify({ id, expires: Date.now() + 7200000 })); } catch { /* Signing works without browser storage. */ }
  }
  useEffect(() => {
    const partyId = new URLSearchParams(window.location.search).get('party') || '';
    setParty(partyId);
    storageKey.current = `lw_guest_waiver_submission:${partyId || 'general'}`;
    let previous: { id?: string; expires?: number } | null = null;
    try { previous = JSON.parse(window.sessionStorage.getItem(storageKey.current) || 'null'); } catch { /* Storage is optional. */ }
    const restored = previous && typeof previous.id === 'string' && /^[0-9a-f-]{36}$/i.test(previous.id) && Number(previous.expires) > Date.now();
    const id = restored && previous?.id ? previous.id : crypto.randomUUID();
    submissionId.current = id;
    if (!restored) remember(id);
    setReady(true);
    let active = true;
    if (restored) void post({ mode: 'submission_status', submission_id: id, party_id: partyId || null }).then(result => {
      if (active && submissionId.current === id && result.completed) { setComplete(true); setExpiresAt(result.expires_at); }
    }).catch(() => { /* A retry uses the same id and cannot create a duplicate waiver. */ });
    return () => { active = false; };
  }, []);

  async function sign(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const result = await post({ mode: 'submit', submission_id: submissionId.current, email, party_id: party || null, version: WAIVER_VERSION,
        first_name: firstName, last_name: lastName, phone, children, signature,
        is_guardian: guardian, electronic_consent: electronic, photo_consent: photo === 'yes' ? true : photo === 'no' ? false : null, agreements });
      setComplete(true); setExpiresAt(result.expires_at); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save your waiver.'); }
    finally { saving.current = false; setBusy(false); }
  }
  async function resetGuest() {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    const previousId = submissionId.current;
    submissionId.current = crypto.randomUUID(); remember(submissionId.current);
    setComplete(false); setExpiresAt(''); setEmail(''); setChildren([emptyChild()]);
    setFirstName(''); setLastName(''); setPhone(''); setSignature(''); setPhoto(''); setGuardian(false); setElectronic(false); setAgreements({}); setError('');
    try { await post({ mode: 'end_session', submission_id: previousId }); }
    catch { setError('Please close this tab before the next guest starts.'); }
    finally { saving.current = false; setBusy(false); }
  }

  return <main className={styles.main}>
    <p className={styles.eyebrow}>LITTLE WANDERERS</p>
    <h1>Guest family waiver</h1>
    <p>A parent or legal guardian can sign here. <strong>No account or membership is needed.</strong></p>
    <p>Enter your family’s details, review the waiver, and sign below. This does not subscribe you to marketing.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {complete ? <section className={styles.success}>
      <h2>Waiver saved</h2><p>Your family waiver is on file. Tell the front desk your name or email when you arrive.</p>
      {expiresAt && <p>Valid until {new Date(expiresAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} (Eastern).</p>}
      <button type="button" className={styles.submit} disabled={busy} onClick={() => void resetGuest()}>Done · clear this screen</button>
    </section> : <form onSubmit={sign}>
      <section className={styles.card}>
        <h2>Your family</h2>
        <label>Parent or legal guardian’s email<input className={styles.name} type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
        <div className={styles.fields}>
          <label>Guardian first name<input className={styles.name} autoComplete="given-name" required maxLength={100} value={firstName} onChange={e => setFirstName(e.target.value)} /></label>
          <label>Guardian last name<input className={styles.name} autoComplete="family-name" required maxLength={100} value={lastName} onChange={e => setLastName(e.target.value)} /></label>
        </div>
        <label>Phone number<input className={styles.name} type="tel" autoComplete="tel" required maxLength={40} value={phone} onChange={e => setPhone(e.target.value)} /></label>
        <h3>Children covered by this waiver</h3>
        {children.map((child, index) => <fieldset className={styles.child} key={index}>
          <legend>Child {index + 1}</legend>
          <label>Child first name<input className={styles.name} required maxLength={100} value={child.first_name} onChange={e => setChildren(previous => previous.map((c, i) => i === index ? { ...c, first_name: e.target.value } : c))} /></label>
          <label>Child last name<input className={styles.name} required maxLength={100} value={child.last_name} onChange={e => setChildren(previous => previous.map((c, i) => i === index ? { ...c, last_name: e.target.value } : c))} /></label>
          <label>Birthday (MM/DD/YYYY)<input className={styles.name} inputMode="numeric" required placeholder="MM/DD/YYYY" maxLength={10} value={child.birthdate} onChange={e => setChildren(previous => previous.map((c, i) => i === index ? { ...c, birthdate: formatBirthdateInput(e.target.value) } : c))} /></label>
          {children.length > 1 && <button type="button" onClick={() => setChildren(previous => previous.filter((_, i) => i !== index))}>Remove child</button>}
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
        <button className={styles.submit} type="submit" disabled={busy || !ready}>{busy ? 'Saving signed waiver…' : 'Sign and submit waiver'}</button>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </section>
    </form>}
    {!complete && <><p>Already have an account? <Link href="/login?next=/landing/waiver">Sign in to your family waiver</Link>.</p>
      <p><button type="button" disabled={busy || !ready} onClick={() => void resetGuest()}>Start a new waiver · clear this screen</button></p></>}
  </main>;
}
