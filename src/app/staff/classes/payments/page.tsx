import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireOwnerContext } from '@/lib/authz';
import { JAMIE_ART_TITLE, prepareJamieArtPayments } from '@/lib/class-payment-preparation';
import { squareEnvironment } from '@/lib/square-client';
import ClassInvoiceDrafts from '@/components/classes/ClassInvoiceDrafts';
import { SERIES_TERMS, SERIES_DATES, reconcileSeriesSales } from '@/lib/class-series-payments';
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
  const personIds = [...new Set((registrations ?? []).map(registration => registration.person_id))];
  const { data: people, error: peopleError } = personIds.length
    ? await db.from('people').select('id,role,household_id,first_name,last_name').in('id', personIds)
    : { data: [], error: null };
  if (peopleError) throw new Error('Unable to load class participants.');
  const householdIds = [...new Set((people ?? []).map(person => person.household_id).filter((id): id is string => Boolean(id)))];
  const { data: households, error: householdError } = householdIds.length
    ? await db.from('households').select('id,name,email').in('id', householdIds)
    : { data: [], error: null };
  if (householdError) throw new Error('Unable to load family payment details.');
  const { data: sales, error: saleError } = await db.from('class_series_sales').select('id,household_id,child_ids,amount_cents,status,square_invoice_id,sent_at,recipient_email').eq('program_id', 'jamie-art-2026-11-12').eq('environment', squareEnvironment()).order('created_at', { ascending: false });
  if (saleError) throw new Error('Unable to load invoice drafts.');
  const preparation = prepareJamieArtPayments({ sessions: sessions ?? [], registrations: registrations ?? [], people: people ?? [], households: households ?? [], paidChildrenByHousehold: Object.fromEntries((households ?? []).map(household => [household.id, new Set((sales ?? []).filter(sale => sale.household_id === household.id && sale.status === 'paid').flatMap(sale => sale.child_ids)).size])) });

  return <main className={styles.page}>
    <Link className={styles.back} href="/staff/classes">← Class Management</Link>
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>Owner tools</p><h1>Class payment preparation</h1><p>Review Jamie’s full-series amounts and family details before opening payment.</p></div>
      <a className={styles.button} href="/staff/classes/payments">Refresh details</a>
    </header>
    <section className={styles.panel} aria-labelledby="series-heading">
      <div className={styles.seriesHeading}><div><p className={styles.eyebrow}>Ms. Jamie · 5-week art series</p><h2 id="series-heading">{JAMIE_ART_TITLE}</h2></div><span className={styles.badge}>Preparation only</span></div>
      <div className={styles.facts}>
        <div><span>Full series, per child</span><strong>{preparation.priceCents == null ? 'Needs review' : money(preparation.priceCents)}</strong></div>
        <div><span>Sibling / twin discount</span><strong>$20 off the second child</strong></div>
        <div><span>Pre-registered interest</span><strong>{preparation.interestCount} children · {preparation.capacity ?? 'TBA'} seats</strong></div>
      </div>
      <p className={styles.note}>One registration covers all five sessions. The second-child discount applies once per family for the series.</p>
      <ul className={styles.dates}>{preparation.sessions.map(session => <li key={session.id}>{sessionLabel(session.start_time)}</li>)}</ul>
      <p className={styles.note}>{SERIES_DATES}</p>
      <p className={styles.note}><strong>{SERIES_TERMS}</strong></p>
    </section>
    {preparation.issues.length > 0 && <section className={styles.review} aria-labelledby="review-heading"><h2 id="review-heading">Review before opening payment</h2><ul>{preparation.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></section>}
    <section className={styles.panel} aria-labelledby="family-heading">
      <h2 id="family-heading">Prepared family amounts</h2>
      <p className={styles.note}>These are estimates for interested families. Invoice drafts are not sent automatically. Only completed payment confirms a place; spaces are limited.</p>
      {!preparation.families.length ? <p>No family amounts to prepare yet.</p> : <div className={styles.tableWrap}><table>
        <caption className={styles.srOnly}>Jamie art series payment estimates by family</caption>
        <thead><tr><th scope="col">Family &amp; children</th><th scope="col">Full-series subtotal</th><th scope="col">Sibling / twin discount</th><th scope="col">Prepared total</th></tr></thead>
        <tbody>{preparation.families.map(family => <tr key={family.householdId}>
          <th scope="row"><Link href={`/staff/families/${encodeURIComponent(family.householdId)}`}>{family.familyName || family.children.map(child => child.name).join(' & ')}</Link><span className={styles.detail}>{family.children.map(child => child.name).join(' · ')}</span><span className={styles.detail}>{family.email || 'Email address needed'}</span></th>
          <td>{family.quote ? money(family.quote.subtotalCents) : 'Needs review'}</td>
          <td>{family.quote?.discountCents ? `−${money(family.quote.discountCents)}` : '—'}</td>
          <td className={styles.total}>{family.quote ? money(family.quote.totalCents) : 'Needs review'}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    <ClassInvoiceDrafts families={preparation.families} sales={sales ?? []} />
  </main>;
}
