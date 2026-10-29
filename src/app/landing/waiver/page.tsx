'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WAIVER_VERSION, WAIVER_TITLE, WAIVER_PARAGRAPHS, WAIVER_AGREEMENTS, WAIVER_SIGNATURE_TEXT } from '@/lib/waiver-content';
import type { WaiverStatusDetails } from '@/lib/waivers';
import styles from './waiver.module.css';

type Child = { id: string; first_name: string; last_name: string | null; birthdate: string | null };
type Data = { children: Child[]; family_revision: string; can_sign: boolean; waiver: WaiverStatusDetails };

export default function WaiverPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [renew, setRenew] = useState(false);
  const [guardian, setGuardian] = useState(false);
  const [electronic, setElectronic] = useState(false);
  const [agreements, setAgreements] = useState<Record<string, boolean>>({});
  const [photo, setPhoto] = useState('');
  const [signature, setSignature] = useState('');

  async function load() {
    setError('');
    try {
      const response = await fetch('/api/waivers', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load your waiver.'); }
  }
  useEffect(() => { void load(); }, []);

  async function sign(event: React.FormEvent) {
    event.preventDefault();
    if (!data || saving) return;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/waivers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: WAIVER_VERSION, family_revision: data.family_revision, child_ids: data.children.map(child => child.id), signature, is_guardian: guardian, electronic_consent: electronic, photo_consent: photo === 'yes', agreements }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData({ ...data, waiver: result.waiver }); setRenew(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save your waiver.'); }
    finally { setSaving(false); }
  }

  return <main className={styles.main}>
    <Link href="/landing">← My dashboard</Link>
    <h1>Family waiver</h1>
    <p>A parent or legal guardian must complete this waiver for all participating children before entering Little Wanderers. Valid for 90 days, unless replaced by an updated waiver.</p>
    {error && <div role="alert" className={styles.error}>{error} {!data && <button onClick={() => void load()}>Try again</button>}</div>}
    {!data && !error && <p role="status">Loading your family…</p>}
    {data?.waiver.status === 'completed' && !renew ? <section className={styles.success}>
      <h2>Waiver completed</h2>
      <p>Your family waiver is saved. Expires {new Date(data.waiver.expiresAt!).toLocaleString('en-US', { timeZone: 'America/New_York' })} (Eastern).</p>
      <p><Link href="/landing">Back to my dashboard</Link></p>
      {data.can_sign && <button onClick={() => setRenew(true)}>Review and renew waiver</button>}
    </section> : data && <>
      <section className={styles.card}>
        <h2>Participating children</h2>
        {data.children.length ? <ul>{data.children.map(child => <li key={child.id}>{child.first_name} {child.last_name}{child.birthdate && ` · Born ${child.birthdate}`}</li>)}</ul> : <p>Add your children before signing.</p>}
        <Link href="/landing/people">Update My Info/People</Link>
      </section>
      {!data.can_sign ? <p>A parent or legal guardian with caregiver access must sign this waiver from their account.</p> : data.children.length > 0 && <form onSubmit={sign}>
        <section className={styles.card}>
          <h2>{WAIVER_TITLE}</h2>
          {WAIVER_PARAGRAPHS.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        </section>
        <section className={styles.card}>
          <h2>Required agreements</h2>
          <label className={styles.check}><input type="checkbox" required checked={guardian} onChange={event => setGuardian(event.target.checked)} />I am the parent or legal guardian of all children listed above.</label>
          {WAIVER_AGREEMENTS.map(item => <label key={item.id} className={styles.check}><input type="checkbox" required checked={agreements[item.id] ?? false} onChange={event => setAgreements({ ...agreements, [item.id]: event.target.checked })} />{item.text}</label>)}
        </section>
        <fieldset className={styles.card}>
          <legend>Photo/marketing preference</legend>
          <p>May Little Wanderers use photos or videos of your child for social media, website, or marketing purposes?</p>
          <label className={styles.check}><input type="radio" name="photo" required value="yes" checked={photo === 'yes'} onChange={() => setPhoto('yes')} />Yes, I give permission</label>
          <label className={styles.check}><input type="radio" name="photo" required value="no" checked={photo === 'no'} onChange={() => setPhoto('no')} />No, I do not give permission</label>
        </fieldset>
        <section className={styles.card}>
          <h2>Electronic signature</h2>
          <p>{WAIVER_SIGNATURE_TEXT}</p>
          <label htmlFor="signature">Your full legal name</label>
          <input className={styles.name} id="signature" autoComplete="name" required minLength={2} maxLength={150} value={signature} onChange={event => setSignature(event.target.value)} />
          <label className={styles.check}><input type="checkbox" required checked={electronic} onChange={event => setElectronic(event.target.checked)} />I agree to use this typed name as my electronic signature for this waiver.</label>
          <p>The date and time of signing will be recorded when you submit.</p>
          <button className={styles.submit} disabled={saving} type="submit">{saving ? 'Saving signed waiver…' : 'Sign and submit waiver'}</button>
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </section>
      </form>}
    </>}
  </main>;
}
