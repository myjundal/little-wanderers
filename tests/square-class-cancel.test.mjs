import {test} from 'node:test';
import assert from 'node:assert/strict';
import {squareTestDatabase,localSquareAdmin,loadSquareModules,ids} from './helpers/square-harness.mjs';

async function fixture(t){
 const db=await squareTestDatabase();t.after(()=>db.close());const admin=localSquareAdmin(db);
 const saved=await admin.rpc('prepare_square_checkout',{p_household:ids.household,p_kind:'class',p_environment:'sandbox',p_location:'test-location',p_user:ids.user,p_role:'customer',p_request:{person_id:ids.person,items:[{class_id:ids.klass,quantity:1}]}});
 const attempt={...saved.data,order_id:'order',payment_link_id:'link'};
 await admin.from('square_checkout_attempts').update({order_id:'order',payment_link_id:'link',status:'open'}).eq('id',attempt.id);
 const order={id:'order',location_id:'test-location',state:'OPEN',total_money:{amount:2000,currency:'USD'}};
 return {db,admin,attempt,order};
}
test('unpaid cancellation releases its hold only after Square confirms its order is cancelled',async t=>{
 const {admin,attempt,order}=await fixture(t);const calls=[];
 const checkout=loadSquareModules({fetch:async(url,options)=>{calls.push(options.method);if(options.method==='DELETE'){order.state='CANCELED';return Response.json({id:'link',cancelled_order_id:'order'});}return Response.json({order});}}).load('src/lib/square-checkout.ts');
 assert.equal((await checkout.cancelUnpaidClassCheckout(admin,attempt)).status,'cancelled');
 assert.ok(calls.includes('DELETE'));assert.equal((await admin.from('square_checkout_attempts').select('*').eq('id',attempt.id).single()).data.status,'cancelled');
});
test('a failed or unverified provider cancellation retains the checkout and its seat hold',async t=>{
 const {admin,attempt,order}=await fixture(t);
 const checkout=loadSquareModules({fetch:async(_url,options)=>options.method==='DELETE'?Response.json({errors:[{code:'INTERNAL_ERROR'}]},{status:500}):Response.json({order})}).load('src/lib/square-checkout.ts');
 await assert.rejects(checkout.cancelUnpaidClassCheckout(admin,attempt),/has not confirmed cancellation/);
 assert.equal((await admin.from('square_checkout_attempts').select('*').eq('id',attempt.id).single()).data.status,'open');
});
test('a payment that completed before cancellation is fulfilled rather than deleted or refunded',async t=>{
 const {admin,attempt,order}=await fixture(t);order.tenders=[{payment_id:'payment'}];let deleted=false;
 const payment={id:'payment',order_id:'order',location_id:'test-location',status:'COMPLETED',amount_money:{amount:2000,currency:'USD'},updated_at:new Date().toISOString()};
 const checkout=loadSquareModules({fetch:async(url,options)=>{if(options.method==='DELETE')deleted=true;return Response.json(new URL(url).pathname.includes('/payments/')?{payment}:{order});}}).load('src/lib/square-checkout.ts');
 assert.equal((await checkout.cancelUnpaidClassCheckout(admin,attempt)).status,'completed');assert.equal(deleted,false);
});
