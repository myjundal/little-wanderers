import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireOwnerContext } from '@/lib/authz';
import { JAMIE_ART_TITLE, prepareJamieArtPayments, buildSeriesInvoiceFamilies } from '@/lib/class-payment-preparation';
import { squareEnvironment } from '@/lib/square-client';
import ClassInvoiceDrafts from '@/components/classes/ClassInvoiceDrafts';
import { reconcileSeriesSales } from '@/lib/class-series-payments';
import styles from './payment-preparation.module.css';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const metadata = { title: 'Class Payment Preparation - Little Wanderers' };

function money(cents: number) { return `$${(cents / 100).toFixed(2)}`; }
function sessionLabel(value: string) {
  return new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default async function ClassPaymentPreparationPage() {
  const context = await requireOwnerContext();
  if (!context.ok) redirect('/staff/classes');
  const db = context.admin;
  await reconcileSeriesSales(db);
  const { data: sessions, error: classError } = await db.from('classes')
    .select('id,title,status,start_time,price_cents,capacity').eq('title', JAMIE_ART_TITLE).order('start_time');
  if (classError) throw new Error('Unable to load class payment preparation.');
  const sessionIds = (sessions ?? []).filter(session => session.status === 'scheduled').map(session => session.id);
  const { data: registrations, error: registrationError } = sessionIds.length
    ? await db.from('class_registrations').select('class_id,person_id,status').in('class_id', sessionIds)
    : { data: [], error: null };
  if (registrationError) throw new Error('Unable to load class pre-registrations.');
  const { data: sales, error: saleError } = await db.from('class_series_sales').select('id,household_id,child_ids,amount_cents,discount_cents,status,square_invoice_id,sent_at,recipient_email').eq('program_id', 'jamie-art-2026-11-12').eq('environment', squareEnvironment()).order('created_at', { ascending: false });
  if (saleError) throw new Error('Unable to load invoice drafts.');
  const personIds = [...new Set([...(registrations ?? []).map(registration => registration.person_id), ...(sales ?? []).flatMap(sale => sale.child_ids)])];
  const { data: people, error: peopleError } = personIds.length
    ? await db.from('people').select('id,role,household_id,first_name,last_name').in('id', personIds)
    : { data: [], error: null };
  if (peopleError) throw new Error('Unable to load class participants.');
  const householdIds = [...new Set((people ?? []).map(person => person.household_id).filter((id): id is string => Boolean(id)))];
  const { data: households, error: householdError } = householdIds.length
    ? await db.from('households').select('id,name,email').in('id', householdIds)
    : { data: [], error: null };
  if (householdError) throw new Error('Unable to load family payment details.');
  const preparation = prepareJamieArtPayments({ sessions: sessions ?? [], registrations: registrations ?? [], people: people ?? [], households: households ?? [], paidChildrenByHousehold: Object.fromEntries((households ?? []).map(household => [household.id, new Set((sales ?? []).filter(sale => sale.household_id === household.id && sale.status === 'paid').flatMap(sale => sale.child_ids)).size])) });

  const invoiceFamilies = buildSeriesInvoiceFamilies({ pending: preparation.families, people: people ?? [], households: households ?? [], sales: sales ?? [] });

  return <main className={styles.page}>
    <Link className={styles.back} href="/staff/classes">← Classes</Link>
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>Ms. Jamie · Little Hands, Big Canvases</p><h1>Series invoices</h1><p>Review each family’s invoice before sending.</p></div>
      <a className={styles.button} href="/staff/classes/payments">Refresh</a>
    </header>
    <section className={styles.overview} aria-label="Invoice summary">
      <div><span>Drafts · not sent</span><strong>{(sales ?? []).filter(sale => sale.status === 'draft' && sale.square_invoice_id && !sale.sent_at).length}</strong></div>
      <div><span>Sent · awaiting payment</span><strong>{(sales ?? []).filter(sale => sale.sent_at && sale.status !== 'paid' && sale.status !== 'cancelled' && sale.status !== 'review').length}</strong></div>
      <div><span>Paid</span><strong>{(sales ?? []).filter(sale => sale.status === 'paid').length}</strong></div>
      {(sales ?? []).some(sale => sale.status === 'review') && <div><span>Paid · owner review</span><strong>{(sales ?? []).filter(sale => sale.status === 'review').length}</strong></div>}
    </section>
    <p className={styles.note}>Invoices and unpaid checkout pages do not reserve seats. Seats are confirmed in order of completed payment. Payments above capacity are saved for owner review.</p>
    <details id="series-invoice-policy" className={styles.policy}>
      <summary>Series dates, pricing &amp; payment policy</summary>
      <div className={styles.policyBody}>
        <p><strong>Five Thursdays · 5:00–5:45 PM Eastern</strong></p>
        <ul className={styles.dates}>{preparation.sessions.map(session => <li key={session.id}>{sessionLabel(session.start_time)}</li>)}</ul>
        <p>No class on Thanksgiving, November 26.</p>
        <dl className={styles.policyFacts}><div><dt>Series price</dt><dd>{preparation.priceCents == null ? 'Needs review' : money(preparation.priceCents)} per child</dd></div><div><dt>Sibling / twin discount</dt><dd>$20 off the second child · $280 for two</dd></div><div><dt>Payment deadline</dt><dd>November 11, 2026 · 5:00 PM Eastern<br />24 hours before the first class</dd></div><div><dt>Cancellation policy</dt><dd>Nonrefundable unless canceled by the instructor</dd></div><div><dt>Seat confirmation</dt><dd>Only completed payment confirms a seat · {preparation.capacity ?? 'Limited'} seats</dd></div></dl>
      </div>
    </details>
    {preparation.issues.length > 0 && <aside className={styles.review}><strong>Before sending</strong><ul>{preparation.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></aside>}
    <ClassInvoiceDrafts families={invoiceFamilies} sales={sales ?? []} />
  </main>;
}
