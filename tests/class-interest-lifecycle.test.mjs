import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureClass, fixtureChild, loadModule } from './helpers/class-preregistration-harness.mjs';

const serverMock = { createServerSupabaseClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'parent', email: 'parent@example.com' } } }) } }) };
const householdsMock = { getLatestHouseholdIdForUser: async () => 'family' };

test('staff checkout requires a persisted checkout and cannot promote interest from a browser return alone', async () => {
  const attempt = { id: 'checkout', household_id: 'family', kind: 'class' };
  const admin = { from(table) {
    const q = { select(){return q}, eq(){return q}, in(){return q}, order(){return q},
      maybeSingle:async()=>({data:attempt,error:null}),
      then(resolve){resolve({data:{people:[],classes:[]}[table]??[],error:null})},
      insert(){throw new Error('Route must not grant registration')},update(){throw new Error('Route must not grant registration')},
    };return q;
  }};
  let verified=0;
  const api = loadModule('src/app/api/admin/families/[id]/classes/checkout/route.ts', {
    '@/lib/authz':{requireStaffContext:async()=>({ok:true,admin,role:'owner',user:{id:'employee'}})},
    '@/lib/online-payment-access':{onlinePaymentsUnavailable:()=>null},
    '@/lib/square-client':{squareConfig:()=>({environment:'sandbox'})},
    '@/lib/square-checkout':{reconcileCheckout:async(_admin,saved)=>{assert.equal(saved,attempt);verified++;return {status:'pending',checkout_summary:null}}},
    '@/lib/class-waitlist':{},'@/lib/admin-notifications':{},'@/lib/family-profile':{},'@/lib/logger':{},
  });
  const forged = await api.POST({json:async()=>({mode:'finalize'})},{params:{id:'family'}});
  assert.equal(forged.status,400);assert.equal(verified,0);
  const pending = await api.POST({json:async()=>({mode:'finalize',checkout_id:'checkout'})},{params:{id:'family'}});
  assert.equal(pending.status,200);assert.equal((await pending.json()).status,'pending');assert.equal(verified,1);
});

