import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { loadSquareModules, localSquareAdmin, ids } from './helpers/admission-pos-harness.mjs';

const childId = ids.person;
const profile = (children = [{ id: childId, firstName: 'Sam', lastName: 'Family', gender: 'prefer_not_to_say', birthdate: '2023-01-01' }]) => ({ adultFirstName: 'Parent', adultLastName: 'Family', adultGender: 'female', email: 'parent@example.test', phone: '+18605550123', city: 'West Hartford', state: 'CT', children });
const fixture = `
create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key,email text);
create table waitlist_entries(normalized_email text,claimed_user_id uuid,created_at timestamptz,email text);
create table households(id uuid primary key,name text,email text,phone text,city text,state text);
create table household_members(household_id uuid,user_id uuid,role text);
create table people(id uuid primary key default gen_random_uuid(),household_id uuid,role text,first_name text,last_name text,gender text,birthdate date,notes text,created_at timestamptz default now());
create table open_play_reservation_slots(id uuid primary key,starts_at timestamptz,is_soft_opening boolean);
create table open_play_reservations(slot_id uuid,household_id uuid,status text);
create table roles(id uuid,role text);create table user_roles(user_id uuid,role text);
create table memberships(id uuid primary key default gen_random_uuid(),household_id uuid,person_id uuid,renews_at timestamptz,square_environment text);
create table waivers(household_id uuid,waiver_version text,signed_at timestamptz,waiver_expires_at timestamptz,electronic_signature text,covered_person_ids uuid[]);
create table checkins(id uuid primary key default gen_random_uuid(),person_id uuid,household_id uuid,child_id uuid,created_by_user_id uuid,created_by_role text,source text,price_cents integer,membership_applied boolean,square_environment text,checked_in_at timestamptz default now());
create table staff_family_search_aliases(alias_household_id uuid,canonical_household_id uuid);
create table membership_events(id uuid primary key,household_id uuid,action text,notes text,created_by_user_id uuid,created_by_role text);
create table occupancy_events(event_type text,delta integer,created_by uuid);
`;

