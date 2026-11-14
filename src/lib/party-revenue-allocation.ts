import type { RevenueEvidence, RevenueService, RevenueSources } from '@/lib/service-day-revenue';

/** Only a persisted order link or an explicit full booking ID establishes the
 * party date. Customer names, prices and payment dates are never date evidence. */
export function allocatePartyRevenue(services: RevenueService[], receipts: RevenueEvidence[], sources: RevenueSources) {
  const result = services.map(service => ({ ...service, charges: service.charges.map(charge => ({ ...charge })), issues: [...service.issues] }));
  for (const receipt of receipts) {
    const linked = result.filter(row => row.charges.some(charge => charge.order_id === receipt.order_id));
    if (linked.length > 1 || (linked.length && linked[0].category !== 'party')) continue;
    const booking = sources.parties.find(row => row.id === receipt.party_booking_id && (row.square_environment == null || row.square_environment === 'production'));
    const service = linked[0] ?? (booking && result.find(row => row.id === `party:${booking.id}`));
    if (!service) continue;
    if (receipt.party_booking_id && service.id !== `party:${receipt.party_booking_id}`) {
      service.issues.push('Party receipt and booking references disagree.');
      continue;
    }
    const items = receipt.items ?? [];
    const partyItems = items.filter(item => item.category === 'party');
    // A booking link may label an opaque invoice, but a mixed receipt must keep
    // its itemized café/retail allocation intact. Deposit-only orders need not
    // equal the full quote: that quote remains the party's outstanding bill.
    const amount = partyItems.length ? partyItems.reduce((sum, item) => sum + item.amount_cents, 0)
      : items.every(item => item.category === 'other') ? receipt.service_total_cents : 0;
    if (!Number.isSafeInteger(amount) || amount <= 0) continue;
    if (linked.length) {
      const charges = service.charges.filter(charge => charge.order_id === receipt.order_id);
      if (charges.length !== 1) continue;
      charges[0].amount_cents = amount;
    } else service.charges.push({ order_id: receipt.order_id, amount_cents: amount });
    service.issues = service.issues.filter(issue => issue !== 'Party payments have no linked production order.');
  }
  return result;
}
