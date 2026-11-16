import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { localSquareAdmin, loadSquareModules } from './helpers/admission-pos-harness.mjs';

async function fixture(t) {
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create table open_play_reservations(id uuid primary key,household_id uuid,slot_id uuid,status text,child_ids uuid[],child_count int,payment_status text,payment_choice text,amount_cents int,square_order_id text,square_payment_link_id text,payment_url text,payment_environment text,notes text,updated_at timestamptz default now());
 create table open_play_reservation_slots(id uuid primary key,starts_at timestamptz);
 create table membership_events(id uuid primary key,household_id uuid,action text,notes text,created_by_user_id uuid,created_by_role text);`);
 const id=crypto.randomUUID(),family=crypto.randomUUID(),slot=crypto.randomUUID(),child=crypto.randomUUID(),actor=crypto.randomUUID();
 await db.query("insert into open_play_reservation_slots values($1,'2026-11-16T15:00:00Z')",[slot]);
 await db.query("insert into open_play_reservations(id,household_id,slot_id,status,child_ids,child_count,payment_status,payment_choice,amount_cents,square_order_id,square_payment_link_id,payment_url,payment_environment) values($1,$2,$3,'reserved',$4,1,'due','now',1600,'order-test','link-test','https://square.link/u/test','sandbox')",[id,family,slot,`{${child}}`]);
 const familyData={children:[{id:child,birthdate:'2025-03-13'}],memberships:[{child_ids:[child],status:'active',start_date:'2026-11-13',paid_through:'2026-12-13'}]};
 const order={id:'order-test',location_id:'test-location',reference_id:'op_'+id,state:'OPEN',total_money:{amount:1600,currency:'USD'},tenders:[]};const requests=[];
 const runtime=loadSquareModules({mocks:{'@/lib/soft-opening-family':{readSoftOpeningFamily:async()=>familyData}},fetch:async(url,opt={})=>{
  requests.push({path:new URL(url).pathname,method:opt.method||'GET'});
  if(new URL(url).pathname==='/v2/orders/order-test')return Response.json({order});
  if(new URL(url).pathname==='/v2/online-checkout/payment-links/link-test'&&opt.method==='DELETE'){order.state='CANCELED';return Response.json({id:'link-test',cancelled_order_id:'order-test'});}
  if(new URL(url).pathname==='/v2/online-checkout/payment-links/link-test')return Response.json({payment_link:{id:'link-test',order_id:'order-test'}});
  throw Error('Unexpected provider call');
 }});
 return {db,admin:localSquareAdmin(db),flow:runtime.load('src/lib/open-play-membership-repair.ts'),id,actor,requests,order,familyData};
}
test('verified membership closes unpaid checkout before changing the visit to included; retry does not call Square',async t=>{
 const h=await fixture(t);const r=await h.flow.repairOpenPlayMembership(h.admin,h.id,h.actor);assert.equal(r.status,'reserved');assert.equal(r.payment_status,'covered');assert.equal(r.payment_choice,'membership');assert.equal(r.amount_cents,0);assert.equal(r.payment_url,null);assert.equal(r.square_order_id,null);
 assert(h.requests.some(r=>r.method==='DELETE'));assert(h.requests.every(r=>['GET','DELETE'].includes(r.method)));const count=h.requests.length;await h.flow.repairOpenPlayMembership(h.admin,h.id,h.actor);assert.equal(h.requests.length,count);
 const audit=(await h.db.query('select notes from membership_events')).rows;assert.equal(audit.length,1);assert.match(audit[0].notes,/order-test/);assert.match(audit[0].notes,/1600/);
});
test('expired or partial membership cannot discard an admission charge or touch its checkout',async t=>{
 const h=await fixture(t);h.familyData.memberships[0].paid_through='2026-11-15';await assert.rejects(h.flow.repairOpenPlayMembership(h.admin,h.id,h.actor),/cover/);assert.equal(h.requests.length,0);assert.equal((await h.db.query('select amount_cents from open_play_reservations')).rows[0].amount_cents,1600);
});
test('a payment tender or mismatched order prevents reclassification and link deletion',async t=>{
 const h=await fixture(t);h.order.tenders=[{payment_id:'payment-test'}];await assert.rejects(h.flow.repairOpenPlayMembership(h.admin,h.id,h.actor),/payment|paid|review/i);assert(!h.requests.some(r=>r.method==='DELETE'));
 h.order.tenders=[];h.order.reference_id='different-reservation';await assert.rejects(h.flow.repairOpenPlayMembership(h.admin,h.id,h.actor),/match|review/i);assert(!h.requests.some(r=>r.method==='DELETE'));
});
