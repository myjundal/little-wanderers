import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadModule } from './helpers/class-preregistration-harness.mjs';
const config = loadModule('src/lib/party-config.ts');
const availability = loadModule('src/lib/private-party-open-play.ts', { '@/lib/party-config': config });
const iso = (date, hour) => config.toPartyDateTimeIso(date, hour);

async function fixture() {
 const db = new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create table party_bookings(id uuid primary key default gen_random_uuid(),start_time timestamptz not null,end_time timestamptz not null,status text not null default 'confirmed');
 create table open_play_reservation_slots(id uuid primary key default gen_random_uuid(),starts_at timestamptz,ends_at timestamptz,capacity_children int default 10,capacity_total int,status text default 'open',is_soft_opening bool default true);
 create table open_play_reservations(id uuid primary key default gen_random_uuid(),slot_id uuid,household_id uuid default gen_random_uuid(),child_count int default 1,adult_count int default 1,status text default 'reserved');`);
 await db.exec(fs.readFileSync('db/migrations/20261016_open_play_capacity_guard.sql', 'utf8'));
 await db.exec(fs.readFileSync('db/migrations/20261112_private_party_open_play.sql', 'utf8'));
 const party = async (date, isPrivate = false) => (await db.query('insert into party_bookings(start_time,end_time,is_private) values($1,$2,$3) returning id', [iso(date,15),iso(date,18),isPrivate])).rows[0].id;
 const slot = async (date,hour,status='open') => (await db.query('insert into open_play_reservation_slots(starts_at,ends_at,status) values($1,$2,$3) returning id',[iso(date,hour),iso(date,hour+1),status])).rows[0].id;
 const reserve = async (slotId, children=1) => (await db.query('insert into open_play_reservations(slot_id,child_count) values($1,$2) returning id',[slotId,children])).rows[0].id;
 return {db,party,slot,reserve};
}

test('private party checkbox blocks both 4–6pm windows while preserving adjacent arrivals and manual closures', async t => {
 const h=await fixture();t.after(()=>h.db.close());
 const date='2099-11-16',party=await h.party(date);
 const slots=await Promise.all([15,16,17,18].map(hour=>h.slot(date,hour)));
 const manual=await h.slot(date,14,'closed');
 const before=(await h.db.query('select * from open_play_reservation_slots order by id')).rows;
 await h.db.query('update party_bookings set is_private=true where id=$1',[party]);
 await h.reserve(slots[0]); await h.reserve(slots[3]);
 await assert.rejects(h.reserve(slots[1]),/private party/);await assert.rejects(h.reserve(slots[2]),/private party/);
 await assert.rejects(h.reserve(manual),/not open/);
 await h.db.query('update party_bookings set is_private=false where id=$1',[party]);
 await h.reserve(slots[1]);await assert.rejects(h.reserve(manual),/not open/);
 assert.deepEqual((await h.db.query('select * from open_play_reservation_slots order by id')).rows,before);
});

test('existing reservations survive a private setting; attendance and cancellation remain possible but expansions and restores are blocked', async t => {
 const h=await fixture();t.after(()=>h.db.close());const date='2099-11-16';
 const party=await h.party(date),slot=await h.slot(date,16),reservation=await h.reserve(slot,2);
 await h.db.query('update party_bookings set is_private=true where id=$1',[party]);
 assert.equal((await h.db.query('select count(*)::int n from open_play_reservations')).rows[0].n,1);
 await assert.rejects(h.db.query('update open_play_reservations set child_count=3 where id=$1',[reservation]),/private party/);
 await h.db.query("update open_play_reservations set status='checked_in',child_count=1 where id=$1",[reservation]);
 await h.db.query("update open_play_reservations set status='cancelled' where id=$1",[reservation]);
 await assert.rejects(h.db.query("update open_play_reservations set status='reserved' where id=$1",[reservation]),/private party/);
});

test('blocks follow date changes and cancellation, and another private party still keeps the old date blocked', async t => {
 const h=await fixture();t.after(()=>h.db.close());const first='2099-11-16',second='2099-11-17';
 const p=await h.party(first,true),other=await h.party(first,true),one=await h.slot(first,16),two=await h.slot(second,16);
 await h.db.query('update party_bookings set start_time=$1,end_time=$2 where id=$3',[iso(second,15),iso(second,18),p]);
 await assert.rejects(h.reserve(one),/private party/);await assert.rejects(h.reserve(two),/private party/);
 await h.db.query("update party_bookings set status='cancelled' where id=$1",[other]);await h.reserve(one);
 await h.db.query("update party_bookings set status='cancelled' where id=$1",[p]);await h.reserve(two);
});

test('database refuses direct customer private flags and movement of a private block, while service writes remain available', async t => {
 const h=await fixture();t.after(()=>h.db.close());const date='2099-11-16',p=await h.party(date);
 for(const role of ['anon','authenticated']) {
  await h.db.query("select set_config('request.jwt.claim.role',$1,false)",[role]);
  await assert.rejects(h.db.query('update party_bookings set is_private=true where id=$1',[p]),/authorized operator/);
  await assert.rejects(h.party(date,true),/authorized operator/);
 }
 await h.db.query("select set_config('request.jwt.claim.role','service_role',false)");
 await h.db.query('update party_bookings set is_private=true where id=$1',[p]);
 await h.db.query("select set_config('request.jwt.claim.role','authenticated',false)");
 await assert.rejects(h.db.query('update party_bookings set start_time=$1 where id=$2',[iso('2099-11-17',15),p]),/authorized operator/);
 for(const role of ['anon','authenticated']) assert.equal((await h.db.query("select has_function_privilege($1,'public.private_party_blocks_open_play(timestamptz,timestamptz)','execute') allowed",[role])).rows[0].allowed,false);
});

test('private windows use Eastern 4–6pm across DST and correctly handle custom overlapping visit windows', () => {
 for(const [date,utcHour] of [['2027-03-13',21],['2027-03-14',20],['2027-11-06',20],['2027-11-07',21]]) {
  const block=availability.privatePartyWindow(iso(date,15));assert.equal(new Date(block.starts_at).getUTCHours(),utcHour);
  assert.equal(availability.overlapsPrivateParty({starts_at:iso(date,15),ends_at:iso(date,16)},[block]),false);
  assert.equal(availability.overlapsPrivateParty({starts_at:iso(date,18),ends_at:iso(date,19)},[block]),false);
  assert.equal(availability.overlapsPrivateParty({starts_at:iso(date,15),ends_at:iso(date,17)},[block]),true);
 }
});

test('availability reads only active private dates and fails closed on source failure or truncation', async () => {
 let failure=false,oversized=false;const calls=[];
 const admin={from(table){assert.equal(table,'party_bookings');const q={select(){return q;},eq(...args){calls.push(args);return q;},neq(...args){calls.push(args);return q;},gte(){return q;},lt(){return q;},order(){return q;},async limit(){return {data:oversized?Array.from({length:1000},()=>({start_time:iso('2027-11-07',15)})):[{start_time:iso('2027-11-07',15)}],error:failure?{}:null};}};return q;}};
 const windows=[{id:'visit',starts_at:iso('2027-11-07',16),ends_at:iso('2027-11-07',17)}];
 assert.equal((await availability.readPrivatePartyDays(admin,windows)).length,1);
 assert.deepEqual(calls,[['is_private',true],['status','cancelled']]);
 failure=true;await assert.rejects(availability.readPrivatePartyDays(admin,windows),/Unable to verify/);
 failure=false;oversized=true;await assert.rejects(availability.readPrivatePartyDays(admin,windows),/Unable to verify/);
 assert.deepEqual(Array.from(await availability.readPrivatePartyDays(admin,[])),[]);
});

test('customer and staff calendars derive a private closure, and customer POST refuses it before saving family data', async () => {
 const slot={id:'10000000-0000-4000-8000-000000000001',starts_at:iso('2099-11-16',16),ends_at:iso('2099-11-16',17),status:'open',capacity_children:10};
 const blocks=[availability.privatePartyWindow(iso('2099-11-16',15))];let writes=0,familySaves=0,failAvailability=false;
 const admin={from(table){const q={select(){return q;},eq(){return q;},in(){return q;},neq(){return q;},gte(){return q;},gt(){return q;},lt(){return q;},order(){return q;},limit(){return q;},range(){return q;},insert(){writes++;return q;},async maybeSingle(){return {data:table==='open_play_reservation_slots'?slot:null,error:null};},then(resolve){resolve({data:table==='open_play_reservation_slots'?[slot]:[],error:null});}};return q;}};
 const mocks={
  '@/lib/private-party-open-play':{...availability,readPrivatePartyDays:async()=>{if(failAvailability)throw Error('Unable to verify private-party availability.');return blocks;}},
  '@/lib/party-config':config,'@/lib/open-play-reservations':loadModule('src/lib/open-play-reservations.ts'),
  'next/server':{NextResponse:{json:Response.json}},'@vercel/functions':{},'@/lib/admin-notifications':{},'@/lib/open-play-confirmation':{},'@/lib/logger':{},
  '@/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},'@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'parent',email:'parent@example.test'}}})}})},
  '@/lib/households':{getLatestHouseholdIdForUser:async()=> 'family'},'@/lib/soft-opening-access':{getSoftOpeningAccessForUser:async()=>({allowed:true})},
  '@/lib/soft-opening-family':{readSoftOpeningFamily:async()=>({children:[]}),saveSoftOpeningFamily:async()=>{familySaves++;return {};}},'@/lib/soft-opening-pricing':{},
  '@/lib/authz':{requireStaffContext:async()=>({ok:true,admin})},'@/lib/waivers':{},'@/lib/reservation-admission-status':{getReservationAdmissionStatuses:async()=>new Map()},'@/lib/square-client':{squareEnvironment:()=> 'production'},
 };
 const customer=loadModule('src/app/api/open-play-reservations/route.ts',mocks),staff=loadModule('src/app/api/admin/open-play-reservations/route.ts',mocks);
 const publicData=await (await customer.GET(new Request('https://example.test/api'))).json();assert.equal(publicData.slots[0].is_closed,true);assert.equal(publicData.slots[0].is_private_party_blocked,true);assert.equal(publicData.private_party_days.length,1);
 const staffData=await (await staff.GET()).json();assert.equal(staffData.slots[0].status,'closed');assert.equal(slot.status,'open');
 // Substitute only the reservation date horizon so this future fixture remains valid.
 mocks['@/lib/open-play-reservations']={...mocks['@/lib/open-play-reservations'],SOFT_OPENING_END:'2100-01-01'};
 const route=loadModule('src/app/api/open-play-reservations/route.ts',mocks);
 const request={json:async()=>({slot_id:slot.id,children:[{id:'child'}],payment_choice:'counter',adult_count:1})};
 const response=await route.POST(request);assert.equal(response.status,409);assert.equal((await response.json()).code,'private_party');assert.equal(writes,0);assert.equal(familySaves,0);
 failAvailability=true;assert.equal((await route.POST(request)).status,500);assert.equal(writes,0);assert.equal(familySaves,0);
});
