'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { readFamilyDraft, validateGuestWaiver, type ChildDraft } from '@/lib/guest-waiver-form';
import { formatBirthdateInput } from '@/lib/birthdate';
import { WAIVER_VERSION, WAIVER_TITLE, WAIVER_PARAGRAPHS, WAIVER_AGREEMENTS, WAIVER_SIGNATURE_TEXT } from '@/lib/waiver-content';
import styles from '@/app/landing/waiver/waiver.module.css';

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
  const [saveDraft, setSaveDraft] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  const [validationAttempt, setValidationAttempt] = useState(0);
  const summary = useRef<HTMLDivElement>(null);
  const draftKey = useRef('');
  const draftExpires = useRef(0);
  const family = { email, firstName, lastName, phone, children };
  const issues = validationAttempt ? validateGuestWaiver({ ...family, guardian, electronic, agreements, photo, signature }) : [];
  const fieldProps = (id: string) => ({ id, 'aria-invalid': issues.some(issue => issue.id === id) || undefined,
    'aria-describedby': issues.some(issue => issue.id === id) ? `${id}-error` : undefined });
  const fieldError = (id: string) => {
    const issue = issues.find(item => item.id === id);
    return issue ? <span id={`${id}-error`} className={styles.fieldError}>{issue.message}</span> : null;
  };
  function clearDraft() {
    try { window.sessionStorage.removeItem(draftKey.current); } catch { /* Storage is optional. */ }
  }

  function remember(id: string) {
    try { window.sessionStorage.setItem(storageKey.current, JSON.stringify({ id, expires: Date.now() + 7200000 })); } catch { /* Signing works without browser storage. */ }
  }
  useEffect(() => {
    const partyId = new URLSearchParams(window.location.search).get('party') || '';
    setParty(partyId);
    storageKey.current = `lw_guest_waiver_submission:${partyId || 'general'}`;
    draftKey.current = `lw_guest_waiver_draft:${partyId || 'general'}`;
    let previous: { id?: string; expires?: number } | null = null;
    try { previous = JSON.parse(window.sessionStorage.getItem(storageKey.current) || 'null'); } catch { /* Storage is optional. */ }
    const restored = previous && typeof previous.id === 'string' && /^[0-9a-f-]{36}$/i.test(previous.id) && Number(previous.expires) > Date.now();
    const id = restored && previous?.id ? previous.id : crypto.randomUUID();
    submissionId.current = id;
    if (!restored) remember(id);
    draftExpires.current = restored ? Number(previous?.expires) : Date.now() + 7200000;
    try {
      const draft = readFamilyDraft(window.sessionStorage.getItem(draftKey.current), id);
      if (draft) {
        setEmail(draft.email); setFirstName(draft.firstName); setLastName(draft.lastName); setPhone(draft.phone); setChildren(draft.children); setSaveDraft(true);
        setDraftNotice('Your unfinished family details were restored. Please review the waiver and sign again below.');
      } else clearDraft();
    } catch { /* Signing works without browser storage. */ }

    setReady(true);
    let active = true;
    if (restored) void post({ mode: 'submission_status', submission_id: id, party_id: partyId || null }).then(result => {
      if (active && submissionId.current === id && result.completed) { clearDraft(); setComplete(true); setExpiresAt(result.expires_at); }
    }).catch(() => { /* A retry uses the same id and cannot create a duplicate waiver. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!saveDraft || complete) { clearDraft(); return; }
    try {
      window.sessionStorage.setItem(draftKey.current, JSON.stringify({ submissionId: submissionId.current, version: WAIVER_VERSION,
        expires: draftExpires.current, family: { email, firstName, lastName, phone, children } }));
    } catch { setDraftNotice('This browser could not save your unfinished details. Keep this tab open until you submit.'); }
  }, [ready, saveDraft, complete, email, firstName, lastName, phone, children]);
  useEffect(() => { if (validationAttempt) summary.current?.focus(); }, [validationAttempt]);

  async function sign(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || saving.current) return;
    if (validateGuestWaiver({ ...family, guardian, electronic, agreements, photo, signature }).length) {
      setValidationAttempt(value => value + 1); return;
    }
    saving.current = true; setBusy(true); setError('');
    try {
      const result = await post({ mode: 'submit', submission_id: submissionId.current, email, party_id: party || null, version: WAIVER_VERSION,
        first_name: firstName, last_name: lastName, phone, children, signature,
        is_guardian: guardian, electronic_consent: electronic, photo_consent: photo === 'yes' ? true : photo === 'no' ? false : null, agreements });
      clearDraft(); setSaveDraft(false); setComplete(true); setExpiresAt(result.expires_at); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save your waiver.'); }
    finally { saving.current = false; setBusy(false); }
  }
  async function resetGuest() {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    clearDraft(); setSaveDraft(false); setDraftNotice(''); setValidationAttempt(0);
    const previousId = submissionId.current;
    submissionId.current = crypto.randomUUID(); remember(submissionId.current);
    draftExpires.current = Date.now() + 7200000;
    setComplete(false); setExpiresAt(''); setEmail(''); setChildren([emptyChild()]);
    setFirstName(''); setLastName(''); setPhone(''); setSignature(''); setPhoto(''); setGuardian(false); setElectronic(false); setAgreements({}); setError('');
    try { await post({ mode: 'end_session', submission_id: previousId }); }
    catch { setError('Please close this tab before the next guest starts.'); }
    finally { saving.current = false; setBusy(false); }
  }

  return <main className={styles.main}>
    <p className={styles.eyebrow}>LITTLE WANDERERS</p>
    <h1>Family waiver</h1>
    <p>A parent or legal guardian can sign here. <strong>No account or membership is needed.</strong></p>
    {!complete && <>
      <p>One form for all your children: <strong>1. Family details → 2. Review &amp; agree → 3. Sign.</strong> This does not subscribe you to marketing.</p>
      <p className={styles.hint}>This form works for new and existing families. Already signed? <Link href="/login?next=/landing/waiver">Check your saved waiver</Link>.</p>
    </>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {complete ? <section className={styles.success}>
      <h2>Waiver saved</h2><p>Your family waiver is on file. Tell the front desk your name or email when you arrive.</p>
      {expiresAt && <p>Valid until {new Date(expiresAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} (Eastern).</p>}
      <button type="button" className={styles.submit} disabled={busy} onClick={() => void resetGuest()}>Done · clear this screen</button>
    </section> : <form onSubmit={sign} noValidate>
      {issues.length > 0 && <div ref={summary} tabIndex={-1} role="alert" className={styles.error}>
        <h2>Please check {issues.length} {issues.length === 1 ? 'item' : 'items'} below</h2>
        <p>Your waiver has not been submitted. Select an item to fix it.</p>
        <ul>{issues.map(issue => <li key={issue.id}><a href={`#${issue.id}`} onClick={event => { event.preventDefault(); document.getElementById(issue.id)?.focus(); }}>{issue.message}</a></li>)}</ul>
      </div>}
      <section className={styles.card}>
        <h2>1. Your family</h2>
        <label>Parent or legal guardian’s email<input className={styles.name} {...fieldProps("email")} type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} />{fieldError("email")}</label>
        <p>If you reserved Open Play, use the same email as your reservation.</p>
        <div className={styles.fields}>
          <label>Guardian first name<input className={styles.name} {...fieldProps("first-name")} autoComplete="given-name" required maxLength={100} value={firstName} onChange={e => setFirstName(e.target.value)} />{fieldError("first-name")}</label>
          <label>Guardian last name<input className={styles.name} {...fieldProps("last-name")} autoComplete="family-name" required maxLength={100} value={lastName} onChange={e => setLastName(e.target.value)} />{fieldError("last-name")}</label>
        </div>
        <label>Phone number<input className={styles.name} {...fieldProps("phone")} type="tel" autoComplete="tel" required maxLength={40} value={phone} onChange={e => setPhone(e.target.value)} />{fieldError("phone")}</label>
        <h3>Children covered by this waiver</h3>
        {children.map((child, index) => <fieldset className={styles.child} key={index}>
          <legend>Child {index + 1}</legend>
          <label>Child first name<input className={styles.name} required maxLength={100} {...fieldProps(`child-${index}-first`)} value={child.first_name} onChange={e => setChildren(previous => previous.map((c, i) => i === index ? { ...c, first_name: e.target.value } : c))} />{fieldError(`child-${index}-first`)}</label>
          <label>Child last name<input className={styles.name} required maxLength={100} {...fieldProps(`child-${index}-last`)} value={child.last_name} onChange={e => setChildren(previous => previous.map((c, i) => i === index ? { ...c, last_name: e.target.value } : c))} />{fieldError(`child-${index}-last`)}</label>
          <label>Birthday (MM/DD/YY or MM/DD/YYYY)<input className={styles.name} inputMode="numeric" required placeholder="MM/DD/YY or MM/DD/YYYY" maxLength={10} {...fieldProps(`child-${index}-birthday`)} value={child.birthdate} onChange={e => setChildren(previous => previous.map((c, i) => i === index ? { ...c, birthdate: formatBirthdateInput(e.target.value) } : c))} />{fieldError(`child-${index}-birthday`)}</label>
          {children.length > 1 && <button type="button" onClick={() => setChildren(previous => previous.filter((_, i) => i !== index))}>Remove child</button>}
        </fieldset>)}
        {children.length < 10 && <button type="button" onClick={() => setChildren(previous => [...previous, emptyChild()])}>Add another child</button>}
      <div className={styles.draftOptions}>
        <label className={styles.check}><input type="checkbox" checked={saveDraft} onChange={e => { setSaveDraft(e.target.checked); setDraftNotice(''); if (!e.target.checked) clearDraft(); }} />Remember unfinished family details in this tab for up to 2 hours.</label>
        <p className={styles.hint}>Use this only on your own device. Signature and agreement choices are never remembered. Uncheck to remove saved details.</p>
        {draftNotice && <p role="status">{draftNotice}</p>}
      </div>
      </section>
      <section className={styles.card}>
        <h2>2. Review &amp; agree</h2>
        <p>Please read the full waiver, then confirm each agreement below.</p>
        <details className={styles.legalText}><summary>Read the full waiver</summary><h3>{WAIVER_TITLE}</h3>{WAIVER_PARAGRAPHS.map(text => <p key={text}>{text}</p>)}</details>
      </section>
      <section className={styles.card}>
        <h2>Required agreements</h2><p className={styles.hint}>Check each statement after reviewing it. All are required.</p>
        <label className={styles.check}><input {...fieldProps("guardian")} type="checkbox" required checked={guardian} onChange={e => setGuardian(e.target.checked)} /><span>I am the parent or legal guardian of all children listed above.{fieldError("guardian")}</span></label>
        {WAIVER_AGREEMENTS.map(item => <label className={styles.check} key={item.id}><input {...fieldProps(`agreement-${item.id}`)} type="checkbox" required checked={agreements[item.id] ?? false} onChange={e => setAgreements({ ...agreements, [item.id]: e.target.checked })} /><span>{item.text}{fieldError(`agreement-${item.id}`)}</span></label>)}
      </section>
      <fieldset className={styles.card}><legend>Photo/marketing preference</legend><p>May Little Wanderers use photos or videos of your child for social media, website, or marketing purposes?</p>
        <label className={styles.check}><input {...fieldProps("photo")} type="radio" name="photo" required checked={photo === 'yes'} onChange={() => setPhoto('yes')} />Yes, I give permission</label>
        <label className={styles.check}><input type="radio" name="photo" required aria-describedby={issues.some(issue => issue.id === 'photo') ? 'photo-error' : undefined} checked={photo === 'no'} onChange={() => setPhoto('no')} />No, I do not give permission</label>{fieldError("photo")}
        <p className={styles.hint}>Either choice is welcome and does not affect admission.</p>
      </fieldset>
      <section className={styles.card}><h2>3. Electronic signature</h2><p>{WAIVER_SIGNATURE_TEXT}</p>
        <label>Your full legal name<input className={styles.name} {...fieldProps("signature")} autoComplete="name" required minLength={2} maxLength={150} value={signature} onChange={e => setSignature(e.target.value)} />{fieldError("signature")}</label>
        <label className={styles.check}><input {...fieldProps("electronic")} type="checkbox" required checked={electronic} onChange={e => setElectronic(e.target.checked)} /><span>I agree to use this typed name as my electronic signature for this waiver.{fieldError("electronic")}</span></label>
        <p>The date and time of signing will be recorded when you submit. Valid for 90 days unless replaced by an updated waiver.</p>
        <button className={styles.submit} type="submit" disabled={busy || !ready}>{busy ? 'Saving signed waiver…' : 'Sign and submit waiver'}</button>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </section>
    </form>}
  </main>;
}