async function database(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(fixture);
  await db.exec(fs.readFileSync('db/migrations/20261103_founding_memberships.sql', 'utf8'));
  await db.exec(fs.readFileSync('db/migrations/20261103_founding_offer_email_identity_fix.sql', 'utf8'));
  await db.exec(fs.readFileSync('db/migrations/20261028_launch_checkin.sql','utf8'));
  await db.exec(fs.readFileSync('db/migrations/20261103_founding_checkin.sql', 'utf8'));
  await db.exec(fs.readFileSync('db/migrations/20261103_membership_notifications.sql', 'utf8'));
  await db.query('insert into auth.users values($1,$2)', [ids.user,contact.email]);
  await db.exec("update founding_membership_settings set phase='public' where environment='sandbox'");
  await db.query('insert into households(id,name) values($1,$2),($3,$4)', [ids.household, 'Family', ids.other, 'Other Family']);
  await db.query("insert into household_members values($1,$2,'primary_caregiver')", [ids.household, ids.user]);
  return { db, admin: localSquareAdmin(db) };
}
async function prepare(admin, input = profile(), overrides = {}) {
  const result = await admin.rpc('prepare_founding_membership', { p_user: ids.user, p_household: ids.household, p_environment: 'sandbox', p_profile: input, p_terms: 'test terms', p_version: '2026-11-03-first-visit', p_amount: 5000, p_tier: 'public', ...overrides });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
function modules(fetchImpl, env = {}) {
  return loadSquareModules({ fetch: async (url, options) => {
    if (new URL(url).pathname === '/v2/cards/card') return Response.json({ card: { id: 'card', customer_id: 'customer', enabled: true } });
    if (new URL(url).pathname === '/v2/subscriptions/search') return Response.json({ subscriptions: [] });
    return fetchImpl(url, options);
  }, env: { FOUNDING_CARD_ENROLLMENT_ENABLED: 'true', SQUARE_APPLICATION_ID: 'test-app', ...env } });
}
const contact = { email: 'parent@example.test', firstName: 'Parent', lastName: 'Family', phone: '+18605550123' };

test('founding prices are server-side: $50 base, $20 from seven calendar months, no charge for baby siblings', () => {
  const lib = modules().load('src/lib/founding-membership.ts');
  assert.equal(lib.foundingMonthlyCents(['2023-01-01'], '2026-11-03'), 5000);
  assert.equal(lib.foundingMonthlyCents(['2026-06-01', '2023-01-01'], '2026-11-03'), 5000);
  assert.equal(lib.foundingMonthlyCents(['2023-01-01', '2026-05-03'], '2026-11-03'), 5000);
  assert.equal(lib.foundingMonthlyCents(['2023-01-01', '2026-05-04'], '2026-11-03'), 5000);
  assert.equal(lib.foundingMonthlyCents(['2023-01-01', '2024-05-03', '2026-06-01'], '2026-11-03'), 7000);
  assert.equal(lib.foundingMonthlyCents(['2026-10-01'], '2026-11-03'), 5000);
  assert.equal(lib.addMonths('2026-08-31', 6), '2027-02-28');
  assert.equal(lib.easternDate(new Date('2026-11-04T02:00:00Z')), '2026-11-03');
  assert.throws(() => lib.foundingMonthlyCents([], '2026-11-03'));
  assert.throws(() => lib.foundingMonthlyCents(['2099-01-01'], '2026-11-03'));
  const phases = lib.foundingPhases(['2023-01-01', '2026-06-03'], '2026-11-03');
  assert.equal(phases[0].pricing.price_money.amount, 5000);
  assert.equal(phases[0].periods, 2);
  assert.equal(phases[1].pricing.price_money.amount, 7000);
  assert.equal(phases[1].periods, undefined);
  const siblings = ['2023-01-01', '2024-01-01'];
  for (const [tier, total, discount] of [['waitlist', 6000, 25], ['public', 7000, 12.5], ['regular', 8000, 0]]) {
    assert.equal(lib.foundingMonthlyCents(siblings, '2026-11-03', tier), total);
    assert.equal(lib.MEMBERSHIP_PRICES[tier].two_child_discount, discount);
    const schedule = lib.foundingPhases(siblings, '2026-11-03', tier);
    assert.equal(schedule.at(-1).pricing.price_money.amount, total);
    assert.equal(schedule.at(-1).periods, undefined);
    assert.match(lib.membershipTerms(tier), /rejoin, regular pricing applies: \$60\/month.*\$20\/month/);
  }
  assert.equal(lib.foundingMonthlyCents(['2023-01-01', '2026-06-01'], '2026-11-03', 'waitlist'), 5000);
});

test('Wanderlist gets first access; late website signups cannot claim its lifetime sibling rate', async t => {
  const { db, admin } = await database(t);
  await db.exec("update founding_membership_settings set phase='waitlist' where environment='sandbox'");
  const offer = async () => (await admin.rpc('founding_membership_offer', { p_user: ids.user, p_household: ids.household, p_environment: 'sandbox' })).data;
  assert.equal((await offer()).can_enroll, false);
  await assert.rejects(prepare(admin), /offer changed/);
  await db.query("insert into waitlist_entries(normalized_email,claimed_user_id,created_at) values($1,$2,'2026-11-01T12:00:00Z')", [contact.email,ids.user]);
  assert.equal((await offer()).can_enroll, false);
  await db.query("insert into waitlist_entries(normalized_email,claimed_user_id,created_at) values($1,null,'2026-10-28T12:00:00Z')", [contact.email]);
  assert.equal((await offer()).tier, 'waitlist'); assert.equal((await offer()).can_enroll, true);
  const saved = await prepare(admin, profile(), { p_tier: 'waitlist' });
  assert.equal(saved.sibling_cents,1000); assert.equal(saved.base_cents,5000);
  await db.query("update auth.users set email='p.arent+family@googlemail.com'");
  await db.query("update waitlist_entries set normalized_email='parent@gmail.com' where claimed_user_id is null");
  assert.equal((await offer()).can_enroll,true);
});

test('phase changes preserve enrolled rates; cancellation permanently moves the family and account to regular rejoining prices', async t => {
  const { db, admin } = await database(t);
  await db.query("insert into waitlist_entries(normalized_email,claimed_user_id,created_at) values($1,$2,'2026-10-28T12:00:00Z')", [contact.email,ids.user]);
  const first = await prepare(admin, profile(), { p_tier:'waitlist' });
  await db.query("update founding_memberships set status='pending',square_customer_id='customer',square_card_id='card'");
  await db.exec("update founding_membership_settings set phase='regular'");
  const frozen = await prepare(admin, profile(), { p_tier:'regular',p_amount:6000 });
  assert.equal(frozen.id,first.id); assert.equal(frozen.pricing_tier,'waitlist'); assert.equal(frozen.sibling_cents,1000);
  const service = modules(() => { throw new Error('No provider calls during pending cancellation.'); }).load('src/lib/founding-square.ts');
  await service.cancelFounding(admin,frozen);
  await db.exec("update founding_membership_settings set phase='waitlist'");
  await assert.rejects(prepare(admin,profile(),{p_tier:'waitlist'}), /offer changed/);
  const rejoined = await prepare(admin,profile(),{p_tier:'regular',p_amount:6000});
  assert.notEqual(rejoined.id,first.id); assert.equal(rejoined.base_cents,6000); assert.equal(rejoined.sibling_cents,2000);
  assert.equal((await prepare(admin,profile(),{p_tier:'regular',p_amount:6000})).id,rejoined.id);
  const history = (await db.query('select status,pricing_tier from founding_memberships order by created_at')).rows;
  assert.deepEqual(history,[{status:'canceled',pricing_tier:'waitlist'},{status:'draft',pricing_tier:'regular'}]);
  const moved = await admin.rpc('founding_membership_offer',{p_user:ids.user,p_household:ids.other,p_environment:'sandbox'});
  assert.equal(moved.data.tier,'regular');
});

test('public release gives new families $50 + $20 while original Wanderlist accounts retain $50 + $10 eligibility', async t => {
  const { db, admin } = await database(t);
  const offer = () => admin.rpc('founding_membership_offer',{p_user:ids.user,p_household:ids.household,p_environment:'sandbox'});
  assert.equal((await offer()).data.tier,'public');
  await db.query("insert into waitlist_entries(normalized_email,claimed_user_id,created_at) values($1,$2,'2026-10-28T12:00:00Z')", [contact.email,ids.user]);
  assert.equal((await offer()).data.tier,'waitlist');
  await db.exec("update founding_membership_settings set phase='regular'");
  assert.equal((await offer()).data.tier,'regular');
  assert.equal((await db.query('select count(*)::integer n from founding_memberships')).rows[0].n,0);
});

test('family profile and consent commit together, reuse existing IDs, and are inaccessible to browser roles', async t => {
  const { db, admin } = await database(t);
  const first = await prepare(admin);
  assert.equal(first.status, 'draft'); assert.equal(first.start_date, null); assert.equal(first.square_card_id, null);
  assert.equal(first.terms_snapshot, 'test terms');
  assert.equal((await db.query('select * from people')).rows.length, 2);
  const again = await prepare(admin); assert.equal(again.id, first.id);
  assert.equal((await db.query('select * from people')).rows.length, 2);
  const family = (await db.query('select * from households where id=$1', [ids.household])).rows[0];
  assert.equal(family.phone, contact.phone); assert.equal(family.email, contact.email);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from founding_memberships'), /permission denied/);
  await assert.rejects(db.query("select claim_founding_operation($1,'draft','active')", [first.id]), /permission denied/);
  await db.exec('reset role');
  await assert.rejects(prepare(admin, profile(), { p_user: ids.other }), /caregiver/);
});

test('new authenticated users receive their own family and enrollment stays linked to that account', async t => {
  const { db, admin } = await database(t);
  await db.exec(`alter table households add column role text;
    alter table households alter column id set default gen_random_uuid();
    alter table household_members add unique(household_id,user_id);
    alter table roles add primary key(id);`);
  const migration = fs.readFileSync('db/migrations/20260703_family_caregiver_roles.sql', 'utf8');
  const trigger = migration.slice(migration.indexOf('create or replace function public.handle_new_user()')).split('$$;')[0] + '$$;';
  await db.exec(`${trigger}
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();`);
  await db.query('insert into auth.users values($1,$2)', [ids.other, 'new@example.test']);
  const family = (await db.query('select * from household_members where user_id=$1', [ids.other])).rows[0];
  assert.equal(family.role, 'primary_caregiver');
  assert.notEqual(family.household_id, ids.household);
  const input = { ...profile([{ ...profile().children[0], id: ids.otherPerson }]), email: 'new@example.test' };
  const saved = await prepare(admin, input, { p_user: ids.other, p_household: family.household_id });
  assert.equal(saved.user_id, ids.other);
  assert.equal(saved.household_id, family.household_id);
  assert.equal(saved.start_date, null);
  const child = (await db.query('select household_id from people where id=$1', [ids.otherPerson])).rows[0];
  assert.equal(child.household_id, family.household_id);
  assert.equal((await db.query('select count(*)::integer n from household_members where user_id=$1', [ids.other])).rows[0].n, 1);
  const phoneUser = '20000000-0000-4000-8000-000000000003';
  await db.query('insert into auth.users values($1,null)', [phoneUser]);
  const phoneFamily = (await db.query('select household_id from household_members where user_id=$1', [phoneUser])).rows[0];
  const phoneProfile = { ...profile([{ ...profile().children[0], id: '30000000-0000-4000-8000-000000000003' }]), email: 'phone-contact@example.test' };
  const phoneSaved = await prepare(admin, phoneProfile, { p_user: phoneUser, p_household: phoneFamily.household_id });
  assert.equal(phoneSaved.user_id, phoneUser);
  assert.equal(phoneSaved.household_id, phoneFamily.household_id);
  assert.equal(phoneSaved.profile_snapshot.email, 'phone-contact@example.test');
});

test('forged child IDs, missing existing children, and repeated IDs roll back the whole family save', async t => {
  const { db, admin } = await database(t);
  await db.query("insert into people(id,household_id,role,first_name) values($1,$2,'child','Other')", [ids.otherPerson, ids.other]);
  await assert.rejects(prepare(admin, profile([{ ...profile().children[0], id: ids.otherPerson }])), /Invalid child/);
  assert.equal((await db.query('select count(*)::integer n from founding_memberships')).rows[0].n, 0);
  await prepare(admin);
  await assert.rejects(prepare(admin, profile([{ ...profile().children[0], id: '30000000-0000-4000-8000-000000000003' }])), /Include all children/);
  assert.equal((await db.query('select count(*)::integer n from people')).rows[0].n, 3);
  await assert.rejects(prepare(admin, profile([profile().children[0], profile().children[0]])), /once/);
});

test('enrollment creates a Square customer and stores a card without payments, invoices, subscriptions, or any date', async t => {
  const { db, admin } = await database(t); let enrollment = await prepare(admin); const calls = [];
  const square = modules(async (url, options) => {
    const path = new URL(url).pathname; calls.push({ path, method: options.method, body: options.body && JSON.parse(options.body) });
    if (path === '/v2/customers') { assert.ok(JSON.parse(options.body).idempotency_key.length <= 45); return Response.json({ customer: { id: 'customer' } }); }
    if (path === '/v2/cards' && options.method === 'GET') return Response.json({ cards: [] });
    if (path === '/v2/cards' && options.method === 'POST') return Response.json({ card: { id: 'card', customer_id: 'customer', enabled: true, card_brand: 'VISA', last_4: '1111' } });
    throw new Error(`Forbidden provider call: ${path}`);
  }).load('src/lib/founding-square.ts');
  const saved = await square.storeFoundingCard(admin, enrollment, 'cnon:test-only', contact);
  assert.equal(saved.status, 'pending'); assert.equal(saved.square_card_id, 'card');
  enrollment = (await db.query('select * from founding_memberships')).rows[0];
  assert.equal(enrollment.start_date, null); assert.equal(enrollment.square_subscription_id, null); assert.equal(enrollment.paid_through, null);
  assert.equal(JSON.stringify(enrollment).includes('cnon:'), false);
  assert.equal(calls.length, 3); assert.ok(calls.every(call => !call.path.includes('subscription') && !call.path.includes('payment') && !call.path.includes('invoice')));
  await square.storeFoundingCard(admin, enrollment, 'cnon:retry', contact); assert.equal(calls.length, 3);
  const cancelWithoutCredentials = modules(() => { throw new Error('Cancellation must not contact Square.'); }, { SQUARE_ACCESS_TOKEN: '', SQUARE_LOCATION_ID: '' }).load('src/lib/founding-square.ts');
  await cancelWithoutCredentials.cancelFounding(admin, enrollment);
  assert.equal((await db.query('select status from founding_memberships')).rows[0].status, 'canceled');
  assert.equal(calls.length, 3);
  await assert.rejects(square.storeFoundingCard(admin, { ...enrollment, status: 'canceled' }, 'cnon:new', contact), /cannot be enrolled/);
});

test('card recovery uses a provider-saved card after a lost response and never revives a canceled reservation', async t => {
  const { db, admin } = await database(t); const enrollment = await prepare(admin);
  await db.query("update founding_memberships set status='saving_card',square_customer_id='customer'");
  const current = { ...enrollment, status: 'saving_card', square_customer_id: 'customer' };
  const calls = [];
  const square = modules(async (url, options) => { calls.push(options.method); return Response.json({ cards: [{ id: 'recovered-card', customer_id: 'customer', enabled: true, reference_id: enrollment.id, last_4: '1111' }] }); }).load('src/lib/founding-square.ts');
  await square.storeFoundingCard(admin, current, 'cnon:new', contact);
  assert.deepEqual(calls, ['GET']);
  await square.cancelFounding(admin, { ...current, status: 'pending' });
  await assert.rejects(square.storeFoundingCard(admin, current, 'cnon:new', contact), /Unable to confirm/);
  assert.equal((await db.query('select status from founding_memberships')).rows[0].status, 'canceled');
});

test('billing stays closed without the separate flag and refuses missing, future, past, or changed first-visit dates', async t => {
  const { db, admin } = await database(t); const row = await prepare(admin);
  await db.query("update founding_memberships set status='pending',square_customer_id='customer',square_card_id='card'");
  const enrollment = { ...row, status: 'pending', square_customer_id: 'customer', square_card_id: 'card' };
  let calls = 0;
  const disabled = modules(() => { calls++; throw new Error('Forbidden'); }).load('src/lib/founding-square.ts');
  await assert.rejects(disabled.activateFounding(admin, enrollment, ''), /Billing is disabled/);
  const enabled = modules(() => { calls++; throw new Error('Forbidden'); }, { FOUNDING_BILLING_ENABLED: 'true' }).load('src/lib/founding-square.ts');
  for (const date of ['', '2099-01-01', '2000-01-01', '2026-02-30']) await assert.rejects(enabled.activateFounding(admin, enrollment, date), /first membership visit day/);
  assert.equal(calls, 0);
  assert.equal((await db.query('select start_date from founding_memberships')).rows[0].start_date, null);
});

test('activation freezes the explicit date, uses stable idempotency, and encodes the sibling price schedule', async t => {
  const { db, admin } = await database(t);
  await db.query("insert into waitlist_entries(normalized_email,claimed_user_id,created_at) values($1,$2,'2026-10-28T12:00:00Z')", [contact.email,ids.user]);
  const children = [profile().children[0],{...profile().children[0],id:ids.otherPerson,firstName:'Sibling',birthdate:'2024-01-01'}];
  const row = await prepare(admin,profile(children),{p_tier:'waitlist',p_amount:6000}); const calls = [];
  const mod = modules(async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ path: new URL(url).pathname, body });
    if (body.object) return Response.json({ catalog_object: { id: body.object.type === 'SUBSCRIPTION_PLAN' ? 'plan' : 'variation' } });
    return Response.json({ subscription: { id: 'subscription', customer_id: 'customer', start_date: body.start_date } });
  }, { FOUNDING_BILLING_ENABLED: 'true' });
  const today = mod.load('src/lib/founding-membership.ts').easternDate();
  await db.query("update founding_memberships set status='pending',square_customer_id='customer',square_card_id='card'");
  await db.exec("update founding_membership_settings set phase='regular'");
  const service = mod.load('src/lib/founding-square.ts');
  await service.activateFounding(admin, { ...row, status: 'pending', square_customer_id: 'customer', square_card_id: 'card' }, today);
  const saved = (await db.query('select to_jsonb(f) row from founding_memberships f')).rows[0].row;
  assert.equal(saved.status, 'active'); assert.equal(saved.start_date, today); assert.equal(saved.square_subscription_id, 'subscription');
  assert.equal(calls[1].body.object.subscription_plan_variation_data.phases[0].pricing.price_money.amount, 6000);
  assert.equal(saved.sibling_cents,1000); assert.equal(saved.amount_cents,6000);
  assert.equal(calls[2].body.start_date, today); assert.equal(calls[2].body.card_id, 'card'); assert.equal(calls[1].body.object.subscription_plan_variation_data.can_prorate, false);
  await service.activateFounding(admin, saved, today); assert.equal(calls.length, 3);
  await assert.rejects(service.activateFounding(admin, { ...saved, status: 'activating' }, '2099-01-01'), /first membership visit day/);
});

