'use client';

import { useState } from 'react';
type Sale = { id: string; household_id: string; child_ids: string[]; amount_cents: number; status: string; square_invoice_id: string | null; sent_at: string | null; recipient_email: string };
type Family = { householdId: string; familyName: string | null; email: string | null; children: Array<{ id: string; name: string }>; quote: { subtotalCents: number; discountCents: number; totalCents: number } | null };
export default function ClassInvoiceDrafts({ families, sales }: { families: Family[]; sales: Sale[] }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const act = async (family: Family, sale: Sale | undefined, send: boolean) => {
    setBusy(family.householdId); setMessage('');
    try {
      const res = await fetch('/api/admin/classes/series-invoices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(send ? { action: 'send', sale_id: sale?.id, send_confirmed: reviewed[family.householdId] === true } : { action: 'draft', household_id: family.householdId, child_ids: family.children.map(child => child.id) }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Unable to update invoice.');
      window.location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update invoice.'); }
    finally { setBusy(''); }
  };
  return <section style={{ marginTop: 24 }} aria-labelledby="invoice-drafts-heading">
    <h2 id="invoice-drafts-heading">Invoice drafts — review before sending</h2>
    <button type="button" disabled={Boolean(busy)} onClick={async () => {
      setBusy('all'); setMessage('');
      try {
        for (const family of families.filter(family => !sales.some(sale => sale.household_id === family.householdId && sale.status !== 'cancelled'))) {
          const res = await fetch('/api/admin/classes/series-invoices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'draft', household_id: family.householdId, child_ids: family.children.map(child => child.id) }) });
          const data = await res.json(); if (!res.ok || !data.ok) throw new Error(data.error || 'Unable to prepare drafts.');
        }
        window.location.reload();
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to prepare drafts.'); }
      finally { setBusy(''); }
    }}>{busy === 'all' ? 'Preparing drafts…' : 'Create all invoice drafts — no emails'}</button>
    <p>Creating a draft sends nothing. Sending an invoice temporarily holds its seats until the payment deadline; only completed payment confirms them. Capacity is checked again before each send.</p>
    {message && <p role="alert" style={{ color: '#8a3f6b' }}>{message}</p>}
    <div style={{ display: 'grid', gap: 12 }}>{families.map(family => {
      const sale = sales.find(item => item.household_id === family.householdId && item.status !== 'cancelled');
      return <details key={family.householdId} style={{ border: '1px solid #e8dfef', borderRadius: 14, padding: 16, background: '#fff' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>{family.familyName || family.children.map(child => child.name).join(' & ')} · ${((sale?.amount_cents ?? family.quote?.totalCents ?? 0) / 100).toFixed(2)} · {sale?.status === 'paid' ? 'Paid' : sale?.sent_at ? 'Sent' : sale?.square_invoice_id ? 'Draft — not sent' : 'Draft not yet created'}</summary>
        <p><strong>To:</strong> {sale?.recipient_email || family.email || 'Email address needed'}<br /><strong>Children:</strong> {family.children.map(child => child.name).join(', ')}</p>
        <p>Jamie’s Little Hands, Big Canvases — full 5-session series.<br />November 12, November 19, December 3, December 10, December 17, 2026. Thursdays, 5:00–5:45 PM Eastern. No class on Thanksgiving.</p>
        <p><strong>Due:</strong> November 11, 2026 at 5:00 PM Eastern, 24 hours before the first class.</p>
        <p><strong>Terms:</strong> This series is nonrefundable unless canceled by the instructor. Payment must be completed to confirm a seat. Spaces are limited. Sibling/Twin discount: $20 off the second child’s series registration.</p>
        {sale?.square_invoice_id && <p style={{ color: '#6d6480', fontSize: 12 }}>Square invoice: {sale.square_invoice_id}</p>}
        {!sale?.square_invoice_id ? <button type="button" disabled={Boolean(busy) || !family.email || !family.quote} onClick={() => void act(family, sale, false)}>Create invoice draft — do not send</button>
          : !sale.sent_at && sale.status === 'draft' ? <div><label style={{ display: 'block', margin: '12px 0' }}><input type="checkbox" checked={reviewed[family.householdId] ?? false} onChange={event => setReviewed(current => ({ ...current, [family.householdId]: event.target.checked }))} /> I reviewed the recipient, children, amount, dates, and terms. Email this invoice now.</label><button type="button" disabled={Boolean(busy) || !reviewed[family.householdId]} onClick={() => void act(family, sale, true)}>Send reviewed invoice by email</button></div>
          : <p>Invoice status: {sale.status}. Refresh details to verify payment.</p>}
      </details>;
    })}</div>
  </section>;
}
