import { revenueDay, type RevenueCategory, type RevenueEvidence, type RevenueService } from '@/lib/service-day-revenue';

/** Category affects presentation only; unmatched sales still enter the total. */
export function squareSaleCategory(name: string, itemType?: string): RevenueCategory {
  if (itemType === 'GIFT_CARD' || /gift\s*card|e-?gift/i.test(name)) return 'gift_card';
  if (/membership|subscription|founding/i.test(name)) return 'membership';
  if (/open\s*play|admission|soft\s*opening|walk[ -]?in/i.test(name)) return 'open_play';
  if (/party|birthday/i.test(name)) return 'party';
  if (/class|yoga|music|art session/i.test(name)) return 'class';
  if (/café|cafe|coffee|espresso|latte|cappuccino|tea\b|juice|snack|cookie|muffin|croissant|water|milk|cocoa|chocolate|drink|smoothie|bagel|pastry|sandwich/i.test(name)) return 'cafe';
  if (/pass|retail|merch|sock|toy|shirt/i.test(name)) return 'retail';
  return 'other';
}

/** Keep linked admissions/classes on their service dates. Add the rest of each
 * Square receipt on its payment date, including receipts with no website booking.
 * The same receipt remains one allocation, even with mixed admission/café items. */
export function supplementSquareRevenue(services: RevenueService[], evidence: Map<string, RevenueEvidence>, date: string) {
  const result = [...services];
  for (const receipt of evidence.values()) {
    const linked = services.flatMap(service => service.charges.filter(charge => charge.order_id === receipt.order_id).map(charge => ({ category: service.category, amount: charge.amount_cents })));
    const linkedTotal = linked.reduce((sum, unit) => sum + unit.amount, 0);
    const remainder = receipt.service_total_cents - linkedTotal;
    if (remainder <= 0) continue; // Overallocated receipts remain visible for review in the calculator.
    const budgets = new Map<RevenueCategory, number>();
    for (const unit of linked) {
      const category = unit.category === 'walk_in' ? 'open_play' : unit.category;
      budgets.set(category, (budgets.get(category) ?? 0) + unit.amount);
    }
    let items = (receipt.items ?? []).map(item => {
      const consume = Math.min(item.amount_cents, budgets.get(item.category) ?? 0);
      budgets.set(item.category, (budgets.get(item.category) ?? 0) - consume);
      return { ...item, amount_cents: item.amount_cents - consume };
    }).filter(item => item.amount_cents > 0);
    if (items.reduce((sum, item) => sum + item.amount_cents, 0) !== remainder) {
      // An unrecognized admission label must not absorb a clearly itemized café
      // or gift-card sale. Preserve those when they exactly explain the balance.
      const extras = items.filter(item => ['cafe', 'gift_card', 'membership', 'retail'].includes(item.category));
      items = extras.reduce((sum, item) => sum + item.amount_cents, 0) === remainder ? extras
        : [{ label: linkedTotal ? 'Additional Square purchases' : 'Square sale', category: 'other', amount_cents: remainder }];
    }
    const paidOnDate = receipt.payments.some(payment => revenueDay(payment.paid_at) === date);
    const saleDate = paidOnDate ? date : receipt.payments[0] ? revenueDay(receipt.payments[0].paid_at) : date;
    for (const [index, item] of items.entries()) result.push({
      id: `square:${receipt.order_id}:${index}`, date: saleDate, category: item.category,
      label: `${item.label} · ${receipt.order_id.slice(0, 8)}`, expected_cents: item.amount_cents,
      attendance: 'sale', recognition: 'payment', cancelled: false,
      charges: [{ order_id: receipt.order_id, amount_cents: item.amount_cents }], issues: [],
    });
  }
  return result;
}
