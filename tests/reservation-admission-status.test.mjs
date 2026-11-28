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
  assert.equal(admissionPaymentLabel({ payment_status: 'prepaid', price_cents: 0 }), 'Paid');
  assert.equal(admissionPaymentLabel({ payment_status: 'due', price_cents: 1600 }), '$16.00 due');
});
test('a reservation originally payable at counter uses the recorded same-day Square payment', () => {
  const status = reservationAdmissionStatus(reservation, [checkin], 'production');
  assert.equal(status, 'paid_counter'); assert.equal(reservationAdmissionLabel(status), 'Paid');
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


test('membership coverage stays distinct from receipts, included adults, free infants and unpaid visits', () => {
  const member = { payment_status: 'covered', price_cents: 0, membership_applied: true };
  assert.equal(admissionPaymentLabel(member), 'Membership');
  assert.equal(admissionPaymentLabel({ ...member, membership_applied: false, founding_membership_applied: true }), 'Membership');
  assert.equal(admissionPaymentLabel({ payment_status: 'membership', price_cents: 0 }), 'Membership');
  assert.equal(admissionPaymentLabel({ payment_status: 'covered', price_cents: 0 }), 'Included');
  assert.equal(admissionPaymentLabel({ payment_status: 'covered', price_cents: 0, infant_sibling_free: true }), 'Infant admission included');
  for (const payment_status of ['paid', 'prepaid', 'walkin_paid', 'terminal_paid'])
    assert.equal(admissionPaymentLabel({ ...member, payment_status, price_cents: 1600 }), 'Paid');
  assert.equal(admissionPaymentLabel({ ...member, payment_status: 'due', price_cents: 1600 }), '$16.00 due');
  assert.equal(reservationAdmissionStatus({ ...reservation, payment_status: 'covered', payment_choice: 'membership' }, [], 'production'), 'membership');
  assert.equal(reservationAdmissionLabel('membership'), 'Membership');
  assert.equal(reservationAdmissionLabel('paid_online'), 'Paid');
  const membershipVisit = { ...checkin, ...member };
  assert.equal(reservationAdmissionStatus(reservation, [membershipVisit], 'production'), 'membership');
  const mixed = reservationAdmissionStatus({ ...reservation, child_ids: ['child', 'sibling'] }, [membershipVisit, { ...checkin, id: 's', person_id: 'sibling' }], 'production');
  assert.equal(mixed, 'paid_or_membership');
  assert.equal(reservationAdmissionLabel(mixed), 'Paid / Membership');
});

test('current membership replaces a stale counter due label before arrival without altering the booking', async () => {
 const {reservationHasMembership}=modules.load('src/lib/reservation-admission-status.ts');
 const enrollment={household_id:'family',environment:'production',status:'active',child_ids:['child'],square_card_id:'card',square_subscription_id:'sub',start_date:'2026-11-01',paid_through:null,created_at:'2026-10-25T12:00:00Z'};
 assert.equal(reservationHasMembership(reservation,[enrollment],'production'),true);
 for(const patch of [{square_order_id:'order'},{square_payment_link_id:'link'},{payment_url:'https://square.example/checkout'},{payment_choice:'now'},{payment_status:'paid'},{child_ids:['child','other']},{slot:{starts_at:'2026-10-24T15:00:00Z'}}])assert.equal(reservationHasMembership({...reservation,...patch},[enrollment],'production'),false);
 assert.equal(reservationHasMembership(reservation,[{...enrollment,environment:'sandbox'}],'production'),false);
 const calls=[];
 const admin={from(table){calls.push(table);const q={select(){return q;},in(){return q;},eq(){return q;},gte(){return q;},lt(){return q;},order(){return q;},limit(){return q;},then(resolve){resolve({data:table==='founding_memberships'?[enrollment]:[],error:null});}};return q;}};
 const original=JSON.stringify(reservation);
 const statuses=await getReservationAdmissionStatuses(admin,[reservation],'production');
 assert.equal(statuses.get(reservation.id),'membership');assert.equal(JSON.stringify(reservation),original);
 assert.deepEqual(calls,['checkins','founding_memberships','membership_events']);
 const broken={from(table){const q={select(){return q;},in(){return q;},eq(){return q;},gte(){return q;},lt(){return q;},order(){return q;},limit(){return q;},then(resolve){resolve({data:[],error:table==='founding_memberships'?{message:'unavailable'}:null});}};return q;}};
 await assert.rejects(getReservationAdmissionStatuses(broken,[reservation],'production'),/Unable to verify reservation membership/);
});
