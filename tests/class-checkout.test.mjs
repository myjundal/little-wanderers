import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { localSquareAdmin, loadSquareModules } from './helpers/admission-pos-harness.mjs';

async function fixture(t, overrides={}) {
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(fs.readFileSync('tests/fixtures/class-checkout-installed.sql','utf8'));
 const user=crypto.randomUUID(),family=crypto.randomUUID(),child=crypto.randomUUID(),sibling=crypto.randomUUID();
 const sessions=[crypto.randomUUID(),crypto.randomUUID()];
 await db.query('insert into auth.users values($1)',[user]);
 await db.query("insert into households values($1,'fictional@example.invalid')",[family]);
 await db.query("insert into people(id,household_id,role,first_name) values($1,$3,'child','Selected'),($2,$3,'child','Sibling')",[child,sibling,family]);
 await db.query("insert into classes values($1,'Baby Music','scheduled',3000,2,'2026-11-17T15:00:00Z'),($2,'Toddler Yoga','scheduled',2500,2,'2026-11-18T15:30:00Z')",sessions);
 const admin=localSquareAdmin(db),orders=new Map(),payments=new Map(),requests=[];
 const provider=async(url,options={})=>{
  const path=new URL(url).pathname,body=options.body&&JSON.parse(options.body); requests.push({path,method:options.method??'GET',body});
  if(options.method==='POST'&&path==='/v2/online-checkout/payment-links') {
   const id=body.order.reference_id,orderId='order-'+id;
   if(!orders.has(orderId))orders.set(orderId,{id:orderId,location_id:'test-location',reference_id:id,state:'OPEN',total_money:{currency:'USD',amount:body.order.line_items.reduce((sum,line)=>sum+line.base_price_money.amount*Number(line.quantity),0)}});
   return Response.json({payment_link:{id:'link-'+id,order_id:orderId,url:'https://sandbox.square.link/u/'+id}});
  }
  if(path.startsWith('/v2/orders/'))return Response.json({order:orders.get(path.split('/').at(-1))});
  if(path.startsWith('/v2/payments/'))return Response.json({payment:payments.get(path.split('/').at(-1))});
  if(options.method==='DELETE'&&path.startsWith('/v2/online-checkout/payment-links/')) {
   if(overrides.deleteFails)return Response.json({errors:[{code:'INTERNAL_ERROR'}]},{status:500});
   const id=path.split('/').at(-1).slice(5);orders.get('order-'+id).state='CANCELED';
   return Response.json({id:'link-'+id,cancelled_order_id:'order-'+id});
  }
  throw Error('Unexpected provider request '+path);
 };
 const runtime=loadSquareModules({fetch:provider});
 const flow=runtime.load('src/lib/class-checkout.ts');
 const request=flow.classCheckoutRequest({person_id:child,items:sessions.map(class_id=>({class_id}))});
 const start=()=>flow.startClassCheckout(admin,{householdId:family,userId:user,email:'fictional@example.invalid',request});
 const pay=(attempt,patch={})=>{
  const order=orders.get(attempt.order_id),id='receipt-'+attempt.id;
  order.tenders=[{payment_id:id}];order.net_amount_due_money={amount:0,currency:'USD'};
  payments.set(id,{id,order_id:order.id,location_id:'test-location',status:'COMPLETED',amount_money:{amount:attempt.expected_amount_cents,currency:'USD'},created_at:new Date().toISOString(),updated_at:new Date().toISOString(),...patch});
 };
 return {db,admin,user,family,child,sibling,sessions,flow,request,start,pay,requests,orders,payments};
}

test('new families can buy multiple dates once; server pricing and selected child are retained across retries',async t=>{
 const h=await fixture(t),a=await h.start();
 assert.equal(a.expected_amount_cents,5500);assert.equal(a.payload.assignments.length,2);
 assert(a.payload.assignments.every(r=>r.person_id===h.child));
 assert.equal((await h.start()).id,a.id);
 assert.equal(h.requests.filter(r=>r.method==='POST'&&r.path.includes('payment-links')).length,1);
 assert.equal((await h.db.query('select count(*)::int n from class_registrations')).rows[0].n,0);
 const lines=h.requests.find(r=>r.body?.order).body.order.line_items;
 assert(lines.every(l=>/Nov 1[78]/.test(l.note)));
 assert.equal((await h.flow.reconcileClassCheckout(h.admin,a)).status,'open');
});

