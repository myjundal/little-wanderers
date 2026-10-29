import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {squareTestDatabase,localSquareAdmin,loadSquareModules,ids} from './helpers/square-harness.mjs';
async function setup(t){const db=await squareTestDatabase();t.after(()=>db.close());const admin=localSquareAdmin(db);const r=await admin.rpc('prepare_square_checkout',{p_household:ids.household,p_kind:'class',p_environment:'sandbox',p_location:'test-location',p_user:ids.user,p_role:'customer',p_request:{person_id:ids.person,items:[{class_id:ids.klass,quantity:1}]}});assert.equal(r.error,null);return {db,admin,attempt:r.data};}

test('a pre-registration added after checkout preparation is promoted without losing its ID',async t=>{
 const {db,admin,attempt}=await setup(t);assert.equal(attempt.payload.assignments[0].registration_id,null);
 const id=crypto.randomUUID();await db.query("insert into class_registrations(id,class_id,person_id,household_id,status) values($1,$2,$3,$4,'preregistered')",[id,ids.klass,ids.person,ids.household]);
 await admin.from('square_checkout_attempts').update({order_id:'paid-order'}).eq('id',attempt.id);await admin.from('square_payment_receipts').insert({environment:'sandbox',payment_id:'paid',order_id:'paid-order',amount_cents:2000,status:'COMPLETED'});
 const paid=await admin.rpc('fulfill_square_class_checkout',{p_id:attempt.id});assert.equal(paid.error,null);assert.deepEqual(paid.data.registration_ids,[id]);assert.equal((await db.query('select status from class_registrations')).rows[0].status,'scheduled');
 assert.deepEqual((await admin.rpc('fulfill_square_class_checkout',{p_id:attempt.id})).data,paid.data);
});

test('automatic expired hold cleanup verifies Square cancellation before releasing the seats',async t=>{
 const {admin,attempt}=await setup(t);await admin.from('square_checkout_attempts').update({status:'open',order_id:'order',payment_link_id:'link',hold_expires_at:'2000-01-01'}).eq('id',attempt.id);
 const order={id:'order',location_id:'test-location',state:'OPEN',total_money:{amount:2000,currency:'USD'}};
 const recovery=loadSquareModules({fetch:async(_u,o)=>{if(o.method==='DELETE')order.state='CANCELED';return Response.json({order});}}).load('src/lib/square-checkout-recovery.ts');
 const result=await recovery.expireSquareCheckoutHolds(admin);assert.equal(result.cancelled,1);assert.equal((await admin.from('square_checkout_attempts').select('*').eq('id',attempt.id).single()).data.status,'cancelled');
});

test('expired but already paid checkouts fulfill; uncertain cancellation keeps the hold',async t=>{
 const {admin,attempt}=await setup(t);await admin.from('square_checkout_attempts').update({status:'open',order_id:'order',payment_link_id:'link',hold_expires_at:'2000-01-01'}).eq('id',attempt.id);
 const order={id:'order',location_id:'test-location',state:'OPEN',total_money:{amount:2000,currency:'USD'}};
 const runtime=loadSquareModules({fetch:async(url,o)=>{if(o.method==='DELETE')return Response.json({errors:[{code:'INTERNAL_ERROR'}]},{status:500});return Response.json(new URL(url).pathname.includes('/payments/')?{payment:{id:'p',order_id:'order',location_id:'test-location',status:'COMPLETED',amount_money:{amount:2000,currency:'USD'},updated_at:new Date().toISOString()}}:{order});}});
 const recovery=runtime.load('src/lib/square-checkout-recovery.ts');assert.equal((await recovery.expireSquareCheckoutHolds(admin)).retained,1);
 order.tenders=[{payment_id:'p'}];assert.equal((await recovery.expireSquareCheckoutHolds(admin)).completed,1);
});

test('unmapped provider requests replay exactly; attempts never sent to Square can be cancelled atomically',async t=>{
 const {admin,attempt}=await setup(t);await admin.from('square_checkout_attempts').update({hold_expires_at:'2000-01-01'}).eq('id',attempt.id);
 const recovery=loadSquareModules({fetch:async()=>{throw new Error('No provider request was frozen');}}).load('src/lib/square-checkout-recovery.ts');assert.equal((await recovery.expireSquareCheckoutHolds(admin)).cancelled,1);
 assert.match((await admin.rpc('freeze_square_checkout_request',{p_id:attempt.id,p_request:{idempotency_key:'late'}})).error.message,/expired/);
 const next=await admin.rpc('prepare_square_checkout',{p_household:ids.household,p_kind:'class',p_environment:'sandbox',p_location:'test-location',p_user:ids.user,p_role:'customer',p_request:{person_id:ids.person,items:[{class_id:ids.klass,quantity:1}]}});
 const body={idempotency_key:`lw-checkout-${next.data.id}`,order:{location_id:'test-location'}};
 assert.equal((await admin.rpc('freeze_square_checkout_request',{p_id:next.data.id,p_request:body})).error,null);
 await admin.from('square_checkout_attempts').update({hold_expires_at:'2000-01-01'}).eq('id',next.data.id);
 const order={id:'recovered',location_id:'test-location',state:'OPEN',total_money:{amount:2000,currency:'USD'}};let replayed;
 const recover=loadSquareModules({fetch:async(_u,o)=>{if(o.method==='POST'){replayed=JSON.parse(o.body);return Response.json({payment_link:{id:'link',order_id:'recovered',url:'https://sandbox.square.link/u/test'}});}if(o.method==='DELETE')order.state='CANCELED';return Response.json({order});}}).load('src/lib/square-checkout-recovery.ts');
 assert.equal((await recover.expireSquareCheckoutHolds(admin)).cancelled,1);assert.deepEqual(replayed,body);
});
