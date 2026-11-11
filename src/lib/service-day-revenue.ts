export type RevenueCategory = 'open_play' | 'walk_in' | 'party' | 'class';
export const revenueCategories: Record<RevenueCategory, string> = { open_play: 'Open Play', walk_in: 'Walk-in admission', party: 'Parties', class: 'Classes' };
export const revenueDay = (value: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
export function validRevenueDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
const day = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? revenueDay(value) : '';
const cents = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const production = (value?: string | null) => value == null || value === 'production';
const paid = (status: string) => ['paid', 'prepaid', 'walkin_paid', 'terminal_paid'].includes(status);
const included = (status: string) => ['covered', 'included', 'membership'].includes(status);

export type RevenueBooking = { id: string; slot_id: string; household_id: string; child_ids: string[]; child_count: number; status: string; payment_status: string; payment_environment: string | null; amount_cents: number; square_order_id: string | null };
export type RevenueVisit = { id: string; person_id: string; household_id: string | null; checked_in_at: string; price_cents: number; payment_status: string; square_environment: string | null; square_order_id: string | null };
export type RevenueParty = { id: string; start_time: string; status: string; price_quote_cents: number | null; square_environment: string | null; square_order_id: string | null; deposit_paid_cents: number | null; balance_paid_cents: number | null; payment_review_required: boolean | null; attendance_finalized_at: string | null };
export type RevenueSeries = { id: string; class_ids: string[]; child_ids: string[]; status: string; environment: string; amount_cents: number; square_order_id: string | null };
export type RevenueClass = { id: string; title: string; start_time: string; status: string };
export type RevenueRegistration = { id: string; class_id: string; person_id: string; status: string; attendance_status: string };
export type RevenueSources = {
  bookings: RevenueBooking[]; slots: { id: string; starts_at: string }[]; visits: RevenueVisit[]; parties: RevenueParty[];
  series: RevenueSeries[]; classes: RevenueClass[]; registrations: RevenueRegistration[];
};
export type RevenueCharge = { order_id: string; amount_cents: number };
export type RevenueService = {
  id: string; date: string; category: RevenueCategory; label: string; expected_cents: number;
  attendance: 'visited' | 'reserved' | 'unknown'; cancelled: boolean; charges: RevenueCharge[]; issues: string[];
};
export type RevenueEvidence = {
  order_id: string; service_total_cents: number; tax_cents: number; tip_cents: number;
  payments: { id: string; amount_cents: number; refunded_cents: number; paid_at: string }[];
};

/** Exact integer allocation. The chronological first sessions receive any
 * leftover cents. Weights also preserve a shared family receipt's actual fees. */
export function allocateRevenue(amount: number, weights: number[]) {
  if (!cents(amount) || weights.some(weight => !cents(weight))) throw new Error('Invalid revenue amount.');
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!total) { if (amount) throw new Error('A paid amount has no allocation.'); return weights.map(() => 0); }
  const result = weights.map(weight => Number(BigInt(amount) * BigInt(weight) / BigInt(total)));
  const remainder = weights.map((weight, index) => ({ index, fraction: BigInt(amount) * BigInt(weight) % BigInt(total) }))
    .sort((a, b) => a.fraction === b.fraction ? a.index - b.index : a.fraction > b.fraction ? -1 : 1);
  for (let i = 0, left = amount - result.reduce((sum, value) => sum + value, 0); i < left; i++) result[remainder[i].index]++;
  return result;
}