test('pre-opening free visits require a production reservation; paid access requires a paid term and enrolled child', async t => {
  const { db, admin } = await database(t); const row = await prepare(admin);
  const covers = async (person = childId, day = '2026-11-03') => (await db.query('select founding_covers_person($1,$2,$3) covered', [person, ids.household, day])).rows[0].covered;
  await db.query("update founding_memberships set status='pending',square_customer_id='customer',square_card_id='card'");
  assert.equal(await covers(), false);
  await db.query("update founding_memberships set environment='production'");
  assert.equal(await covers(), false);
  await db.query("insert into open_play_reservation_slots values($1,'2026-11-03T15:00:00Z',true)", [ids.klass]);
  await db.query("insert into open_play_reservations values($1,$2,'reserved')", [ids.klass, ids.household]);
  assert.equal(await covers(), true); assert.equal(await covers(ids.otherPerson), false); assert.equal(await covers(childId, '2026-11-04'), false);
  await db.query("update open_play_reservations set status='cancelled'"); assert.equal(await covers(), false);
  await db.query("update founding_memberships set status='active',start_date='2026-11-03',square_subscription_id='sub',paid_through=null where id=$1", [row.id]);
  assert.equal(await covers(), false);
  await db.query("update founding_memberships set paid_through='2026-12-02'");
  assert.equal(await covers(), true); assert.equal(await covers(childId, '2026-12-03'), false);
  await db.query("update founding_memberships set status='canceled'"); assert.equal(await covers(), true);
});

