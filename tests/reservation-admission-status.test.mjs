import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
const modules = loadSquareModules();
const { reservationAdmissionStatus, getReservationAdmissionStatuses } = modules.load('src/lib/reservation-admission-status.ts');
const { admissionPaymentLabel, reservationAdmissionLabel } = modules.load('src/lib/admission-payment-status.ts');
const reservation = { id: 'r', household_id: 'family', child_ids: ['child'], payment_status: 'due', payment_choice: 'counter', payment_environment: null, slot: { starts_at: '2026-11-11T14:00:00Z' } };
const checkin = { id: 'c', household_id: 'family', person_id: 'child', payment_status: 'paid', price_cents: 1600, square_environment: 'production', checked_in_at: '2026-11-11T15:00:00Z' };
test('prepaid and legacy paid admissions never appear due even when their original price is retained', () => {
  for (const payment_status of ['paid', 'prepaid', 'walkin_paid', 'terminal_paid']) assert.ok(!admissionPaymentLabel({ payment_status, price_cents: 1600 }).includes('due'));
  assert.equal(admissionPaymentLabel({ payment_status: 'prepaid', price_cents: 0 }), 'Paid in advance');
  assert.equal(admissionPaymentLabel({ payment_status: 'due', price_cents: 1600 }), '$16.00 due');
});
test('a reservation originally payable at counter uses the recorded same-day Square payment', () => {
  const status = reservationAdmissionStatus(reservation, [checkin], 'production');
  assert.equal(status, 'paid_counter'); assert.ok(reservationAdmissionLabel(status).includes('do not collect again'));
  assert.equal(reservation.payment_status, 'due'); // Presentation never rewrites billing.
});
test('online payment and membership states stay explicit and environment isolation is preserved', () => {
  assert.equal(reservationAdmissionStatus({ ...reservation, payment_status: 'paid', payment_choice: 'now', payment_environment: 'production' }, [], 'production'), 'paid_online');
  assert.equal(reservationAdmissionStatus({ ...reservation, payment_status: 'paid', payment_environment: 'sandbox' }, [], 'production'), 'review');
  assert.equal(reservationAdmissionStatus({ ...reservation, payment_status: 'covered' }, [], 'production'), 'included');
  assert.equal(reservationAdmissionStatus({ ...reservation, payment_choice: 'now' }, [], 'production'), 'pending');
});
test('wrong date, family, child, currency environment and partial family payment do not clear admission due', () => {
  for (const patch of [{ checked_in_at: '2026-11-12T05:00:00Z' }, { household_id: 'other' }, { person_id: 'other-child' }, { square_environment: 'sandbox' }, { payment_status: 'due' }])
    assert.equal(reservationAdmissionStatus(reservation, [{ ...checkin, ...patch }], 'production'), 'due');
  assert.equal(reservationAdmissionStatus({ ...reservation, child_ids: ['child', 'sibling'] }, [checkin], 'production'), 'due');
  assert.equal(reservationAdmissionStatus(reservation, [checkin, { ...checkin, id: 'duplicate' }], 'production'), 'review');
  assert.equal(reservationAdmissionStatus(reservation, [{ ...checkin, payment_status: 'covered', price_cents: 0 }], 'production'), 'included');
});
test('status lookup uses explicit person IDs and Eastern day boundaries without joined people or any write', async () => {
  const calls = [];
  const admin = { from(table) { assert.equal(table, 'checkins'); const filters = []; const q = { select(fields) { assert.ok(!fields.includes('people')); return q; }, in(key, values) { filters.push([key, values]); return q; },
    gte(key, value) { filters.push(['gte', key, value]); return q; }, lt(key, value) { filters.push(['lt', key, value]); return q; }, order() { return q; }, limit() { return q; }, then(resolve) { calls.push(filters); resolve({ data: [checkin], error: null }); } }; return q; } };
  const statuses = await getReservationAdmissionStatuses(admin, [reservation], 'production');
  assert.equal(statuses.get('r'), 'paid_counter');
  assert.ok(calls[0].some(([op, field, value]) => op === 'gte' && field === 'checked_in_at' && Date.parse(value) === Date.parse('2026-11-11T05:00:00Z')));
  assert.ok(calls[0].some(([op, field, value]) => op === 'lt' && field === 'checked_in_at' && Date.parse(value) === Date.parse('2026-11-12T05:00:00Z')));
});

test('a frozen Square checkout is pending rather than another admission due',()=>{
 assert.equal(reservationAdmissionStatus(reservation,[{...checkin,payment_status:'pending'}],'production'),'pending');
 assert.equal(reservationAdmissionStatus(reservation,[{...checkin,payment_status:'review'}],'production'),'review');
 for(const payment_status of ['pending','review'])assert.ok(!admissionPaymentLabel({payment_status,price_cents:1600}).includes('due'));
});