export function revenueServices(data: RevenueSources) {
  const services: RevenueService[] = [];
  const consumed = new Set<string>();
  const visits = data.visits.filter(row => production(row.square_environment));
  const slots = new Map(data.slots.map(row => [row.id, row]));
  const bookings = data.bookings.filter(row => production(row.payment_environment));
  const forBooking = (row: RevenueBooking) => visits.filter(visit => visit.household_id === row.household_id && row.child_ids.includes(visit.person_id)
    && day(visit.checked_in_at) === day(slots.get(row.slot_id)?.starts_at));
  const newService = (service: RevenueService) => {
    if (!service.date) service.issues.push('Service date is missing or invalid.');
    if (!cents(service.expected_cents)) { service.expected_cents = 0; service.issues.push('The service amount needs review.'); }
    services.push(service); return service;
  };
  for (const row of bookings) {
    const matches = forBooking(row);
    const service = newService({ id: `booking:${row.id}`, date: day(slots.get(row.slot_id)?.starts_at), category: 'open_play',
      label: `Open Play · ${row.child_count} children · ${row.id.slice(0, 8)}`, expected_cents: row.amount_cents, attendance: matches.length ? 'visited' : 'reserved',
      cancelled: row.status === 'cancelled', charges: [], issues: [] });
    if (row.payment_status === 'review') service.issues.push('Reservation payment is marked for review.');
    if (paid(row.payment_status) && (!row.square_order_id || row.payment_environment !== 'production')) service.issues.push('Paid reservation has no linked production order.');
    if (row.square_order_id && row.payment_environment !== 'production') service.issues.push('The payment environment is not verified.');
    if (service.cancelled) {
      if (row.square_order_id && row.payment_environment === 'production') service.charges.push({ order_id: row.square_order_id, amount_cents: row.amount_cents });
      continue;
    }
    const ambiguous = matches.some(visit => consumed.has(visit.id) || bookings.filter(other => other.status !== 'cancelled' && other.household_id === row.household_id
      && other.child_ids.includes(visit.person_id) && day(slots.get(other.slot_id)?.starts_at) === day(visit.checked_in_at)).length !== 1)
      || row.child_ids.some(id => matches.filter(visit => visit.person_id === id).length > 1);
    if (ambiguous) { service.issues.push('More than one booking or visit matches a child.'); continue; }
    if (row.payment_environment === 'production' && row.square_order_id) {
      service.charges.push({ order_id: row.square_order_id, amount_cents: row.amount_cents });
      for (const visit of matches) {
        if (!visit.square_order_id || visit.square_order_id === row.square_order_id) consumed.add(visit.id);
      }
    } else if (included(row.payment_status)) {
      service.expected_cents = 0;
      for (const visit of matches.filter(visit => included(visit.payment_status) || visit.price_cents === 0)) consumed.add(visit.id);
    } else if (matches.length && row.child_ids.length && row.child_ids.length === row.child_count) {
      // A counter reservation and its exact named-child check-ins are one sale.
      if (row.child_ids.every(id => matches.some(visit => visit.person_id === id))) service.expected_cents = matches.reduce((sum, visit) => sum + (included(visit.payment_status) ? 0 : visit.price_cents), 0);
      for (const visit of matches) { consumed.add(visit.id); addVisitCharge(service, visit); }
    } else if (paid(row.payment_status)) service.issues.push('Paid reservation has no linked production order.');
  }
  function addVisitCharge(service: RevenueService, visit: RevenueVisit) {
    if (included(visit.payment_status)) return;
    if (visit.square_order_id && visit.square_environment === 'production') {
      if (visit.price_cents > 0) service.charges.push({ order_id: visit.square_order_id, amount_cents: visit.price_cents });
      else if (paid(visit.payment_status)) service.issues.push('Prepaid visit has no matching reservation amount.');
    } else if (paid(visit.payment_status) || ['pending', 'review'].includes(visit.payment_status)) service.issues.push('Visit payment needs a linked production receipt.');
  }
  for (const visit of visits.filter(visit => !consumed.has(visit.id))) {
    const service = newService({ id: `visit:${visit.id}`, date: day(visit.checked_in_at), category: 'walk_in', label: `Admission · ${visit.id.slice(0, 8)}`,
      expected_cents: included(visit.payment_status) ? 0 : visit.price_cents, attendance: 'visited', cancelled: false, charges: [], issues: [] });
    addVisitCharge(service, visit);
  }
  for (const row of data.parties.filter(row => production(row.square_environment))) {
    const service = newService({ id: `party:${row.id}`, date: day(row.start_time), category: 'party', label: `Party · ${row.id.slice(0, 8)}`,
      expected_cents: row.price_quote_cents ?? 0, attendance: row.attendance_finalized_at ? 'visited' : 'reserved', cancelled: row.status === 'cancelled', charges: [], issues: [] });
    if (row.status === 'pending') service.issues.push('Party booking is not confirmed.');
    if (row.price_quote_cents == null || row.payment_review_required) service.issues.push('Party amount or payment needs review.');
    if (row.square_order_id && row.square_environment === 'production') service.charges.push({ order_id: row.square_order_id, amount_cents: service.expected_cents });
    else if ((row.deposit_paid_cents ?? 0) + (row.balance_paid_cents ?? 0) > 0) service.issues.push('Recorded party payments have no linked production order.');
  }
  const classMap = new Map(data.classes.map(row => [row.id, row]));
  const linkedRegistrations = new Set<string>();
  for (const sale of data.series.filter(row => row.environment === 'production')) {
    if (sale.status === 'draft' && !sale.square_order_id) continue;
    const ids = [...new Set(sale.class_ids)].sort((a, b) => (classMap.get(a)?.start_time ?? a).localeCompare(classMap.get(b)?.start_time ?? b));
    const amounts = allocateRevenue(cents(sale.amount_cents) ? sale.amount_cents : 0, ids.map(() => 1));
    if (!ids.length) newService({ id: `series:${sale.id}`, date: '', category: 'class', label: 'Class payment with no sessions', expected_cents: 0, attendance: 'unknown', cancelled: false, charges: [], issues: ['Class payment has no session dates.'] });
    for (const [index, id] of ids.entries()) {
      const session = classMap.get(id);
      const registrations = data.registrations.filter(row => row.class_id === id && sale.child_ids.includes(row.person_id));
      registrations.forEach(row => linkedRegistrations.add(row.id));
      const service = newService({ id: `series:${sale.id}:${id}`, date: day(session?.start_time), category: 'class', label: `${session?.title ?? 'Class series'} · session ${index + 1}/${ids.length} · ${sale.id.slice(0, 8)}`,
        expected_cents: amounts[index], attendance: sale.child_ids.length > 0 && sale.child_ids.every(child => registrations.some(row => row.person_id === child && row.attendance_status === 'attended')) ? 'visited' : 'reserved',
        cancelled: sale.status === 'cancelled' || session?.status === 'cancelled', charges: [], issues: [] });
      if (sale.class_ids.length !== ids.length || ids.some(id => !classMap.has(id)) || !cents(sale.amount_cents)) service.issues.push('Class session allocation needs review.');
      if (registrations.some(row => row.attendance_status === 'no_show' || row.status === 'cancelled')) service.issues.push('Cancelled or no-show class participation needs review.');
      if (sale.status === 'review') service.issues.push('Class payment is marked for review.');
      if (sale.square_order_id) service.charges.push({ order_id: sale.square_order_id, amount_cents: amounts[index] });
      else if (sale.status === 'paid') service.issues.push('Paid class series has no production order.');
    }
  }
  // Interest-only registrations do not represent sales or guaranteed seats.
  for (const row of data.registrations.filter(row => !linkedRegistrations.has(row.id) && ['scheduled', 'attended'].includes(row.status))) {
    const session = classMap.get(row.class_id);
    newService({ id: `registration:${row.id}`, date: day(session?.start_time), category: 'class', label: `${session?.title ?? 'Class'} · ${row.id.slice(0, 8)}`,
      expected_cents: 0, attendance: row.attendance_status === 'attended' ? 'visited' : 'reserved', cancelled: session?.status === 'cancelled', charges: [], issues: ['Class registration has no verified series payment allocation.'] });
  }
  return services;
}