test('provider reconciliation does not grant access for an unpaid invoice and is retryable after persistence failure', async t => {
  const { db, admin } = await database(t); await prepare(admin);
  await db.query("update founding_memberships set status='active',square_customer_id='customer',square_card_id='card',square_subscription_id='sub',start_date='2026-11-03'");
  let status = 'UNPAID';
  const service = modules(async url => {
    if (url.includes('/subscriptions/')) return Response.json({ subscription: { id: 'sub', status: 'ACTIVE', customer_id: 'customer', location_id: 'test-location', start_date: '2026-11-03', charged_through_date: '2026-12-02', invoice_ids: ['invoice'] } });
    return Response.json({ invoice: { subscription_id: 'sub', location_id: 'test-location', status, primary_recipient: { customer_id: 'customer' }, payment_requests: [{ computed_amount_money: { amount: 5000, currency: 'USD' }, total_completed_amount_money: { amount: 5000, currency: 'USD' } }] } });
  }).load('src/lib/founding-square.ts');
  await service.syncFoundingSubscription(admin, 'sub'); assert.equal((await db.query('select paid_through from founding_memberships')).rows[0].paid_through, null);
  status = 'PAID';
  const failedAdmin = { from(table) {
    const query = admin.from(table);
    query.update = () => { const failed = { eq() { return failed; }, then(resolve) { resolve({ error: { message: 'Database unavailable' } }); } }; return failed; };
    return query;
  } };
  await assert.rejects(service.syncFoundingSubscription(failedAdmin, 'sub'), /Unable to save membership status/);
  assert.equal((await db.query('select paid_through from founding_memberships')).rows[0].paid_through, null);
  await service.syncFoundingSubscription(admin, 'sub'); await service.syncFoundingSubscription(admin, 'sub');
  assert.equal((await db.query('select paid_through::text from founding_memberships')).rows[0].paid_through, '2026-12-02');
  await db.query("update founding_memberships set status='canceled'");
  await service.syncFoundingSubscription(admin, 'sub'); assert.equal((await db.query('select status from founding_memberships')).rows[0].status, 'canceled');
  status = 'REFUNDED'; await service.syncFoundingSubscription(admin, 'sub'); assert.equal((await db.query('select paid_through from founding_memberships')).rows[0].paid_through, null);
});

