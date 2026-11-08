'use client';

import { useState } from 'react';
import styles from '@/app/staff/classes/payments/payment-preparation.module.css';
type Sale = { id: string; household_id: string; child_ids: string[]; amount_cents: number; status: string; square_invoice_id: string | null; sent_at: string | null; recipient_email: string };
type Family = { saleId?: string; householdId: string; familyName: string | null; email: string | null; children: Array<{ id: string; name: string }>; quote: { subtotalCents: number; discountCents: number; totalCents: number } | null };
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const statusLabel = (sale?: Sale) => !sale?.square_invoice_id ? 'Needs draft' : sale.status === 'paid' ? 'Paid' : sale.status === 'review' ? 'Needs payment review' : sale.sent_at ? 'Sent' : sale.status === 'held' ? 'Payment pending' : 'Draft · not sent';
export default function ClassInvoiceDrafts({ families, sales }: { families: Family[]; sales: Sale[] }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const keyFor = (family: Family) => family.saleId ?? family.householdId;
  const saleFor = (family: Family) => family.saleId ? sales.find(sale => sale.id === family.saleId) : undefined;
  const missing = families.filter(family => !saleFor(family));
  const request = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/admin/classes/series-invoices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json(); if (!res.ok || !data.ok) throw new Error(data.error || 'Unable to update invoice.');
  };
  const act = async (family: Family, sale: Sale | undefined, send: boolean) => {
    setBusy(keyFor(family)); setMessage('');
    try {
      await request(send ? { action: 'send', sale_id: sale?.id, send_confirmed: reviewed[keyFor(family)] === true } : { action: 'draft', household_id: family.householdId, child_ids: family.children.map(child => child.id) });
      window.location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update invoice.'); }
    finally { setBusy(''); }
  };
  return <section className={styles.invoiceSection} aria-labelledby="invoice-drafts-heading">
    <header className={styles.heading}><div><h2 id="invoice-drafts-heading">Family invoices <span className={styles.count}>{families.length}</span></h2><p>Open a family to review the recipient and amount. Drafts send no email.</p></div>
      {missing.length > 0 && <button className={styles.button} disabled={Boolean(busy)} onClick={async () => {
        setBusy('all'); setMessage('');
        try { for (const family of missing) await request({ action: 'draft', household_id: family.householdId, child_ids: family.children.map(child => child.id) }); window.location.reload(); }
        catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to prepare drafts.'); }
        finally { setBusy(''); }
      }}>{busy === 'all' ? 'Preparing…' : `Prepare ${missing.length} missing draft${missing.length === 1 ? '' : 's'} · no email`}</button>}
    </header>
    {message && <p role="alert" className={styles.error}>{message}</p>}
    {!families.length && <p>No family invoices to review yet.</p>}
    <div className={styles.invoiceList}>{families.map(family => {
      const sale = saleFor(family);
      return <details key={keyFor(family)} className={styles.invoice}>
        <summary className={styles.invoiceSummary}><span className={styles.family}><strong>{family.familyName || family.children.map(child => child.name).join(' & ')}</strong><small>{family.children.map(child => child.name).join(' · ')}</small></span><span className={styles.invoiceAmount}>{money(sale?.amount_cents ?? family.quote?.totalCents ?? 0)}</span><span className={styles.badge}>{statusLabel(sale)}</span><span className={styles.reviewLink}>Review <span aria-hidden="true">⌄</span></span></summary>
        <div className={styles.invoiceBody}>
          <dl className={styles.recipient}><div><dt>Email to</dt><dd>{sale?.recipient_email || family.email || 'Email address needed'}</dd></div><div><dt>Children</dt><dd>{family.children.map(child => child.name).join(', ')}</dd></div></dl>
          <div className={styles.amountReview}><p><span>Full five-session series</span><span>{money(family.quote?.subtotalCents ?? sale?.amount_cents ?? 0)}</span></p>{Boolean(family.quote?.discountCents) && <p><span>Second child discount</span><span>−{money(family.quote!.discountCents)}</span></p>}<p className={styles.total}><span>Invoice total</span><span>{money(sale?.amount_cents ?? family.quote?.totalCents ?? 0)}</span></p></div>
          <p className={styles.note}>Due Nov 11, 5:00 PM Eastern. Nonrefundable unless canceled by the instructor. Only completed payment confirms a seat. <a href="#series-invoice-policy">Series dates &amp; policy ↑</a></p>
          {sale?.square_invoice_id && <details className={styles.reference}><summary>Invoice reference</summary><p>{sale.square_invoice_id}</p></details>}
          {!sale?.square_invoice_id ? <button className={styles.button} disabled={Boolean(busy) || !family.email || !family.quote} onClick={() => void act(family, sale, false)}>Create draft · do not send</button>
            : !sale.sent_at && sale.status === 'draft' ? <div className={styles.sendArea}><label><input type="checkbox" checked={reviewed[keyFor(family)] ?? false} onChange={event => setReviewed(current => ({ ...current, [keyFor(family)]: event.target.checked }))} /> I reviewed the recipient, children, total, dates, and policy. Send this invoice by email.</label><button className={styles.sendButton} disabled={Boolean(busy) || !reviewed[keyFor(family)]} onClick={() => void act(family, sale, true)}>{busy === keyFor(family) ? 'Sending…' : 'Send reviewed invoice'}</button><p>Sending an invoice does not reserve a seat. Seats are confirmed in order of completed payment. Payments above capacity require owner review.</p></div>
            : <p className={styles.note}>{statusLabel(sale)}. Use Refresh to verify the latest payment status.</p>}
        </div>
      </details>;
    })}</div>
  </section>;
}