test('completed exact-amount Square receipts atomically confirm all dates and preserve preregistration IDs',async t=>{
 const h=await fixture(t),existing=crypto.randomUUID();
 await h.db.query("insert into class_registrations(id,class_id,person_id,household_id,child_id,status) values($1,$2,$3,$4,$3,'preregistered')",[existing,h.sessions[0],h.child,h.family]);
 const a=await h.start();h.pay(a);
 const paid=await h.flow.reconcileClassCheckout(h.admin,a);assert.equal(paid.status,'completed');
 const regs=(await h.db.query('select * from class_registrations')).rows;
 assert.equal(regs.length,2);assert(regs.every(r=>r.person_id===h.child&&r.status==='scheduled'));
 assert(regs.some(r=>r.id===existing));assert.equal(paid.payload.summary.total_price_cents,5500);
 assert.equal((await h.flow.reconcileClassCheckout(h.admin,paid)).status,'completed');
 assert.equal((await h.db.query('select count(*)::int n from square_payment_receipts')).rows[0].n,1);
});

test('forged redirects, short payments, foreign receipts, pending/refunded payments and duplicate tenders cannot confirm seats',async t=>{
 for(const patch of [{status:'PENDING'},{amount_money:{amount:5000,currency:'USD'}},{order_id:'foreign'},{id:'different'},{refunded_money:{amount:1}},{tip_money:{amount:1}},{created_at:'2020-01-01'}]){
  const h=await fixture(t),a=await h.start();h.pay(a,patch);
  await assert.rejects(h.flow.reconcileClassCheckout(h.admin,a));
  assert.equal((await h.db.query('select count(*)::int n from class_registrations')).rows[0].n,0);
 }
 const h=await fixture(t),a=await h.start();h.pay(a);h.orders.get(a.order_id).tenders.push(h.orders.get(a.order_id).tenders[0]);
 await assert.rejects(h.flow.reconcileClassCheckout(h.admin,a),/receipts/);
});

test('unpaid checkout closes at Square before capacity is released, and failed deletion keeps it open',async t=>{
 for(const deleteFails of [false,true]){
  const h=await fixture(t,{deleteFails}),a=await h.start();
  if(deleteFails){await assert.rejects(h.flow.closeClassCheckout(h.admin,a),/not closed/);assert.equal((await h.flow.readClassCheckout(h.admin,h.family)).status,'open');}
  else {assert.equal((await h.flow.closeClassCheckout(h.admin,a)).status,'cancelled');assert.equal(await h.flow.readClassCheckout(h.admin,h.family),null);}
 }
});

test('payment completed before cancellation confirms seats instead of closing its page',async t=>{
 const h=await fixture(t),a=await h.start();h.pay(a);
 assert.equal((await h.flow.closeClassCheckout(h.admin,a)).status,'completed');
 assert.equal(h.requests.some(r=>r.method==='DELETE'),false);
});

test('a selected child already confirmed cannot be silently replaced by a sibling; other-family children are rejected',async t=>{
 const h=await fixture(t);
 await h.db.query("insert into class_registrations(class_id,person_id,household_id,child_id,status) values($1,$2,$3,$2,'scheduled')",[h.sessions[1],h.child,h.family]);
 await assert.rejects(h.start(),/Selected participant/);
 const foreign=crypto.randomUUID();
 await assert.rejects(h.flow.startClassCheckout(h.admin,{householdId:h.family,userId:h.user,request:{...h.request,person_id:foreign}}),/in your family/);
 assert.equal((await h.db.query('select count(*)::int n from square_checkout_attempts')).rows[0].n,0);
});

test('closed, Thanksgiving, post-term dates and Jamie single sessions cannot enter general checkout',async t=>{
 for(const patch of ["status='cancelled'","start_time='2026-11-26T15:00:00Z'","start_time='2026-12-21T15:00:00Z'","title='Little Hands, Big Canvases'"]){
  const h=await fixture(t);await h.db.query('update classes set '+patch+' where id=$1',[h.sessions[0]]);
  await assert.rejects(h.start(),/Choose an available|separate five-session/);
  assert.equal(h.requests.length,0);
 }
});

test('atomic checkout holds prevent another family from being charged for the last seat',async t=>{
 const h=await fixture(t);await h.db.exec('update classes set capacity=1');await h.start();
 const other=crypto.randomUUID(),child=crypto.randomUUID();
 await h.db.query("insert into households values($1,'other@example.invalid')",[other]);
 await h.db.query("insert into people(id,household_id,role,first_name) values($1,$2,'child','Other')",[child,other]);
 await assert.rejects(h.flow.startClassCheckout(h.admin,{householdId:other,userId:h.user,request:{...h.request,person_id:child}}),/enough seats/);
 assert.equal(h.requests.filter(r=>r.method==='POST'&&r.path.includes('payment-links')).length,1);
});

