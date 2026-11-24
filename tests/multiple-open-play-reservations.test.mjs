import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const policy = loadModule('src/lib/open-play-reservations.ts');
const slotId = '10000000-0000-4000-8000-000000000001';
const otherSlotId = '10000000-0000-4000-8000-000000000002';
const slot = { id: slotId, starts_at: '2026-11-19T14:00:00Z', ends_at: '2026-11-19T15:00:00Z', status: 'open', capacity_children: 6, remaining_children: 5 };
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-18T14:00:00Z'])); } static now() { return Date.parse('2026-11-18T14:00:00Z'); } }

function apiHarness(existingSlot, familyError = null) {
  const writes = [], background = [];
  const admin = { from(table) {
    const filters = [];
    let inserted;
    const q = { select() { return q; }, eq(k,v) { filters.push([k,v]); return q; }, neq() { return q; }, limit() { return q; },
      insert(row) { inserted = row; writes.push(row); return q; },
      async maybeSingle() {
        const duplicate = existingSlot && filters.every(([k,v]) => k !== 'slot_id' || v === existingSlot);
        return { data: table === 'households' ? {} : table === 'open_play_reservation_slots' ? slot : inserted ? { ...inserted, id: 'new-visit' } : duplicate ? { id: 'existing' } : null, error: null };
      },
    }; return q;
  } };
  const api = loadModule('src/app/api/open-play-reservations/route.ts', {
    'next/server': { NextResponse: { json: Response.json } }, '@vercel/functions': { waitUntil: p => background.push(p) },
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({auth:{getUser:async()=>({data:{user:{id:'parent',email:'parent@example.test'}}})}}) },
    '@/lib/households': { getLatestHouseholdIdForUser: async () => 'family' },
    '@/lib/soft-opening-access': { getSoftOpeningAccessForUser: async () => ({ allowed: true }) },
    '@/lib/open-play-reservations': { ...policy, getReservationOccupancy: async () => ({ children: 0, total: 0 }) },
    '@/lib/soft-opening-family': { saveSoftOpeningFamily: async () => { if (familyError) throw familyError; return { childIds: ['child'], memberships: [], guardianName: 'Parent', children: [{name:'Child'}] }; } },
    '@/lib/soft-opening-pricing': { softOpeningAmount: () => 1600 },
    '@/lib/open-play-quote': {}, '@/lib/party-config': loadModule('src/lib/party-config.ts'),
    '@/lib/private-party-open-play': { readPrivatePartyDays: async () => [], overlapsPrivateParty: () => false },
    '@/lib/admin-notifications': { sendOpenPlayReservationNotification: async () => ({ok:true}) },
    '@/lib/open-play-confirmation': { sendOpenPlayConfirmation: async () => ({ok:true}) },
    '@/lib/logger': { logger: { warn() {}, error() {} } },
  }, { Date: FixedDate });
  return { writes, background, post: () => api.POST({json:async()=>({slot_id:slotId,children:[{name:'Child'}],payment_choice:'counter',adult_count:1})}) };
}

test('customer API permits another visit while rejecting the same household arrival window', async () => {
  for (const [existing, status] of [[otherSlotId,200],[slotId,409]]) {
    const h = apiHarness(existing);
    assert.equal((await h.post()).status, status);
    assert.equal(h.writes.length, status === 200 ? 1 : 0);
    await Promise.all(h.background);
  }
});