test('enrollment routes authenticate, validate every family field and consent, and never expose provider identifiers or store card tokens', async t => {
  const { db, admin } = await database(t); let cardCalls = 0;
  await db.exec('alter table household_members add column created_at timestamptz default now()');
  const route = user => loadSquareModules({ env: { FOUNDING_CARD_ENROLLMENT_ENABLED: 'true', SQUARE_APPLICATION_ID: 'test-app' }, mocks: {
    'node:util': { isDeepStrictEqual: (a, b) => isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b))) },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/lib/logger': { logger: { debug() {}, info() {}, error() {} } },
    '@/lib/founding-square': { foundingCardConfig: () => ({applicationId:'test-app',locationId:'test-location',environment:'sandbox'}), storeFoundingCard: async (_admin, enrollment) => { cardCalls++; return enrollment; } },
  } }).load('src/app/api/founding-membership/route.ts');
  const anonymous = route(null);
  assert.equal((await anonymous.GET()).status, 401);
  assert.equal((await anonymous.POST({ json: async () => ({}) })).status, 401);
  const api = route({ id: ids.user, email: contact.email });
  const input = { ...profile(), sourceId:'cnon:test-secret-token',consent:true,birthdaysConfirmed:true,termsVersion:'2026-11-03-first-visit',pricingTier:'public' };
  const post = patch => api.POST({ json: async () => ({ ...input, ...patch }) });
  assert.equal((await post({pricingTier:'waitlist'})).status,409);
  for (const patch of [{ consent:false }, { birthdaysConfirmed:false }, { phone:'123' }, { adultFirstName:'' }, { city:'' }, { state:'ZZ' }, { children:[] }, { children:[{...profile().children[0],birthdate:'12/40/2023'}] }, { email:'other@example.test' }, { termsVersion:'old' }]) assert.equal((await post(patch)).status, 400);
  assert.equal(cardCalls, 0); assert.equal((await db.query('select count(*)::integer n from founding_memberships')).rows[0].n, 0);
  const response = await post({ household_id:ids.other,amount_cents:1,start_date:'2099-01-01',square_card_id:'forged-card' });
  assert.equal(response.status, 200); assert.equal(cardCalls, 1);
  const row = (await db.query('select to_jsonb(f) row from founding_memberships f')).rows[0].row;
  assert.equal(row.household_id,ids.household); assert.equal(row.amount_cents,5000); assert.equal(row.start_date,null);
  assert.equal(JSON.stringify(row).includes('cnon:'), false);
  assert.equal(row.profile_snapshot.children[0].birthdate,'2023-01-01');
  const data = await (await api.GET()).json();
  assert.equal(data.household.email, contact.email);
  assert.equal(data.people.find(person => person.role === 'child').id, childId);
  assert.equal(data.enrollment.square_card_id,undefined); assert.equal(data.enrollment.square_customer_id,undefined); assert.equal(data.enrollment.id,undefined);
  await db.query("update household_members set role='member'");
  assert.equal((await api.GET()).status,403); assert.equal((await post({})).status,403); assert.equal((await api.DELETE()).status,403);
});

test('only owners can change rollout; a phase change sets no billing date and a stale update is rejected', async t => {
  const { db,admin } = await database(t);
  const api = allowed => loadSquareModules({mocks:{'@/lib/authz':{requireOwnerContext:async()=>allowed?{ok:true,admin}:{ok:false,response:Response.json({ok:false},{status:403})}}}}).load('src/app/api/admin/founding-memberships/route.ts');
  const patch = (handler,body) => handler.PATCH({json:async()=>body});
  assert.equal((await patch(api(false),{phase:'regular',previousPhase:'public'})).status,403);
  assert.equal((await patch(api(true),{phase:'regular',previousPhase:'public'})).status,200);
  assert.equal((await patch(api(true),{phase:'waitlist',previousPhase:'public'})).status,409);
  assert.equal((await patch(api(true),{phase:'invalid',previousPhase:'regular'})).status,400);
  assert.equal((await db.query('select count(*)::integer n from founding_memberships')).rows[0].n,0);
});

test('phone-only authentication enrolls the same user and family with contact email, without treating it as a verified discount identity', async t => {
  const { db, admin } = await database(t);
  await db.exec('alter table household_members add column created_at timestamptz default now(); update auth.users set email=null');
  await db.query("insert into waitlist_entries(normalized_email,claimed_user_id,created_at) values($1,null,'2026-10-28T12:00:00Z')", [contact.email]);
  const api = loadSquareModules({ mocks: {
    'node:util': { isDeepStrictEqual: (a, b) => isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b))) },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ids.user, phone: '18605550123' } } }) } }) },
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/lib/logger': { logger: { debug() {}, info() {}, error() {} } },
    '@/lib/founding-square': { foundingCardConfig: () => ({ applicationId: 'test-app', locationId: 'test-location', environment: 'sandbox' }), storeFoundingCard: async (_admin, row) => row },
  } }).load('src/app/api/founding-membership/route.ts');
  const data = await (await api.GET()).json();
  assert.equal(data.account.email, null);
  assert.equal(data.account.phone, '+18605550123');
  assert.equal(data.household.phone, '+18605550123');
  const post = tier => api.POST({ json: async () => ({ ...profile(), sourceId: 'cnon:test', consent: true, birthdaysConfirmed: true, termsVersion: '2026-11-03-first-visit', pricingTier: tier }) });
  await db.exec("update founding_membership_settings set phase='waitlist' where environment='sandbox'");
  assert.equal((await post('waitlist')).status, 403);
  await db.exec("update founding_membership_settings set phase='public' where environment='sandbox'");
  assert.equal((await post('public')).status, 200);
  const saved = (await db.query('select * from founding_memberships')).rows[0];
  assert.equal(saved.user_id, ids.user);
  assert.equal(saved.household_id, ids.household);
  assert.equal(saved.profile_snapshot.email, contact.email);
  assert.equal(saved.pricing_tier, 'public');
  assert.equal(saved.start_date, null);
});

