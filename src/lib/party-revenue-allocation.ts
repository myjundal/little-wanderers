import type { RevenueEvidence, RevenueService, RevenueSources } from '@/lib/service-day-revenue';

/** Only a persisted order link or an explicit full booking ID establishes the
 * party date. Customer names, prices and payment dates are never date evidence. */
export function allocatePartyRevenue(services: RevenueService[], receipts: RevenueEvidence[], sources: RevenueSources) {
  const result = services.map(service => ({ ...service, charges: service.charges.map(charge => ({ ...charge })), issues: [...service.issues] }));
  // Owner-reviewed POS receipts can be separate orders from the original
  // invoice. Keep their explicit links in the existing audited event store;
  // money still comes exclusively from live production Square evidence.
  const savedLinks = new Map<string, { party: string; amount: number }>();
  for (const event of sources.partyReceiptLinks ?? []) {
    if (event.created_by_role !== 'owner' || event.created_by_user_id !== '5054a175-2ba6-4023-a289-a9b0635ccc5f') continue;
    let link;
    try { link = JSON.parse(event.notes); } catch { throw new Error('Saved party receipt link is invalid.'); }
    if (link.version !== 1 || link.environment !== 'production' || typeof link.order_id !== 'string'
      || !/^[A-Za-z0-9_-]{1,192}$/.test(link.order_id) || typeof link.party_booking_id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(link.party_booking_id)
      || !Number.isSafeInteger(link.amount_cents) || link.amount_cents <= 0) throw new Error('Saved party receipt link is invalid.');
    const booking = sources.parties.find(row => row.id === link.party_booking_id);
    if (!booking || booking.household_id !== event.household_id || (booking.square_environment != null && booking.square_environment !== 'production')) throw new Error('Saved party receipt family or environment does not match.');
    const previous = savedLinks.get(link.order_id);
    if (previous && (previous.party !== booking.id || previous.amount !== link.amount_cents)) throw new Error('Saved party receipt links disagree.');
    savedLinks.set(link.order_id, { party: booking.id, amount: link.amount_cents });
  }
  for (const [orderId, link] of savedLinks) {
    const service = result.find(row => row.id === `party:${link.party}`);
    if (!service) throw new Error('Saved party receipt service is unavailable.');
    const linked = result.filter(row => row.charges.some(charge => charge.order_id === orderId));
    if (linked.some(row => row.id !== service.id)) throw new Error('Saved party receipt is already linked to another service.');
    if (!linked.length) service.charges.push({ order_id: orderId, amount_cents: link.amount });
  }
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
    const saved = savedLinks.get(receipt.order_id);
    if (saved && saved.amount !== amount) {
      service.issues.push('Party receipt amount differs from the owner-reviewed allocation.');
      continue;
    }
    if (linked.length) {
      const charges = service.charges.filter(charge => charge.order_id === receipt.order_id);
      if (charges.length !== 1) continue;
      charges[0].amount_cents = amount;
    } else service.charges.push({ order_id: receipt.order_id, amount_cents: amount });
    service.issues = service.issues.filter(issue => issue !== 'Party payments have no linked production order.');
  }
  return result;
}
