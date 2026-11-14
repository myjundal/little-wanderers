'use client';
import { useEffect, useRef, useState } from 'react';
import styles from './admission-help.module.css';

type Person = { id: string; first_name: string | null; last_name: string | null; role: string; birthdate: string | null };
type Family = { id: string; name: string | null; people: Person[] };
type Receipt = { order_id: string; admission_cents: number; total_cents: number; paid_at: string; receipt_number: string; card_last_four: string; items: string };
type Waiver = { id: string; guardian: string; email: string; phone: string; signed_at: string; children: Person[] };
type ReviewCase = { id: string; household_id: string; family_name: string; visit_date: string; category: string; note: string; created_at: string };
const money = (value: number) => `$${(value / 100).toFixed(2)}`;
const name = (person: Person) => [person.first_name, person.last_name].filter(Boolean).join(' ');
const time = (value: string) => new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function AdmissionHelp({ family, date, disabled, onUpdated, onOpenFamily, endpoint = '/api/admin/admission/help' }: {
  family: Family | null; date: string; disabled: boolean; onUpdated: () => void; onOpenFamily: (id: string) => void; endpoint?: string;
}) {
  const [tab, setTab] = useState<'payment' | 'waiver' | 'other'>('payment');
  const [query, setQuery] = useState('');
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [receiptId, setReceiptId] = useState('');
  const [waivers, setWaivers] = useState<Waiver[]>([]);
  const [waiverId, setWaiverId] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const [caseNote, setCaseNote] = useState('');
  const [cases, setCases] = useState<ReviewCase[]>([]);
  const [caseError, setCaseError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const actionBusy = useRef(false), generation = useRef(0), caseRequest = useRef<string | null>(null);
  const waiver = waivers.find(row => row.id === waiverId), receipt = receipts.find(row => row.order_id === receiptId);
  const children = family?.people.filter(person => person.role === 'child') ?? [];
  const locked = disabled || busy;

  async function refreshCases() {
    try {
      const response = await fetch(endpoint, { cache: 'no-store' }), result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to load issues.');
      setCases(result.cases ?? []); setTruncated(result.truncated === true); setCaseError('');
    } catch (error) { setCaseError(error instanceof Error ? error.message : 'Unable to load issues.'); }
  }
  useEffect(() => { void refreshCases(); }, [endpoint]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    generation.current++; setQuery(''); setReceipts([]); setReceiptId(''); setWaivers([]); setWaiverId('');
    setMapping({}); setConfirmed(false); setReason(''); setCaseNote(''); setMessage(''); caseRequest.current = null;
  }, [family?.id, date]);

  async function request(body: Record<string, unknown>) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to save. Please retry.');
    return result;
  }
  async function perform(action: () => Promise<void>) {
    if (actionBusy.current || disabled) return;
    const current = generation.current;
    actionBusy.current = true; setBusy(true); setMessage(''); setFailed(false);
    try { await action(); }
    catch (error) { if (current === generation.current) { setFailed(true); setMessage(error instanceof Error ? error.message : 'Unable to complete this action.'); } }
    finally { actionBusy.current = false; setBusy(false); }
  }
  async function search() {
    if (!family) return;
    const current = generation.current;
    await perform(async () => {
      const result = await request({ mode: tab === 'payment' ? 'search_receipts' : 'search_waivers', household_id: family.id, date, query });
      if (current !== generation.current) return;
      setReceiptId(''); setWaiverId(''); setConfirmed(false); setMapping({});
      if (tab === 'payment') { setReceipts(result.receipts); setMessage(result.receipts.length ? 'Select the receipt you checked in Square.' : 'No matching available receipt. Check the date and receipt number, or save for owner review.'); }
      else { setWaivers(result.waivers); setMessage(result.waivers.length ? 'Compare the signed guardian and every child with the parent present.' : 'No current matching guest waiver. Confirm the spelling/contact with the guardian or ask them to complete a new waiver.'); }
    });
  }
  function chooseWaiver(id: string) {
    setWaiverId(id); setConfirmed(false);
    const selected = waivers.find(row => row.id === id), guesses: Record<string, string> = {};
    for (const child of selected?.children ?? []) {
      const matches = children.filter(person => person.first_name?.trim().toLowerCase() === child.first_name?.trim().toLowerCase());
      if (matches.length === 1) guesses[child.id] = matches[0].id;
    }
    setMapping(guesses);
  }
  async function link() {
    if (!family || !confirmed) return;
    const current = generation.current;
    await perform(async () => {
      if (tab === 'payment') await request({ mode: 'link_receipt', household_id: family.id, date, order_id: receiptId, confirmed: true });
      else await request({ mode: 'link_waiver', household_id: family.id, date, waiver_id: waiverId, reason, guardian_confirmed: true,
        mapping: waiver?.children.map(child => ({ source_id: child.id, target_id: mapping[child.id] })) });
      if (current !== generation.current) return;
      setMessage(tab === 'payment' ? 'Receipt verified and linked. Admission is paid; do not charge again.' : 'Signed waiver connected. Recheck the family above and continue check-in.');
      setReceipts([]); setWaivers([]); setReceiptId(''); setWaiverId(''); setConfirmed(false);
      onUpdated(); await refreshCases();
    });
  }
  async function saveCase() {
    if (!family) return;
    const current = generation.current;
    await perform(async () => {
      caseRequest.current ??= crypto.randomUUID();
      await request({ mode: 'create_case', household_id: family.id, date, category: tab, note: caseNote, request_id: caseRequest.current });
      if (current !== generation.current) return;
      setMessage('Saved for owner review. This note does not mark payment received or waive the family waiver.');
      setCaseNote(''); caseRequest.current = null; await refreshCases();
    });
  }

  return <section id="admission-help" className={styles.panel} aria-label="Staff admission help">
    <div className={styles.heading}><div><h2>Need help with this family?</h2><p>Already paid in Square, or signed a waiver under a different name? Resolve it here.</p></div></div>
    {family ? <>
      <p><strong>{family.name || 'Selected family'}</strong> · Visit date {date} (Eastern)</p>
      <div className={styles.tabs} role="group" aria-label="Admission help type">
        {(['payment', 'waiver', 'other'] as const).map(value => <button key={value} type="button" aria-pressed={tab === value} disabled={locked} onClick={() => {
          setTab(value); setQuery(''); setConfirmed(false); setMessage(''); caseRequest.current = null;
        }}>{value === 'payment' ? 'Already paid in Square' : value === 'waiver' ? 'Find signed waiver' : 'Other issue'}</button>)}
      </div>
      {tab !== 'other' && <>
        <p>{tab === 'payment' ? 'Check Transactions in Square first. Enter its receipt number, receipt link or card last four digits. This only connects an existing completed payment.' : 'Ask the guardian for the name, email or phone used when signing. Keep the guardian present while comparing the children.'}</p>
        <label className={styles.field}>{tab === 'payment' ? 'Square receipt / card last four' : 'Guardian name, email or phone'}
          <input value={query} maxLength={200} disabled={locked} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && query.trim().length >= 3) void search(); }} />
        </label>
        <button type="button" disabled={locked || query.trim().length < 3} onClick={() => void search()}>{busy ? 'Checking…' : tab === 'payment' ? 'Find completed receipt' : 'Find signed waiver'}</button>
      </>}
      {tab === 'payment' && receipts.map(row => <label key={row.order_id} className={styles.choice}>
        <input type="radio" name="help-receipt" disabled={locked} checked={receiptId === row.order_id} onChange={() => { setReceiptId(row.order_id); setConfirmed(false); }} />
        <span><strong>{money(row.admission_cents)} admission</strong> · Receipt total {money(row.total_cents)}<br />{time(row.paid_at)} · {row.card_last_four}<br />Receipt {row.receipt_number || row.order_id}<br />{row.items}</span>
      </label>)}
      {tab === 'waiver' && waivers.map(row => <label key={row.id} className={styles.choice}>
        <input type="radio" name="help-waiver" disabled={locked} checked={waiverId === row.id} onChange={() => chooseWaiver(row.id)} />
        <span><strong>{row.guardian}</strong> · Signed {time(row.signed_at)}<br />{row.email} · {row.phone}<br />{row.children.map(child => `${name(child)} (${child.birthdate})`).join(' · ')}</span>
      </label>)}
      {tab === 'waiver' && waiver && <div className={styles.review}>
        <h3>Match each signed child</h3>
        <p>Compare names and birthdays with the guardian. Existing family birthdays stay unchanged; blank birthdays are completed from the signature.</p>
        {waiver.children.map(child => {
          const target = children.find(person => person.id === mapping[child.id]);
          return <div key={child.id} className={styles.child}>
            <label className={styles.field}>Signed: {name(child)} · {child.birthdate}<select value={mapping[child.id] || ''} disabled={locked} onChange={event => { setMapping(previous => ({ ...previous, [child.id]: event.target.value })); setConfirmed(false); }}>
              <option value="">Choose this child in the family</option>{children.map(person => <option key={person.id} value={person.id}>{name(person)} · {person.birthdate || 'Birthday missing'}</option>)}
            </select></label>
            {target?.birthdate && target.birthdate !== child.birthdate && <p className={styles.warning}>Birthdays differ. Confirm this is the same child and the existing family birthday is correct. Describe the entry mistake below. If uncertain, save for owner review and have the guardian complete a corrected waiver.</p>}
          </div>;
        })}
        <label className={styles.field}>Why the records did not match / what the guardian confirmed<textarea value={reason} maxLength={1000} disabled={locked} onChange={event => setReason(event.target.value)} /></label>
      </div>}
      {((tab === 'payment' && receipt) || (tab === 'waiver' && waiver)) && <div className={styles.review}>
        <label className={styles.confirm}><input type="checkbox" checked={confirmed} disabled={locked} onChange={event => setConfirmed(event.target.checked)} />
          <span>{tab === 'payment' ? `I checked this receipt in Square and confirm it is this family’s ${money(receipt!.admission_cents)} admission payment.` : 'The guardian confirms this is their signature, every matched child is the same child, and the existing family birthdays are correct.'}</span></label>
        <button type="button" className={styles.primary} disabled={locked || !confirmed || (tab === 'waiver' && (reason.trim().length < 10 || waiver!.children.length !== children.length || waiver!.children.some(child => !mapping[child.id]) || new Set(Object.values(mapping)).size !== children.length))} onClick={() => void link()}>
          {tab === 'payment' ? 'Connect receipt — mark admission paid' : 'Connect signed waiver'}
        </button>
      </div>}
      <details className={styles.followup} open={tab === 'other'}><summary>Still unsure? Save for owner review</summary>
        <p>Record what happened and what you checked. Do not enter card numbers or security codes. A note does not complete payment or replace a signed waiver.</p>
        <label className={styles.field}>Issue and steps already taken<textarea value={caseNote} maxLength={1500} disabled={locked} onChange={event => { setCaseNote(event.target.value); caseRequest.current = null; }} /></label>
        <button type="button" disabled={locked || caseNote.trim().length < 5} onClick={() => void saveCase()}>Save for owner review</button>
      </details>
    </> : <p>Open a family above to find a receipt, connect a signed waiver or leave a review note.</p>}
    {message && <p role={failed ? 'alert' : 'status'} className={failed ? styles.errorMessage : styles.message}>{message}</p>}
    <details className={styles.queue} open={cases.length > 0}><summary>Needs review · {cases.length}{truncated ? '+' : ''}</summary>
      <p>Open issues stay here across days until resolved. Staff and the owner can see this list.</p>
      <button type="button" disabled={locked} onClick={() => void refreshCases()}>Refresh issues</button>
      {caseError && <p role="alert">{caseError}</p>}
      {!caseError && !cases.length && <p>No open issues.</p>}
      {cases.map(row => <article key={row.id} className={styles.case}>
        <h3>{row.family_name} · {row.category}</h3><p>Visit {row.visit_date} · Saved {time(row.created_at)}</p><p className={styles.note}>{row.note}</p>
        <button type="button" disabled={locked} onClick={() => onOpenFamily(row.household_id)}>Open family</button>
        <label className={styles.field}>How was this resolved?<input value={resolutions[row.id] || ''} maxLength={1500} disabled={locked} onChange={event => setResolutions(previous => ({ ...previous, [row.id]: event.target.value }))} /></label>
        <button type="button" disabled={locked || (resolutions[row.id] || '').trim().length < 5} onClick={() => void perform(async () => {
          await request({ mode: 'resolve_case', case_id: row.id, note: resolutions[row.id] }); await refreshCases(); setMessage('Review note resolved. Payment and waiver status were not changed by closing the note.');
        })}>Mark note resolved</button>
      </article>)}
    </details>
  </section>;
}