test('actual check-in enforces a current waiver before applying the reserved founding visit and increments occupancy once', async t => {
  const { db, admin } = await database(t); await prepare(admin);
  await db.query("update founding_memberships set environment='production',status='pending',square_customer_id='customer',square_card_id='card'");
  await db.query("insert into roles values($1,'staff')", [ids.user]);
  const today = (await db.query("select (now() at time zone 'America/New_York')::date::text as day_key")).rows[0].day_key;
  await db.query('insert into open_play_reservation_slots values($1,$2,true)', [ids.klass,`${today}T15:00:00Z`]);
  await db.query("insert into open_play_reservations values($1,$2,'reserved')", [ids.klass,ids.household]);
  const checkin = () => db.query("select checkin_person($1,$2,'staff','qr','current-waiver') result", [childId,ids.user]);
  assert.equal((await checkin()).rows[0].result.code,'waiver_required');
  await db.query("insert into waivers values($1,'current-waiver',now()-interval '1 minute',now()+interval '30 days','Parent Family',array[$2]::uuid[])", [ids.household,childId]);
  const result = (await checkin()).rows[0].result;
  assert.equal(result.ok,true); assert.equal(result.membership_applied,true); assert.equal(result.price_cents,0);
  assert.equal((await checkin()).rows[0].result.code,'already_checked_in');
  assert.equal((await db.query('select sum(delta)::integer n from occupancy_events')).rows[0].n,1);
});

test('owner notifications queue only completed production enrollments, snapshot family data, and survive failed delivery', async t => {
  const { db, admin } = await database(t);
  const row = await prepare(admin);
  assert.equal((await db.query('select count(*)::int n from membership_notification_outbox')).rows[0].n, 0);
  await db.query("update founding_memberships set status='pending',square_customer_id='customer',square_card_id='card'");
  assert.equal((await db.query('select count(*)::int n from membership_notification_outbox')).rows[0].n, 0);
  await db.query("update founding_memberships set status='saving_card',environment='production'");
  await db.query("update founding_memberships set status='pending'");
  await db.query("update founding_memberships set updated_at=now()");
  let events = (await db.query('select * from membership_notification_outbox')).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.familyName, 'Family Family');
  assert.equal(events[0].payload.email, contact.email);
  assert.equal(events[0].payload.children[0].firstName, 'Sam');
  assert.equal(events[0].payload.children[0].birthdate, '2023-01-01');
  assert.equal(JSON.stringify(events[0]).includes('square_card_id'), false);
  assert.equal(events[0].event_key, `founding/${row.id}`);
  let fail = true; const calls = [];
  const sender = loadSquareModules({ mocks: { '@/lib/admin-notifications': { sendMembershipSignupNotification: async (payload, key) => { calls.push({ payload, key }); return { ok: !fail }; } } } }).load('src/lib/membership-notifications.ts');
  await sender.sendDueMembershipNotifications(admin);
  events = (await db.query('select * from membership_notification_outbox')).rows;
  assert.equal(events[0].sent_at, null);
  await sender.sendDueMembershipNotifications(admin); assert.equal(calls.length, 1);
  await db.exec("update membership_notification_outbox set next_attempt_at=now()-interval '1 minute'"); fail = false;
  await sender.sendDueMembershipNotifications(admin);
  await sender.sendDueMembershipNotifications(admin); assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.ok((await db.query('select sent_at from membership_notification_outbox')).rows[0].sent_at);
  await db.query("insert into memberships(household_id,renews_at) values($1,now()+interval '30 days')", [ids.household]);
  await db.exec("update memberships set renews_at=now()+interval '60 days'");
  await db.query("insert into memberships(household_id,renews_at,square_environment) values($1,now()+interval '30 days','sandbox')", [ids.household]);
  assert.equal((await db.query('select count(*)::int n from membership_notification_outbox')).rows[0].n, 2);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from membership_notification_outbox'), /permission denied/);
  await db.exec('reset role');
});

test('check-in patch preserves the production environment argument, paid admission logic and existing signature', async t => {
  const { db, admin } = await database(t); await prepare(admin);
  await db.query("update founding_memberships set environment='production',status='pending',square_card_id='card'");
  const today = (await db.query("select (now() at time zone 'America/New_York')::date::text as day")).rows[0].day;
  await db.query('insert into open_play_reservation_slots values($1,$2,true)', [ids.klass, `${today}T15:00:00Z`]);
  await db.query("insert into open_play_reservations values($1,$2,'reserved')", [ids.klass, ids.household]);
  await db.exec(`drop function checkin_person(uuid,uuid,text,text,text);
    create function checkin_person(p_person_id uuid,p_staff_user_id uuid,p_staff_role text,p_source text,p_waiver_version text,p_environment text default 'production') returns jsonb language plpgsql as $$
    declare person public.people%rowtype; today_date date:=(now() at time zone 'America/New_York')::date; member boolean;
    begin select * into person from people where id=p_person_id; select false into member;
    return jsonb_build_object('member',member,'paid_admission_preserved',true,'environment',p_environment);end;$$;`);
  await db.exec(fs.readFileSync('db/migrations/20261103_founding_checkin.sql', 'utf8'));
  await db.exec(fs.readFileSync('db/migrations/20261103_founding_checkin.sql', 'utf8'));
  const result = async env => (await db.query('select checkin_person($1,$2,$3,$4,$5,$6) r', [childId,ids.user,'staff','qr','waiver',env])).rows[0].r;
  assert.equal((await result('production')).member, true);
  assert.equal((await result('sandbox')).member, false);
  assert.equal((await result('production')).paid_admission_preserved, true);
  assert.equal((await db.query("select count(*)::int n from pg_proc where proname='checkin_person'")).rows[0].n, 1);
});


