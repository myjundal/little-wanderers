import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import {loadSquareModules} from './helpers/admission-pos-harness.mjs';
const {load}=loadSquareModules();
const {softOpeningAmount}=load('src/lib/soft-opening-pricing.ts');
test('per-visit pricing covers only enrolled children and honors paid-through dates',()=>{
 assert.equal(softOpeningAmount(['a'],[],'2026-11-11'),1600);
 assert.equal(softOpeningAmount(['a','b','c'],[],'2026-11-11'),3600);
 const pending=[{child_ids:['a'],status:'pending',start_date:null,paid_through:null}];
 assert.equal(softOpeningAmount(['a'],pending,'2026-11-11'),0);
 assert.equal(softOpeningAmount(['a','b'],pending,'2026-11-11'),1600);
 assert.equal(softOpeningAmount(['a'],[{...pending[0],status:'canceled',start_date:'2026-10-01',paid_through:'2026-11-10'}],'2026-11-11'),1600);
});
async function setup(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table households(id uuid primary key);create table people(id uuid primary key,role text);create table checkins(id uuid primary key,person_id uuid,household_id uuid,checked_in_at timestamptz default now(),price_cents integer,payment_status text,square_environment text,square_order_id text);create function set_updated_at() returns trigger language plpgsql as $$begin return new;end$$;`);await db.exec(fs.readFileSync('db/migrations/20260911_open_play_reservations.sql','utf8'));await db.exec(fs.readFileSync('db/migrations/20261016_open_play_capacity_guard.sql','utf8'));await db.exec(fs.readFileSync('db/migrations/20261109_soft_opening_reservations.sql','utf8'));return db;}
test('schedule has 5 hourly child spots: Nov 11–15 9–2, Nov 16–Dec 31 9–5',async t=>{const db=await setup();t.after(()=>db.close());const {rows}=await db.query(`select (starts_at at time zone 'America/New_York')::date::text as "day",count(*)::int n,min(extract(hour from starts_at at time zone 'America/New_York'))::int first,max(extract(hour from ends_at at time zone 'America/New_York'))::int last,min(capacity_children)::int cap from open_play_reservation_slots where status='open' group by 1 order by 1`);assert.equal(rows.length,51);assert.deepEqual(rows[0],{day:'2026-11-11',n:5,first:9,last:14,cap:5});assert.deepEqual(rows.at(-1),{day:'2026-12-31',n:8,first:9,last:17,cap:5});assert(rows.slice(5).every(r=>r.n===8&&r.last===17));});
test('database capacity guard prevents sixth child and permits rebooking after cancellation',async t=>{const db=await setup();t.after(()=>db.close());const slot=(await db.query("select id from open_play_reservation_slots where status='open' order by starts_at limit 1")).rows[0].id;const family=crypto.randomUUID(),other=crypto.randomUUID();await db.query('insert into households values($1),($2)',[family,other]);const reserve=async(h,n)=>db.query("insert into open_play_reservations(slot_id,household_id,child_count,adult_count) values($1,$2,$3,1) returning id",[slot,h,n]);const one=await reserve(family,4);await assert.rejects(reserve(other,2),/full/);await reserve(other,1);await assert.rejects(reserve(family,1),/already/);await db.query("update open_play_reservations set status='cancelled' where id=$1",[one.rows[0].id]);await reserve(family,4);});
test('completed payment requires matching provider order, receipts, currency and total; URL return is no proof',async()=>{
 const r={id:crypto.randomUUID(),amount_cents:2600,payment_choice:'now',payment_status:'due',square_order_id:'order',payment_environment:'sandbox',created_at:'2026-11-09T12:00:00Z'};
 let state='OPEN',amount=2600,currency='USD',refund=0,fulfilled=0;
 const {load}=loadSquareModules({fetch:async url=>Response.json(url.includes('/orders/')?{order:{id:'order',reference_id:`op_${r.id}`,location_id:'test-location',state,total_money:{amount:2600,currency:'USD'},net_amount_due_money:{amount:0,currency:'USD'},tenders:[{payment_id:'receipt'}]}}:{payment:{id:'receipt',order_id:'order',location_id:'test-location',status:'COMPLETED',amount_money:{amount,currency},refunded_money:{amount:refund},created_at:'2026-11-09T12:01:00Z'}})});
 const f=load('src/lib/soft-opening-payments.ts');const db={rpc:async()=>{fulfilled++;return {data:{...r,payment_status:'paid'},error:null};}};
 assert.equal((await f.verifyOpenPlayPayment(db,r)).payment_status,'due');assert.equal(fulfilled,0);state='COMPLETED';assert.equal((await f.verifyOpenPlayPayment(db,r)).payment_status,'paid');assert.equal(fulfilled,1);
 amount=1600;await assert.rejects(f.verifyOpenPlayPayment(db,r),/amount/);amount=2600;currency='CAD';await assert.rejects(f.verifyOpenPlayPayment(db,r),/review/);currency='USD';refund=100;await assert.rejects(f.verifyOpenPlayPayment(db,r),/review/);
});
test('check-in uses $16/$10 for counter visits and consumes only named, same-date prepaid children',async t=>{
 const db=await setup();t.after(()=>db.close());const slot=(await db.query("select id from open_play_reservation_slots where status='open' order by starts_at limit 1")).rows[0].id;
 for(const prepaid of [false,true]){
  const family=crypto.randomUUID(),a=crypto.randomUUID(),b=crypto.randomUUID(),extra=crypto.randomUUID();await db.query('insert into households values($1)',[family]);await db.query("insert into people values($1,'child'),($2,'child'),($3,'child')",[a,b,extra]);
  const r=(await db.query("insert into open_play_reservations(slot_id,household_id,child_count,adult_count,child_ids,amount_cents,payment_choice,payment_status,payment_environment) values($1,$2,2,1,$3,2600,$4,$5,'production') returning id",[slot,family,[a,b],prepaid?'now':'counter',prepaid?'paid':'due'])).rows[0];
  for(const [person,expected]of [[a,prepaid?0:1600],[b,prepaid?0:1000],[extra,1600]]){const id=crypto.randomUUID();await db.query("insert into checkins(id,person_id,household_id,checked_in_at,price_cents,payment_status) values($1,$2,$3,'2026-11-11T15:00:00Z',1600,'due')",[id,person,family]);const saved=(await db.query('select price_cents,payment_status from checkins where id=$1',[id])).rows[0];assert.equal(saved.price_cents,expected);if(prepaid&&person!==extra)assert.equal(saved.payment_status,'prepaid');}
  const anotherDay=crypto.randomUUID();await db.query("insert into checkins(id,person_id,household_id,checked_in_at,price_cents,payment_status) values($1,$2,$3,'2026-11-12T15:00:00Z',1600,'due')",[anotherDay,a,family]);assert.equal((await db.query('select price_cents from checkins where id=$1',[anotherDay])).rows[0].price_cents,1600);
  await db.query("update open_play_reservations set status='cancelled' where id=$1",[r.id]);
 }
});
