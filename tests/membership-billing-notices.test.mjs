import test from 'node:test';
import assert from 'node:assert/strict';
import { planNotices, monthlyCents, emailPayload, deliverNotice, noticeId } from '../scripts/lib/membership-billing-notices.mjs';

const at8 = new Date('2026-11-14T01:00:00Z');
const enrollment = { id: 'enrollment-1', household_id: 'family-1', environment: 'production', status: 'pending', created_at: '2026-11-01T12:00:00Z', consent_at: '2026-11-01T12:00:00Z', terms_version: '2026-11-03-first-visit', square_customer_id: 'customer', square_card_id: 'card', child_ids: ['child-1'], birthdates: ['2024-03-01'], pricing_tier: 'waitlist', base_cents: 5000, sibling_cents: 1000, start_date: null };
const people = [{ id: 'child-1', household_id: 'family-1', first_name: 'Example', last_name: 'Child', role: 'child' }, { id: 'adult-1', household_id: 'family-1', first_name: 'Example', last_name: 'Parent', role: 'adult' }];
const visit = { id: 'visit-1', household_id: 'family-1', person_id: 'child-1', checked_in_at: '2026-11-13T15:00:00Z', source: 'staff_manual', square_environment: 'production' };
function plan(overrides = {}) { return planNotices({ enrollments: [enrollment], families: [{ id: 'family-1', name: 'Example Family', email: 'family@example.com' }], people, checkins: [visit], now: at8, ...overrides }); }

test('first-visit email becomes due at 8 PM Eastern, including winter time', () => {
  assert.equal(plan({ now: new Date('2026-11-14T00:59:59Z') }).candidates.length, 0);
  assert.equal(plan().candidates.length, 1);
  assert.equal(plan().candidates[0].first_visit_date, '2026-11-13');
  assert.equal(plan({ now: new Date('2026-11-15T01:00:00Z') }).candidates.length, 1);
});
test('reservation, adult-only arrival, other children, and sandbox visits are insufficient', () => {
  for (const checkins of [[], [{ ...visit, person_id: 'adult-1' }], [{ ...visit, person_id: 'other-child' }], [{ ...visit, square_environment: 'sandbox' }]]) assert.equal(plan({ checkins }).candidates.length, 0);
});
test('the first membership visit cannot precede the enrollment date', () => {
  const result = plan({ enrollments: [{ ...enrollment, consent_at: '2026-11-12T15:00:00Z' }], checkins: [{ ...visit, checked_in_at: '2026-11-11T15:00:00Z' }, visit] });
  assert.equal(result.candidates[0].first_visit_date, '2026-11-13');
});
test('cancelled, replaced, complimentary, and unauthorized memberships never receive notices', () => {
  assert.equal(plan({ enrollments: [{ ...enrollment, status: 'canceled' }] }).candidates.length, 0);
  assert.equal(plan({ enrollments: [enrollment, { ...enrollment, id: 'new', created_at: '2026-11-12T12:00:00Z', status: 'canceled' }] }).candidates.length, 0);
  assert.equal(plan({ enrollments: [{ ...enrollment, square_card_id: null }] }).review[0].reason, 'enrollment_or_payment_authorization_incomplete');
  assert.equal(plan({ memberships: [{ household_id: 'family-1', square_environment: 'production', renews_at: null, payment_review_required: false, covered_person_ids: ['child-1'] }] }).candidates.length, 0);
});
test('historical visits require an explicitly reviewed catch-up batch', () => {
  const old = { ...visit, checked_in_at: '2026-11-11T15:00:00Z' };
  assert.equal(plan({ checkins: [old] }).candidates.length, 0);
  assert.equal(plan({ checkins: [old], immediateIds: ['enrollment-1'], now: new Date('2026-11-13T18:00:00Z') }).candidates.length, 1);
});
test('frozen sibling prices and seventh-month birthday determine the initial amount', () => {
  const infant = { ...enrollment, birthdates: ['2024-01-01', '2026-04-14'] };
  assert.equal(monthlyCents(infant, '2026-11-13'), 5000);
  assert.equal(monthlyCents(infant, '2026-11-14'), 6000);
  assert.equal(monthlyCents({ ...infant, sibling_cents: 2000 }, '2026-11-14'), 7000);
});
test('the customer email states a rate and future receipt, without claiming a completed charge', () => {
  const payload = emailPayload(plan().candidates[0], 'Studio <hello@example.com>');
  assert.deepEqual(payload.to, ['family@example.com']);
  assert.match(payload.text, /\$50\.00/);
  assert.match(payload.text, /November 13, 2026/);
  assert.match(payload.text, /receipt once payment has been processed/);
  assert.doesNotMatch(payload.text, /successfully charged|payment received|charged your card/i);
});
function memoryStore() {
  const rows = new Map();
  return { rows, get: async id => rows.has(id) ? { ...rows.get(id) } : null, insert: async (id, household, notes) => { if (!rows.has(id)) rows.set(id, { id, notes, household }); }, cas: async (id, previous, notes) => { const row = rows.get(id); if (!row || row.notes !== previous) return false; rows.set(id, { ...row, notes }); return true; } };
}
test('concurrent runners and repeated daily runs send one notice per enrollment', async () => {
  const store = memoryStore(), notice = plan().candidates[0]; let sends = 0;
  const send = async () => { sends++; return { ok: true, id: 'provider-1' }; };
  const options = { notice, from: 'hello@example.com', store, send, now: at8 };
  await Promise.all([deliverNotice(options), deliverNotice(options)]);
  assert.equal(sends, 1);
  assert.equal((await deliverNotice(options)).status, 'already_sent');
  assert.equal(sends, 1);
  assert.equal(JSON.parse(store.rows.get(noticeId(enrollment.id)).notes).provider_id, 'provider-1');
});
test('an uncertain response retries with the original payload and key, then stops outside the provider window', async () => {
  const store = memoryStore(), notice = plan().candidates[0], calls = [];
  const send = async (payload, key) => { calls.push({ payload, key }); throw Error('Network interruption after possible acceptance'); };
  const options = { notice, from: 'hello@example.com', store, send, now: at8 };
  assert.equal((await deliverNotice(options)).status, 'retry');
  assert.equal((await deliverNotice({ ...options, notice: { ...notice, amount_cents: 9000 }, now: new Date(at8.getTime() + 11 * 60000) })).status, 'retry');
  assert.deepEqual(calls[0], calls[1]);
  assert.equal((await deliverNotice({ ...options, now: new Date(at8.getTime() + 24 * 3600000) })).status, 'review');
  assert.equal(calls.length, 2);
});