test('manual pre-registration also ignores capacity and waitlist priority', async () => {
  for (const existing of [null, { id: 'old', status: 'cancelled' }]) {
    const writes = [];
    const admin = { from(table) {
      const query = {
        select() { return query; }, eq() { return query; }, in() { return query; }, order() { return query; },
        insert(row) { writes.push(row); return query; }, update(row) { writes.push(row); return query; },
        maybeSingle: async () => ({ error: null, data: {
          people: { ...fixtureChild, role: 'child' }, classes: fixtureClass,
          households: { email: 'parent@example.com' }, class_registrations: writes.length ? { id: 'saved' } : existing,
        }[table] }),
        then(resolve) { resolve({ data: { people: [{ ...fixtureChild, role: 'child' }], classes: [fixtureClass] }[table], error: null }); },
      };
      return query;
    } };
    const api = loadModule('src/app/api/admin/families/[id]/classes/checkout/route.ts', {
      '@/lib/authz': { requireStaffContext: async () => ({ ok: true, admin, role: 'staff', user: { id: 'employee' } }) },
      '@/lib/online-payment-access': { onlinePaymentsUnavailable: () => { throw new Error('Manual interest must not require payment'); } },
      '@/lib/square-client': {}, '@/lib/square-checkout': {},
      '@/lib/class-waitlist': {
        countConfirmedClassRegistrations: async () => { throw new Error('Do not count seats for interest'); },
        hasActiveWaitlistOffer: async () => { throw new Error('Do not check offers for interest'); },
        countWaitlistRegistrations: async () => { throw new Error('Do not rank interest'); },
        sendClassRegistrationEmail: async () => ({ ok: true }),
      },
      '@/lib/admin-notifications': { sendClassRegistrationNotification: async () => ({ ok: true }) },
      '@/lib/family-profile': { getPrimaryGuardianProfile: async () => null },
      '@/lib/logger': { logger: { warn() {}, error() {} } },
    });
    const response = await api.POST({ json: async () => ({ mode: 'register', person_id: 'child', items: [{ class_id: 'painting' }] }) }, { params: { id: 'family' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'preregistered');
    assert.equal(writes[0].status, 'preregistered');
    await new Promise(resolve => setImmediate(resolve));
  }
});

test('cancellation advances confirmed seats and active waitlist offers, without reserving interest', async () => {
  for (const { status, token = null, expires = null, release = false } of [
    { status: 'preregistered' },
    { status: 'preregistered', token: 'stale', expires: '2099-01-01T00:00:00Z' },
    { status: 'waitlist' },
    { status: 'waitlist', token: 'offer', expires: '2099-01-01T00:00:00Z', release: true },
    { status: 'waitlist', token: 'expired', expires: '2020-01-01T00:00:00Z' },
    { status: 'waitlist', expires: '2099-01-01T00:00:00Z' },
    { status: 'scheduled', release: true },
    { status: 'attended', release: true },
  ]) {
    let offered = 0;
    let emailed = 0;
    const writes = [];
    const admin = { from(table) {
      const query = {
        select() { return query; }, eq() { return query; },
        contains() { return query; }, limit() { return query; },
        update(patch) { writes.push(patch); return query; },
        maybeSingle: async () => ({ data: table==='square_checkout_attempts' ? null : { id: 'interest', class_id: 'painting', person_id: 'child', household_id: 'family', status, waitlist_offer_token: token, waitlist_offer_expires_at: expires }, error: null }),
        then(resolve) { resolve({ error: null }); },
      };
      return query;
    } };
    const api = loadModule('src/app/api/classes/cancel/route.ts', {
      '@supabase/supabase-js': { createClient: () => admin },
      '@/lib/supabase/server': serverMock, '@/lib/households': householdsMock,
      '@/lib/class-waitlist': {
        sendClassCancellationEmail: async () => { emailed++; return { ok: true }; },
        offerNextWaitlistSpot: async () => { offered++; return { ok: true }; },
      },
      '@/lib/admin-notifications': { sendClassCancellationNotification: async () => ({ ok: true }) },
      '@/lib/family-profile': { getPrimaryGuardianProfile: async () => null },
      '@/lib/logger': { logger: { warn() {}, error() {} } },
    }, { process: { env: {} } });
    const response = await api.POST({ url: 'http://localhost/api/classes/cancel', json: async () => ({ registration_id: 'interest' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).waitlist_offer_pending, release);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(offered, release ? 1 : 0);
    assert.equal(emailed, 1);
    assert.equal(writes[0].status, 'cancelled');
    assert.equal(writes[0].waitlist_offer_token, null);
  }
});

test('class history keeps interest distinct from booked, attended, and cancelled classes', async () => {
  const registrations = ['preregistered', 'scheduled', 'cancelled'].map(status => ({ id: status, class_id: 'painting', person_id: 'child', status }));
  const admin = { from(table) {
    const query = {
      select() { return query; }, eq() { return query; }, in() { return query; }, order() { return query; },
      then(resolve) { resolve({ error: null, data: { people: [fixtureChild], class_registrations: registrations, classes: [fixtureClass] }[table] }); },
    };
    return query;
  } };
  const api = loadModule('src/app/api/classes/my/route.ts', {
    '@supabase/supabase-js': { createClient: () => admin },
    '@/lib/supabase/server': serverMock, '@/lib/households': householdsMock,
  }, { process: { env: {} } });
  const response = await api.GET();
  const { items } = await response.json();
  assert.deepEqual(items.map(item => item.attendance_display_status), ['preregistered', 'upcoming', 'cancelled']);
});

test('pre-registration counts as interest on the operator roster, not as a booked seat', async () => {
  const rows = {
    classes: [{ ...fixtureClass, capacity: 1 }],
    class_registrations: [
      { id: 'interest', class_id: 'painting', person_id: 'child', status: 'preregistered' },
      { id: 'paid', class_id: 'painting', person_id: 'other', status: 'scheduled' },
    ],
    people: [{ ...fixtureChild, household_id: 'family' }, { id: 'other', first_name: 'Paid' }],
  };
  const admin = { from(table) {
    const query = { select() { return query; }, in() { return query; }, order() { return query; }, then(resolve) { resolve({ data: rows[table], error: null }); } };
    return query;
  } };
  const api = loadModule('src/app/api/admin/classes/route.ts', { '@/lib/authz': { requireStaffContext: async () => ({ ok: true, admin }) } });
  const { items } = await (await api.GET()).json();
  assert.equal(items[0].registrants.length, 2);
  assert.equal(items[0].booked_count, 1);
  assert.equal(items[0].seats_left, 0);
});

test('pre-registered records cannot claim a legacy seat offer', async () => {
  let writes = 0;
  const admin = { from() {
    const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: { id: 'interest', status: 'preregistered' }, error: null }), update() { writes++; return query; } };
    return query;
  } };
  const api = loadModule('src/app/api/classes/waitlist/claim/route.ts', {
    '@supabase/supabase-js': { createClient: () => admin },
    '@/lib/supabase/server': serverMock, '@/lib/households': householdsMock, '@/lib/class-waitlist': {},
  }, { process: { env: {} } });
  const response = await api.POST({ json: async () => ({ token: 'legacy' }) });
  assert.equal(response.status, 409);
  assert.equal(writes, 0);
});