test('all membership authorizations start on first visit including soft opening and include the whole soft opening period', () => {
  const lib = modules().load('src/lib/founding-membership.ts');
  assert.equal(lib.FOUNDING_TERMS_VERSION, '2026-11-03-first-visit');
  for (const tier of ['waitlist', 'public', 'regular']) {
    const terms = lib.membershipTerms(tier);
    assert.match(terms, /first membership visit, including a visit during soft opening/);
    assert.match(terms, /Visits throughout the soft opening period/);
    assert.match(terms, /saving my card does not start billing/);
    assert.doesNotMatch(terms, /announced soft opening date|A soft opening visit is included/);
  }
});

test('first-visit activation rejects old consent and gives each family an independent billing date and anchor', async t => {
  const { db, admin } = await database(t);
  const first = await prepare(admin);
  await db.query("insert into household_members values($1,$2,'primary_caregiver')", [ids.other, ids.user]);
  const second = await prepare(admin, profile([{ ...profile().children[0], id: ids.otherPerson }]), { p_household: ids.other });
  await db.query("update founding_memberships set status='pending',square_card_id='card',square_customer_id=id::text");
  const enrolled = row => ({ ...row, status: 'pending', square_card_id: 'card', square_customer_id: row.id });
  const lib = modules().load('src/lib/founding-membership.ts');
  let visitDate = '2026-11-04'; let activeCustomer = first.id; const subscriptions = [];
  const service = loadSquareModules({ env: { FOUNDING_BILLING_ENABLED: 'true' },
    mocks: { '@/lib/founding-membership': { ...lib, easternDate: () => visitDate } },
    fetch: async (_url, options) => {
      if (new URL(_url).pathname === '/v2/cards/card') return Response.json({ card: { id: 'card', customer_id: activeCustomer, enabled: true } });
      if (new URL(_url).pathname === '/v2/subscriptions/search') return Response.json({ subscriptions: [] });
      const body = JSON.parse(options.body);
      if (body.object) return Response.json({ catalog_object: { id: body.object.type === 'SUBSCRIPTION_PLAN' ? 'plan' : 'variation' } });
      subscriptions.push(body);
      return Response.json({ subscription: { id: `sub-${body.customer_id}`, customer_id: body.customer_id, start_date: body.start_date } });
    },
  }).load('src/lib/founding-square.ts');
  await assert.rejects(service.activateFounding(admin, { ...enrolled(first), terms_version: '2026-11-03-tiers' }, visitDate), /accept the current first-visit billing terms/);
  assert.equal(subscriptions.length, 0);
  await service.activateFounding(admin, enrolled(first), visitDate);
  assert.equal((await db.query('select start_date from founding_memberships where id=$1', [second.id])).rows[0].start_date, null);
  visitDate = '2026-11-06'; activeCustomer = second.id;
  await service.activateFounding(admin, enrolled(second), visitDate);
  assert.deepEqual(subscriptions.map(row => [row.start_date, row.monthly_billing_anchor_date]), [['2026-11-04', 4], ['2026-11-06', 6]]);
  assert.equal((await db.query('select start_date::text from founding_memberships where id=$1', [first.id])).rows[0].start_date, '2026-11-04');
});

test('owner activation requires an explicit first-visit confirmation before calling the billing service', async t => {
  const { admin } = await database(t); const enrollment = await prepare(admin); const calls = [];
  const api = loadSquareModules({ mocks: {
    '@/lib/authz': { requireOwnerContext: async () => ({ ok: true, admin, user: { id: ids.user } }) },
    '@/lib/founding-square': { activateFounding: async (...args) => { calls.push(args); } },
    '@/lib/founding-billing-activation': { ownerFoundingBillingEnabled: () => true, foundingBillingDetails: async () => ({ start_date: '2026-11-04', amount_cents: 5000, error: null }) },
  } }).load('src/app/api/admin/founding-memberships/route.ts');
  const input = { id: enrollment.id, startDate: '2026-11-04', expectedAmountCents: 5000, confirmation: 'START MONTHLY BILLING' };
  const post = patch => api.POST({ json: async () => ({ ...input, ...patch }) });
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ firstVisitConfirmed: false })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await post({ firstVisitConfirmed: true })).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].id, enrollment.id);
});

test('billing capability is a server-owned, environment-specific grant', () => {
  const prod = loadSquareModules({ env: { SQUARE_ENVIRONMENT: 'production' } }).load('src/lib/founding-billing-activation.ts');
  assert.equal(prod.ownerFoundingBillingEnabled(), false);
  assert.equal(prod.ownerFoundingBillingEnabled({ user_metadata: { founding_billing_activation: { production: true } } }), false);
  assert.equal(prod.ownerFoundingBillingEnabled({ app_metadata: { founding_billing_activation: { sandbox: true } } }), false);
  assert.equal(prod.ownerFoundingBillingEnabled({ app_metadata: { founding_billing_activation: { production: true } } }), true);
});

