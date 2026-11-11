import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { loadSquareModules, localSquareAdmin, ids } from './helpers/admission-pos-harness.mjs';

const modules = loadSquareModules();
const { checkoutEventId, checkoutAdmission, getAdmissionCheckouts, admissionDayRange } = modules.load('src/lib/admission-checkout.ts');
const { admissionStayStatistics, stayMinutes, admissionDate } = modules.load('src/lib/admission-stays.ts');
const first = '50000000-0000-4000-8000-000000000001';
const second = '50000000-0000-4000-8000-000000000002';
const third = '50000000-0000-4000-8000-000000000003';
const now = new Date('2026-11-11T17:00:00Z');

async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create table checkins(id uuid primary key,person_id uuid,household_id uuid,checked_in_at timestamptz,price_cents int default 1600,payment_status text default 'due',square_environment text);
    create table people(id uuid primary key,household_id uuid,first_name text default 'Test',last_name text default 'Guest',role text default 'child',birthdate text);
    create table households(id uuid primary key,name text);
    create table admission_pos_sales(id uuid,checkin_ids uuid[],launched_at timestamptz,created_by_user_id uuid,environment text,status text);
    create table occupancy_events(id uuid primary key,created_at timestamptz default now(),effective_date date default current_date,
      event_type text check(event_type in ('checkin_increment','manual_increment','manual_decrement','reset')),delta int,created_by uuid,notes text,metadata jsonb);
    create view occupancy_status as select '2026-11-11'::date as effective_date;
    insert into households values('${ids.household}','Test Family');
    insert into people(id,household_id) values('${ids.person}','${ids.household}'),('${ids.otherPerson}','${ids.household}');
    insert into checkins(id,person_id,household_id,checked_in_at) values
      ('${first}','${ids.person}','${ids.household}','2026-11-11T15:00:00Z'),
      ('${second}','${ids.otherPerson}','${ids.household}','2026-11-11T15:30:00Z');`);
  const base = localSquareAdmin(db);
  let failWrite = false;
  const admin = { ...base, from(table) {
    const q = base.from(table);
    if (table !== 'occupancy_events') return q;
    q.upsert = (rows, options) => ({ async then(resolve) {
      if (failWrite) return resolve({ data: null, error: { message: 'offline' } });
      assert.equal(options.ignoreDuplicates, true);
      try {
        const result = await db.query(`insert into occupancy_events(id,created_at,effective_date,event_type,delta,created_by,notes,metadata)
          select x.id,x.created_at,x.effective_date,x.event_type,x.delta,x.created_by,x.notes,x.metadata
          from jsonb_to_recordset($1::jsonb) x(id uuid,created_at timestamptz,effective_date date,event_type text,delta int,created_by uuid,notes text,metadata jsonb)
          on conflict(id) do nothing returning id`, [JSON.stringify(rows)]);
        resolve({ data: result.rows, error: null });
      } catch (error) { resolve({ data: null, error: { message: error.message } }); }
    } });
    return q;
  } };
  return { db, admin, failWrites: () => { failWrite = true; } };
}

test('family checkout saves each departure and occupancy once, including retries and concurrent operators', async t => {
  const { db, admin } = await fixture(t);
  await Promise.all([
    checkoutAdmission(admin, [first, second], ids.household, ids.user, now),
    checkoutAdmission(admin, [first], ids.household, ids.other, now),
  ]);
  await checkoutAdmission(admin, [first, second], ids.household, ids.user, new Date(now.getTime() + 60000));
  const events = (await db.query('select * from occupancy_events order by id')).rows;
  assert.equal(events.length, 2);
  assert.equal(events.reduce((sum, event) => sum + event.delta, 0), -2);
  assert.ok(events.every(event => event.created_at.toISOString() === now.toISOString()));
  assert.ok(events.every(event => event.metadata.source === 'admission_checkout_v1'));
  assert.ok(events.every(event => event.effective_date.toISOString().slice(0, 10) === '2026-11-11'));
  assert.deepEqual((await db.query('select distinct payment_status from checkins')).rows, [{ payment_status: 'due' }]);
  assert.equal((await getAdmissionCheckouts(admin, [{ id: first, checked_in_at: '2026-11-11T15:00:00Z' }])).get(first), now.toISOString());
});

test('partial departures and a later arriving guest have separate durable checkout records', async t => {
  const { db, admin } = await fixture(t);
  await checkoutAdmission(admin, [first], ids.household, ids.user, now);
  await db.query('insert into checkins(id,person_id,household_id,checked_in_at) values($1,$2,$3,$4)', [third, ids.otherPerson, ids.household, now.toISOString()]);
  await checkoutAdmission(admin, [second, third], ids.household, ids.user, new Date(now.getTime() + 3600000));
  assert.equal((await db.query('select sum(delta)::int n from occupancy_events')).rows[0].n, -3);
  assert.equal((await db.query('select count(distinct id)::int n from occupancy_events')).rows[0].n, 3);
});

test('checkout rejects mixed families, old or future arrivals and failed writes without decrementing occupancy', async t => {
  const { db, admin, failWrites } = await fixture(t);
  await assert.rejects(checkoutAdmission(admin, [first], ids.other, ids.user, now), /one family/);
  await assert.rejects(checkoutAdmission(admin, [first, third], ids.household, ids.user, now), /changed/);
  await db.query('update checkins set checked_in_at=$1 where id=$2', ['2026-11-10T15:00:00Z', first]);
  await assert.rejects(checkoutAdmission(admin, [first], ids.household, ids.user, now), /today/);
  await db.query('update checkins set checked_in_at=$1 where id=$2', ['2026-11-11T18:00:00Z', first]);
  await assert.rejects(checkoutAdmission(admin, [first], ids.household, ids.user, now), /today/);
  failWrites();
  await assert.rejects(checkoutAdmission(admin, [second], ids.household, ids.user, now), /Unable to record/);
  assert.equal((await db.query('select count(*)::int n from occupancy_events')).rows[0].n, 0);
});

test('a crowd reset does not cause an earlier arrival to be removed from the count twice', async t => {
  const { db, admin } = await fixture(t);
  await db.query(`insert into occupancy_events(id,event_type,delta,effective_date,created_at) values($1,'reset',0,'2026-11-11','2026-11-11T15:15:00Z')`, [ids.klass]);
  await checkoutAdmission(admin, [first, second], ids.household, ids.user, now);
  assert.equal((await db.query('select sum(delta)::int n from occupancy_events')).rows[0].n, -1);
});

test('invalid saved departures fail visibly rather than showing a visitor as checked in again', async t => {
  const { db, admin } = await fixture(t);
  await db.query(`insert into occupancy_events(id,event_type,delta,created_at,metadata) values($1,'manual_decrement',-1,$2,'{}')`, [checkoutEventId(first), now.toISOString()]);
  await assert.rejects(getAdmissionCheckouts(admin, [{ id: first, checked_in_at: '2026-11-11T15:00:00Z' }]), /needs review/);
});

test('checkout API authorizes staff, validates selection, and uses the server operator identity', async () => {
  let calls = 0;
  const denied = loadSquareModules({ mocks: { '@/lib/authz': { requireStaffContext: async () => ({ ok: false, response: Response.json({}, { status: 403 }) }) } } }).load('src/app/api/admin/admission/checkout/route.ts');
  assert.equal((await denied.POST(new Request('https://example.test', { method: 'POST', body: '{}' }))).status, 403);
  const api = loadSquareModules({ mocks: { '@/lib/authz': { requireStaffContext: async () => ({ ok: true, user: { id: ids.user }, admin: {} }) },
    '@/lib/admission-checkout': { checkoutAdmission: async (...args) => { calls++; assert.equal(args[3], ids.user); return { checkouts: [] }; } } } }).load('src/app/api/admin/admission/checkout/route.ts');
  const request = body => new Request('https://example.test', { method: 'POST', body: JSON.stringify(body) });
  for (const checkin_ids of [[], [first, first], ['bad-id']]) assert.equal((await api.POST(request({ household_id: ids.household, checkin_ids }))).status, 400);
  assert.equal(calls, 0);
  assert.equal((await api.POST(request({ household_id: ids.household, checkin_ids: [first], created_by: ids.other }))).status, 200);
  assert.equal(calls, 1);
});

test('admission payment API retains checked-out unpaid visits and attaches stored arrival/departure times', async t => {
  const { admin } = await fixture(t);
  await checkoutAdmission(admin, [first, second], ids.household, ids.user, now);
  const api = loadSquareModules({ mocks: { '@/lib/authz': { requireStaffContext: async () => ({ ok: true, user: { id: ids.user }, admin }) },
    '@/lib/party-config': { getPartyDateKey: () => '2026-11-11', toPartyDateTimeIso: (day) => `${day}T05:00:00Z` } } }).load('src/app/api/admin/admission/pos/route.ts');
  const result = await (await api.GET()).json();
  assert.equal(result.ok, true);
  assert.equal(result.visits.length, 2);
  assert.ok(result.visits.every(visit => visit.checked_out_at === now.toISOString() && visit.checked_in_at && visit.payment_status === 'due'));
});

test('stay statistics use completed family visits and per-guest hours without estimating missing departures', () => {
  const visit = { id: first, household_id: ids.household, household_name: 'Test Family', checked_in_at: '2026-11-11T15:00:00Z', checked_out_at: '2026-11-11T17:00:00Z' };
  const result = admissionStayStatistics([visit, { ...visit, id: second, checked_in_at: '2026-11-11T15:30:00Z' },
    { ...visit, id: third, household_id: ids.other, checked_out_at: null }]);
  assert.equal(result.completed.length, 1);
  assert.equal(result.completed[0].guests, 2);
  assert.equal(result.average_minutes, 120);
  assert.equal(result.longest_minutes, 120);
  assert.equal(result.guest_minutes, 210);
  assert.equal(result.without_checkout, 1);
  assert.equal(admissionStayStatistics([{ ...visit, checked_out_at: null }]).average_minutes, null);
  assert.equal(stayMinutes(visit.checked_out_at, visit.checked_in_at), null);
  assert.equal(admissionDate('2026-11-12T00:30:00Z'), '2026-11-11');
  assert.equal(admissionStayStatistics([visit, { ...visit, id: second, checked_out_at: null }]).completed.length, 0);
});

test('report dates enforce real dates and Eastern DST boundaries and deny unauthenticated history', async () => {
  const range = admissionDayRange('2026-11-01', '2026-11-01');
  assert.equal((Date.parse(range.end) - Date.parse(range.start)) / 3600000, 25);
  for (const dates of [['2026-02-30', '2026-03-01'], ['2026-11-12', '2026-11-11'], ['2026-01-01', '2026-12-31']]) assert.throws(() => admissionDayRange(...dates));
  const api = loadSquareModules({ mocks: { '@/lib/authz': { requireStaffContext: async () => ({ ok: false, response: Response.json({}, { status: 401 }) }) } } }).load('src/app/api/admin/admission/stays/route.ts');
  assert.equal((await api.GET(new Request('https://example.test'))).status, 401);
});

test('history API reports stored departures and distinguishes incomplete visits without changing records', async t => {
  const { db, admin } = await fixture(t);
  await checkoutAdmission(admin, [first, second], ids.household, ids.user, now);
  await db.query('insert into checkins(id,person_id,household_id,checked_in_at) values($1,$2,$3,$4)', [third, ids.otherPerson, ids.other, '2026-11-11T16:00:00Z']);
  const api = loadSquareModules({ mocks: { '@/lib/authz': { requireStaffContext: async () => ({ ok: true, user: { id: ids.user }, admin }) } } }).load('src/app/api/admin/admission/stays/route.ts');
  const result = await (await api.GET(new Request('https://example.test?start=2026-11-11&end=2026-11-11'))).json();
  assert.equal(result.ok, true);
  assert.equal(result.completed.length, 1);
  assert.equal(result.completed[0].name, 'Test Family');
  assert.equal(result.average_minutes, 120);
  assert.equal(result.guest_minutes, 210);
  assert.equal(result.without_checkout, 1);
  assert.equal((await db.query('select count(*)::int n from occupancy_events')).rows[0].n, 2);
  assert.equal((await api.GET(new Request('https://example.test?start=bad'))).status, 400);
});

test('visit reports read beyond the first database page and CSV escapes names and formula prefixes', async t => {
  const { db, admin } = await fixture(t);
  await checkoutAdmission(admin, [first, second], ids.household, ids.user, now);
  await db.exec(`insert into checkins(id,person_id,household_id,checked_in_at)
    select gen_random_uuid(),'${ids.otherPerson}','${ids.other}','2026-11-11T16:00:00Z'::timestamptz from generate_series(1,501);`);
  const api = loadSquareModules({ mocks: { '@/lib/authz': { requireStaffContext: async () => ({ ok: true, user: { id: ids.user }, admin }) } } }).load('src/app/api/admin/admission/stays/route.ts');
  const result = await (await api.GET(new Request('https://example.test?start=2026-11-11&end=2026-11-11'))).json();
  assert.equal(result.completed_guests, 2);
  assert.equal(result.without_checkout, 501);
  const { admissionStayCsv } = modules.load('src/lib/admission-stays.ts');
  const csv = admissionStayCsv([{ ...result.completed[0], name: '  =DANGEROUS("name")' }]);
  assert.ok(csv.includes('"\'  =DANGEROUS(""name"")"'));
  assert.ok(csv.includes('"10:00 AM","12:00 PM","120"'));
});