export function calculateRevenue(services: RevenueService[], evidence: Map<string, RevenueEvidence>, date: string, sourceIssues: string[] = []) {
  if (!validRevenueDate(date)) throw new Error('Choose a valid date.');
  const rows = services.map(service => ({ ...service, issues: [...service.issues], received_cents: 0, refunded_cents: 0, prepaid_cents: 0, same_day_cents: 0, later_paid_cents: 0, tax_cents: 0, tip_cents: 0, due_cents: 0, net_cents: 0 }));
  const orderIds = new Set(rows.filter(row => row.date === date).flatMap(row => row.charges.map(charge => charge.order_id)));
  for (const id of orderIds) {
    const units = rows.flatMap(row => row.charges.filter(charge => charge.order_id === id).map(charge => ({ row, amount: charge.amount_cents })));
    const order = evidence.get(id);
    const total = units.reduce((sum, unit) => sum + unit.amount, 0);
    if (!order || order.order_id !== id || units.some(unit => !cents(unit.amount)) || total !== order.service_total_cents || !total) {
      units.forEach(unit => unit.row.issues.push(order ? 'The shared order total does not match its service allocations.' : 'Live Square receipt verification is unavailable.')); continue;
    }
    const weights = units.map(unit => unit.amount);
    const tax = allocateRevenue(order.tax_cents, weights), tip = allocateRevenue(order.tip_cents, weights);
    units.forEach((unit, index) => { unit.row.tax_cents += tax[index]; unit.row.tip_cents += tip[index]; });
    for (const payment of order.payments) {
      const gross = allocateRevenue(payment.amount_cents, weights);
      // Allocate refund using the already allocated gross to preserve net cents.
      const refunds = allocateRevenue(payment.refunded_cents, gross);
      units.forEach((unit, index) => {
        const net = gross[index] - refunds[index];
        unit.row.received_cents += gross[index]; unit.row.refunded_cents += refunds[index];
        const paymentDay = day(payment.paid_at);
        if (!paymentDay) unit.row.issues.push('The payment date is unavailable.');
        else if (paymentDay < unit.row.date) unit.row.prepaid_cents += net;
        else if (paymentDay === unit.row.date) unit.row.same_day_cents += net;
        else unit.row.later_paid_cents += net;
      });
    }
  }
  const selected = rows.filter(row => row.date === date);
  for (const row of selected) {
    if (row.cancelled && row.received_cents > row.refunded_cents) row.issues.push('Cancelled service retains payment; review its refund or cancellation fee.');
    row.issues = [...new Set(row.issues)];
    row.net_cents = row.cancelled || row.issues.length ? 0 : row.received_cents - row.refunded_cents;
    // A refund reduces revenue; it does not reopen the customer's original bill.
    row.due_cents = row.cancelled || row.issues.length ? 0 : Math.max(0, row.expected_cents - row.received_cents);
    if (row.issues.length || row.cancelled) { row.prepaid_cents = 0; row.same_day_cents = 0; row.later_paid_cents = 0; }
  }
  const sum = (field: 'net_cents' | 'prepaid_cents' | 'same_day_cents' | 'later_paid_cents' | 'due_cents') => selected.reduce((total, row) => total + row[field], 0);
  const issues = [...sourceIssues, ...rows.filter(row => !row.date).map(row => `${row.label}: ${row.issues.join(' ')}`)];
  const categories = (Object.keys(revenueCategories) as RevenueCategory[]).map(category => {
    const items = selected.filter(row => row.category === category);
    return { category, label: revenueCategories[category], count: items.filter(row => !row.cancelled).length, net_cents: items.reduce((sum, row) => sum + row.net_cents, 0), due_cents: items.reduce((sum, row) => sum + row.due_cents, 0) };
  });
  return { date, timezone: 'America/New_York', complete: !issues.length && !selected.some(row => row.issues.length), issues, categories, rows: selected,
    net_cents: sum('net_cents'), prepaid_cents: sum('prepaid_cents'), same_day_cents: sum('same_day_cents'), later_paid_cents: sum('later_paid_cents'), due_cents: sum('due_cents'),
    visited_cents: selected.filter(row => row.attendance === 'visited').reduce((sum, row) => sum + row.net_cents, 0),
    reserved_cents: selected.filter(row => row.attendance !== 'visited').reduce((sum, row) => sum + row.net_cents, 0),
    refunded_cents: selected.filter(row => !row.cancelled && !row.issues.length).reduce((sum, row) => sum + row.refunded_cents, 0),
    review_count: selected.filter(row => row.issues.length).length, generated_at: new Date().toISOString() };
}
export type RevenueReport = ReturnType<typeof calculateRevenue>;