test('a verified payment with a changed class is retained for staff review without confirming any partial basket',async t=>{
 const h=await fixture(t),a=await h.start();h.pay(a);await h.db.query("update classes set status='cancelled' where id=$1",[h.sessions[1]]);
 assert.equal((await h.flow.reconcileClassCheckout(h.admin,a)).status,'needs_review');
 assert.equal((await h.db.query('select count(*)::int n from class_registrations')).rows[0].n,0);
 assert.equal((await h.db.query('select count(*)::int n from square_payment_receipts')).rows[0].n,1);
});

test('checkout input rejects invalid IDs, duplicate dates and quantities that could choose a sibling',async t=>{
 const h=await fixture(t);
 for(const body of [{person_id:h.child,items:[]},{person_id:h.child,items:[{class_id:h.sessions[0],quantity:2}]},{person_id:h.child,items:[{class_id:h.sessions[0]},{class_id:h.sessions[0]}]},{person_id:'invalid',items:[{class_id:h.sessions[0]}]}])assert.throws(()=>h.flow.classCheckoutRequest(body));
});

test('server checkout requires authentication, isolates households, and verifies returns instead of trusting browser payment claims',async t=>{
 const h=await fixture(t);
 const {loadModule}=await import('./helpers/class-preregistration-harness.mjs');
 const api=(user=h.user,household=h.family)=>loadModule('src/app/api/classes/checkout/route.ts',{
  '@vercel/functions':{waitUntil(){}},
  '@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>({data:{user:user?{id:user,email:'fictional@example.invalid'}:null}})}})},
  '@/lib/supabase/admin':{createAdminSupabaseClient:()=>h.admin},
  '@/lib/households':{getLatestHouseholdIdForUser:async()=>household},
  '@/lib/family-profile':{parseGuardianName:()=>({firstName:'Parent',lastName:'Test'}),ensureGuardianProfile:async()=>{}},
  '@/lib/class-checkout':{...h.flow,cleanupClassCheckouts:async()=>{}},
 },{console}).POST;
 const post=(handler,body)=>handler(new Request('https://example.test/api/classes/checkout',{method:'POST',body:JSON.stringify(body)}));
 assert.equal((await post(api(null),h.request)).status,401);
 assert.equal((await post(api(),{mode:'finalize',status:'completed',items:h.request.items,person_id:h.child})).status,400);
 const response=await post(api(),h.request),body=await response.json();assert.equal(response.status,200);assert.equal(body.checkout.status,'open');
 const retry=await (await post(api(),{...h.request,items:[...h.request.items].reverse()})).json();assert.equal(retry.checkout.id,body.checkout.id);
 const denied=await post(api(h.user,crypto.randomUUID()),{mode:'finalize',checkout_id:body.checkout.id,status:'completed'});assert.equal(denied.status,404);
 const pending=await (await post(api(),{mode:'finalize',checkout_id:body.checkout.id,status:'completed'})).json();assert.equal(pending.checkout.status,'open');
 assert.equal((await h.db.query('select count(*)::int n from class_registrations')).rows[0].n,0);
});

test('signed class payment webhook routes to persisted checkout and retries verification failures before logging',async t=>{
 const h=await fixture(t),a=await h.start();h.pay(a);let fail=false,called=0;
 const runtime=loadSquareModules({fetch:async url=>Response.json({order:h.orders.get(a.order_id)}),mocks:{
  'next/server':{},'@supabase/supabase-js':{createClient:()=>h.admin},
  '@/lib/square-webhook':{verifySquareWebhook:()=>true},
  '@/lib/soft-opening-payments':{},'@/lib/class-series-payments':{},'@/lib/households':{},'@/lib/founding-square':{},
  '@vercel/functions':{},'@/lib/membership-notifications':{},'@/lib/square-admission-pos':{},
  '@/lib/class-checkout':{reconcileClassCheckout:async(...args)=>{called++;if(fail)throw Error('provider unavailable');return h.flow.reconcileClassCheckout(...args);}},
 }});
 const route=runtime.load('src/app/api/webhooks/square/route.ts');
 const req=()=>new Request('https://example.test/api/webhooks/square',{method:'POST',body:JSON.stringify({type:'payment.updated',data:{object:{payment:{status:'COMPLETED',order_id:a.order_id}}}})});
 fail=true;assert.equal((await route.POST(req())).status,503);
 fail=false;assert.equal((await route.POST(req())).status,200);assert.equal(called,2);
 assert.equal((await h.flow.readClassCheckout(h.admin,h.family,a.id)).status,'completed');
});