function nodes(tree) { const all=[]; function walk(n) { if(Array.isArray(n)) return n.forEach(walk); if(!React.isValidElement(n)) return; all.push(n); walk(n.props.children); } walk(tree); return all; }
test('all upcoming visits remain visible alongside the booking form, with independent actions and duplicate window prevention', async () => {
  const anotherSlot = {...slot,id:otherSlotId,starts_at:'2026-11-20T14:00:00Z',ends_at:'2026-11-20T15:00:00Z'};
  const data = {ok:true,slots:[slot,anotherSlot],reservations:[
    {id:'second',slot:anotherSlot,slot_id:otherSlotId,status:'reserved',payment_status:'paid',payment_choice:'now',amount_cents:1600,child_count:1},
    {id:'first',slot,slot_id:slotId,status:'reserved',payment_status:'due',payment_choice:'counter',amount_cents:1600,child_count:1},
    {id:'cancelled',slot,status:'cancelled'},
  ],family:{guardian:null,children:[],memberships:[]}};
  const state=[data,false,'','','2026-11-19',slotId,'Parent','Family',[{id:'child',name:'Child',selected:true}],'1','counter','',false];
  let i=0; const requests=[];
  const Component = loadModule('src/components/soft-opening/SoftOpeningReservation.tsx', {
    react:{...React,useEffect(){},useCallback:fn=>fn,useState:initial=>{const index=i++;return [state[index]??initial,next=>{state[index]=typeof next==='function'?next(state[index]):next;}];}},
    '@/components/waivers/BookingWaiverNextStep': () => null, 'next/link':'a','next/image':'img','./soft-opening.module.css':{},'@/lib/open-play-reservations':policy,
    '@/lib/birthdate':loadModule('src/lib/birthdate.ts'),'@/lib/open-play-birthdate':{parseOpenPlayBirthdate:value=>loadModule('src/lib/birthdate.ts').parseBirthdate(value ?? '')},'@/lib/soft-opening-pricing':{softOpeningAmount:()=>1600},
  }, {React,Intl,Date:FixedDate,fetch:async(url,options)=>{requests.push([url,options]);return Response.json(options?{ok:true}:data);}}).default;
  const tree=Component({previewData:data,publicBooking:true}); const html=renderToStaticMarkup(tree);
  assert.ok(html.indexOf('Thursday, November 19') < html.indexOf('Friday, November 20'));
  const links=nodes(tree).filter(n=>n.type==='a').map(n=>n.props.href);
  assert.ok(!links.some(href => href.startsWith('/landing/waiver'))); // Preview never prompts for a real signature.
  assert.ok(!links.includes('/landing/waiver?reservation=cancelled'));
  assert.equal(nodes(tree).filter(n=>n.type==='form').length,1);
  assert.match(html,/You can reserve multiple visits/);
  assert.equal(nodes(tree).find(n=>n.type==='button'&&n.key===slotId).props.disabled,true);
  assert.equal(nodes(tree).find(n=>n.type==='button'&&n.props.type==='submit').props.disabled,true);
  const cancel=nodes(tree).find(n=>n.type==='button'&&n.props.children==='Cancel reservation');
  await cancel.props.onClick();
  assert.equal(requests[0][0],'/api/open-play-reservations/first');
  assert.equal(requests[0][1].method,'PATCH');
  assert.equal(nodes(tree).filter(n=>n.type==='button'&&n.props.children==='Cancel reservation').length,1);
});

test('database allows multiple future visits and preserves duplicates, capacity, closed windows, private-party guards and rebooking', async t => {
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table households(id uuid primary key);create table people(id uuid primary key,role text);create table checkins(id uuid primary key,person_id uuid,household_id uuid,checked_in_at timestamptz,price_cents integer,payment_status text,square_environment text,square_order_id text);create table party_bookings(id uuid primary key,start_time timestamptz,status text);create function set_updated_at() returns trigger language plpgsql as $$begin return new;end$$;create function fixture_now() returns timestamptz language sql immutable as $$select '2026-11-09T12:00:00Z'::timestamptz$$;`);
  for(const name of ['20260911_open_play_reservations.sql','20261016_open_play_capacity_guard.sql','20261109_soft_opening_reservations.sql','20261112_private_party_open_play.sql']) await db.exec(fs.readFileSync(`db/migrations/${name}`,'utf8').replace(/\bnow\(\)/g,'fixture_now()'));
  const family=crypto.randomUUID(),other=crypto.randomUUID();await db.query('insert into households values($1),($2)',[family,other]);
  const slots=(await db.query("select id from open_play_reservation_slots where status='open' order by starts_at limit 3")).rows;
  const reserve=(slotIndex,h=family,n=1)=>db.query('insert into open_play_reservations(slot_id,household_id,child_count,adult_count) values($1,$2,$3,1) returning id',[slots[slotIndex].id,h,n]);
  const first=(await reserve(0)).rows[0].id;
  await assert.rejects(reserve(1),/already have/);
  const migration=fs.readFileSync('db/migrations/20261118_multiple_open_play_reservations.sql','utf8');
  await db.exec(migration);await db.exec(migration);
  await reserve(1);await reserve(2);
  assert.equal((await db.query('select count(*)::int n from open_play_reservations where household_id=$1',[family])).rows[0].n,3);
  await assert.rejects(reserve(0),/unique constraint/);
  await assert.rejects(reserve(0,other,5),/full/);
  await db.query("update open_play_reservations set status='cancelled' where id=$1",[first]);
  await reserve(0);
  assert.equal((await db.query('select status from open_play_reservations where id=$1',[first])).rows[0].status,'cancelled');
  await db.query("update open_play_reservation_slots set status='closed' where id=$1",[slots[1].id]);
  await assert.rejects(reserve(1,other),/not open/);
  await db.query("insert into party_bookings(id,start_time,status,is_private) values($1,'2026-11-20T21:00Z','confirmed',true)",[crypto.randomUUID()]);
  const blocked=(await db.query("select id from open_play_reservation_slots where starts_at='2026-11-20T21:00Z'")).rows[0].id;
  await assert.rejects(db.query('insert into open_play_reservations(slot_id,household_id,child_count,adult_count) values($1,$2,1,1)',[blocked,other]),/private party/);
});

test('invalid birthday feedback returns a correctable request error before reservation or notification writes', async () => {
  const h = apiHarness(null, Object.assign(new Error('Please enter the actual birthday.'), {code:'invalid_birthdate'}));
  const response = await h.post(); assert.equal(response.status, 400); assert.match((await response.json()).error, /birthday/);
  assert.equal(h.writes.length, 0); assert.equal(h.background.length, 0);
});