test('historical activation freezes a current Square start, charges one full month, and recovers an uncertain renewal-date change', async t => {
  const { db, admin } = await database(t); const row = await prepare(admin);
  const dates = modules().load('src/lib/founding-membership.ts');
  const today = dates.easternDate();
  const visit = dates.easternDate(new Date(Date.now() - 2 * 86400000));
  const consent = new Date(Date.now() - 3 * 86400000).toISOString();
  await db.query("update founding_memberships set status='pending',square_customer_id='customer',square_card_id='card',consent_at=$1", [consent]);
  await db.query("insert into checkins(person_id,household_id,checked_in_at,source,square_environment) values($1,$2,$3,'staff_manual','sandbox')", [childId,ids.household,visit+'T15:00:00Z']);
  let scheduled = false; let anchorCalls = 0; const writes = [];
  const action = { type: 'CHANGE_BILLING_ANCHOR_DATE', effective_date: dates.addMonths(visit,1), monthly_billing_anchor_date: Number(visit.slice(8)) };
  const provider = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/v2/cards/card') return Response.json({ card: { id: 'card', customer_id: 'customer', enabled: true } });
    if (path === '/v2/subscriptions/search') return Response.json({ subscriptions: [] });
    if (path === '/v2/subscriptions/sub' && options.method === 'GET') return Response.json({ subscription: { id: 'sub', invoice_ids: ['inv'], monthly_billing_anchor_date: Number(today.slice(8)) }, actions: scheduled ? [action] : [] });
    if (path === '/v2/invoices/inv') return Response.json({ invoice: { subscription_id: 'sub', primary_recipient: { customer_id: 'customer' }, status: 'PAID', payment_requests: [{ computed_amount_money: { amount: 5000, currency: 'USD' }, total_completed_amount_money: { amount: 5000, currency: 'USD' } }] } });
    const body = JSON.parse(options.body); writes.push({path,body});
    if (body.object) return Response.json({ catalog_object: { id: body.object.type === 'SUBSCRIPTION_PLAN' ? 'plan' : 'variation' } });
    if (path.endsWith('/billing-anchor')) { scheduled = true; anchorCalls++; return Response.json({ errors: [{ code: 'TEMPORARY_ERROR' }] }, { status: 503 }); }
    if (path === '/v2/subscriptions') return Response.json({ subscription: { id: 'sub', customer_id: 'customer', start_date: body.start_date } });
    throw Error('Unexpected endpoint '+path);
  };
  const service = loadSquareModules({ fetch: provider }).load('src/lib/founding-square.ts');
  let enrollment = (await db.query('select to_jsonb(f) value from founding_memberships f where id=$1',[row.id])).rows[0].value;
  const options = { ownerAuthorized: true, ownerUserId: ids.user };
  await assert.rejects(service.activateFounding(admin,enrollment,visit,options), /Square request/);
  enrollment = (await db.query('select to_jsonb(f) value from founding_memberships f where id=$1',[row.id])).rows[0].value;
  assert.equal(enrollment.status,'activating'); assert.equal(enrollment.square_subscription_id,'sub');
  await service.activateFounding(admin,enrollment,visit,options);
  const saved = (await db.query('select to_jsonb(f) value from founding_memberships f where id=$1',[row.id])).rows[0].value;
  assert.equal(saved.status,'active'); assert.equal(saved.start_date,visit); assert.equal(saved.paid_through,dates.addMonths(visit,1));
  const subscriptionCalls=writes.filter(w=>w.path==='/v2/subscriptions');
  assert.equal(subscriptionCalls.length,2);
  assert.deepEqual(subscriptionCalls[0].body,subscriptionCalls[1].body);
  assert.equal(subscriptionCalls[0].body.start_date,today);
  assert.equal(subscriptionCalls[0].body.monthly_billing_anchor_date,Number(today.slice(8)));
  assert.equal(writes.find(w=>w.body.object?.type==='SUBSCRIPTION_PLAN_VARIATION').body.object.subscription_plan_variation_data.phases[0].pricing.price_money.amount,5000);
  assert.equal(anchorCalls,1);
  const record=JSON.parse((await db.query("select notes from membership_events where action='billing_activation_parameters'")).rows[0].notes);
  assert.equal(record.first_visit_date,visit); assert.equal(record.square_start_date,today);
});

test('read-only review blocks disabled cards and any existing live subscription, including later pages', async () => {
  const enrollment={status:'pending',environment:'sandbox',square_customer_id:'customer',square_card_id:'card'};
  let writes=0; let pages=0;
  const loader=loadSquareModules({fetch:async(url,options)=>{
    const path=new URL(url).pathname;
    if(path==='/v2/cards/card')return Response.json({card:{id:'card',customer_id:'customer',enabled:true}});
    if(path==='/v2/subscriptions/search') { pages++; return Response.json(pages===1?{subscriptions:[],cursor:'next'}:{subscriptions:[{id:'existing',customer_id:'customer',location_id:'test-location',status:'ACTIVE'}]}); }
    writes++;throw Error('Forbidden financial write');
  }});
  await assert.rejects(loader.load('src/lib/founding-billing-activation.ts').verifyFoundingBillingCard(enrollment),/existing Square subscription/);
  assert.equal(pages,2);assert.equal(writes,0);
  const disabled=loadSquareModules({fetch:async()=>Response.json({card:{id:'card',customer_id:'customer',enabled:false}})}).load('src/lib/founding-billing-activation.ts');
  await assert.rejects(disabled.verifyFoundingBillingCard(enrollment),/saved card is unavailable/);
});

test('first-visit review excludes reservations, sandbox arrivals, and visits before consent', async t => {
  const { db,admin }=await database(t);const row=await prepare(admin);
  const today=modules().load('src/lib/founding-membership.ts').easternDate();
  const insert=async(source,environment,date=today)=>db.query('insert into checkins(person_id,household_id,source,square_environment,checked_in_at) values($1,$2,$3,$4,$5)',[childId,ids.household,source,environment,date+'T12:00:00Z']);
  row.environment='production';row.status='pending';row.square_customer_id='customer';row.square_card_id='card';
  const lib=modules().load('src/lib/founding-billing-activation.ts');
  await insert('reservation','production');await insert('staff_manual','sandbox');await insert('staff_manual','production','2020-01-01');
  assert.equal(await lib.foundingFirstVisit(admin,row),null);
  await insert('staff_manual','production');
  assert.equal(await lib.foundingFirstVisit(admin,row),today);
});

test('owner POST rejects stale amount and missing capability before any activation', async () => {
  let calls=0;let permitted=true;
  const row={id:ids.household,status:'pending'};
  const q={select(){return q;},eq(){return q;},single:async()=>({data:row,error:null})};
  const api=loadSquareModules({mocks:{
    '@/lib/authz':{requireOwnerContext:async()=>({ok:true,admin:{from:()=>q},user:{id:ids.user}})},
    '@/lib/founding-square':{activateFounding:async()=>{calls++;}},
    '@/lib/founding-billing-activation':{ownerFoundingBillingEnabled:()=>permitted,foundingBillingDetails:async()=>({start_date:'2026-11-11',amount_cents:5000,error:null})},
  }}).load('src/app/api/admin/founding-memberships/route.ts');
  const post=amount=>api.POST(new Request('https://example.test/api/admin/founding-memberships',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:ids.household,startDate:'2026-11-11',expectedAmountCents:amount,firstVisitConfirmed:true,confirmation:'START MONTHLY BILLING'})}));
  assert.equal((await post(6000)).status,409);permitted=false;assert.equal((await post(5000)).status,403);assert.equal(calls,0);
});
