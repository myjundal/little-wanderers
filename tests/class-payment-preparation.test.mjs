import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const { quoteJamieArtSeries: quote, prepareJamieArtPayments: prepare, JAMIE_ART_TITLE: title, JAMIE_ART_SESSION_STARTS: starts } = loadModule('src/lib/class-payment-preparation.ts');
const sessions = starts.map((start_time, i) => ({ id: `session-${i}`, title, status: 'scheduled', start_time, price_cents: 15000, capacity: 7 }));
const people = ['a', 'b', 'c'].map(id => ({ id, household_id: id === 'c' ? 'other' : 'family', role: 'child', first_name: id, last_name: 'Example' }));
const households = ['family', 'other'].map(id => ({ id, name: id, email: `${id}@example.com` }));
const registration = (person_id, session = 0, status = 'preregistered') => ({ class_id: sessions[session].id, person_id, status });

test('series charges once per child, with a single $20 second-child discount', () => {
  assert.equal(quote(['a'], 15000).totalCents, 15000);
  assert.equal(quote(['a', 'b'], 15000).totalCents, 28000);
  assert.equal(quote(['a', 'b', 'c'], 15000).totalCents, 43000);
  assert.equal(quote(['a', 'b'], 15000).discountCents, 2000);
  assert.equal(quote(['second'], 15000, 1).totalCents, 13000);
  assert.equal(quote(['third'], 15000, 2).totalCents, 15000);
  assert.equal(quote(['third', 'fourth'], 15000, 2).totalCents, 30000);
  assert.throws(() => quote(['a', 'a'], 15000));
  assert.throws(() => quote([], 15000));
  for (const price of [0, -1, 15000.5, NaN, Infinity]) assert.throws(() => quote(['a'], price));
});

test('five selected dates never charge five series or duplicate a child', () => {
  const registrations = sessions.flatMap((_, i) => [registration('a', i), registration('b', i)]);
  registrations.push(registration('c'));
  const result = prepare({ sessions, registrations, people, households });
  assert.equal(result.interestCount, 3);
  assert.equal(result.families.length, 2);
  const family = result.families.find(f => f.householdId === 'family');
  assert.equal(family.children.length, 2);
  assert.equal(family.quote.totalCents, 28000);
  assert.equal(result.families.find(f => f.householdId === 'other').quote.totalCents, 15000);
  assert.equal(result.issues.length, 0);
});

test('cancelled interest and already confirmed children are not prepared for another payment', () => {
  const registrations = [registration('a'), registration('a', 1, 'scheduled'), registration('b', 0, 'cancelled'), registration('c')];
  const result = prepare({ sessions, registrations, people, households });
  assert.equal(result.families.length, 1);
  assert.equal(result.families[0].children[0].id, 'c');
  assert(result.issues.some(issue => issue.includes('payment history')));
});

test('unlinked people are held for review instead of sharing a sibling discount', () => {
  const result = prepare({ sessions, registrations: [registration('a'), registration('b')], people: people.map(p => ({ ...p, household_id: null })), households });
  assert.equal(result.families.length, 0);
  assert(result.issues.some(issue => issue.includes('family link')));
});

test('incomplete series, inconsistent prices, and excess interest require review', () => {
  const result = prepare({ sessions: sessions.slice(1).map((s, i) => ({ ...s, capacity: 1, price_cents: i ? 15000 : 13000 })), registrations: [registration('a', 1), registration('b', 1)], people, households });
  assert.equal(result.priceCents, null);
  assert.equal(result.families[0].quote, null);
  assert(result.issues.some(issue => issue.includes('five sessions')));
  assert(result.issues.some(issue => issue.includes('consistent price')));
  assert(result.issues.some(issue => issue.includes('Interest exceeds')));
});

test('owner authorization is checked before family payment details are read', async () => {
  let queried = false;
  const page = loadModule('src/app/staff/classes/payments/page.tsx', {
    'next/link': {}, 'next/navigation': { redirect() { throw new Error('redirect'); } },
    '@/lib/authz': { requireOwnerContext: async () => ({ ok: false, admin: { from() { queried = true; } } }) },
    '@/lib/class-payment-preparation': {}, '@/lib/class-series-payments': {}, '@/lib/square-client': {}, '@/components/classes/ClassInvoiceDrafts': {}, './payment-preparation.module.css': {},
  });
  await assert.rejects(page.default(), /redirect/);
  assert.equal(queried, false);
});
