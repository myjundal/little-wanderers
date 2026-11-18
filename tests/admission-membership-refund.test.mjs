import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
import { memoryAdmin } from './helpers/family-memory-admin.mjs';
function fixture() {
 const household='10000000-0000-4000-8000-000000000001';
 const admin=memoryAdmin({checkins:[{id:'child1',household_id:household,square_environment:'production',square_order_id:'order',price_cents:1600,payment_status:'paid'},{id:'child2',household_id:household,square_environment:'production',square_order_id:'order',price_cents:2000,payment_status:'paid'}],founding_memberships:[{id:'enrollment',household_id:household,environment:'production',status:'active',square_subscription_id:'subscription',square_customer_id:'customer'}],membership_events:[]});
 const order={id:'order',location_id:'location',customer_id:'customer',total_money:{amount:3600,currency:'USD'},tenders:[{payment_id:'payment'}]};
 const payment={id:'payment',order_id:'order',location_id:'location',customer_id:'customer',status:'COMPLETED',source_type:'CARD',amount_money:{amount:3600,currency:'USD'},refund_ids:[]};
 const refunds=new Map(), keys=new Map();let posts=0,lost=false,environment='production';
 const api=loadSquareModules({mocks:{'@/lib/square-client':{squareConfig:()=>({environment,locationId:'location'}),squareCustomerMatches:async(a,b)=>a===b,assertUsd:(m,n)=>{assert.equal(m?.currency,'USD');assert.equal(m?.amount,n);},squareRequest:async(path,method='GET',body)=>{
  if(path.startsWith('/v2/orders/'))return{order:structuredClone(order)};
  if(path.startsWith('/v2/payments/'))return{payment:structuredClone(payment)};
  if(path.startsWith('/v2/refunds/'))return{refund:structuredClone(refunds.get(path.split('/').at(-1)))};
  assert.equal(path,'/v2/refunds');assert.equal(method,'POST');assert(body.idempotency_key.length<=45);assert.equal(body.amount_money.amount,3600);assert.equal(body.destination_id,undefined);
  if(keys.has(body.idempotency_key))return{refund:structuredClone(keys.get(body.idempotency_key))};
  posts++;const refund={id:'refund',payment_id:'payment',status:'PENDING',reason:body.reason,amount_money:body.amount_money};keys.set(body.idempotency_key,refund);refunds.set('refund',refund);
  if(lost){lost=false;throw Error('Lost response');}
  payment.refund_ids.push('refund');payment.refunded_money={amount:3600,currency:'USD'};return{refund:structuredClone(refund)};
 }}}}).load('src/lib/admission-membership-refund.ts');
 return{api,admin,order,payment,refunds,posts:()=>posts,lose:()=>{lost=true;},sandbox:()=>{environment='sandbox';},input:{householdId:household,orderId:'order',expectedAmountCents:3600}};
}
test('preview does not write, full original-card refund has durable authorization, and retry refunds only once',async()=>{
 const h=fixture();await h.api.previewAdmissionMembershipRefund(h.admin,h.input);assert.equal(h.posts(),0);assert.equal(h.admin.writes.length,0);
 const result=await h.api.refundAdmissionMembership(h.admin,h.input);assert.equal(result.status,'PENDING');assert.equal(result.audit_saved,true);assert.equal(h.admin.tables.membership_events.length,1);
 assert.equal((await h.api.refundAdmissionMembership(h.admin,h.input)).refund_id,result.refund_id);assert.equal(h.posts(),1);assert.equal(h.admin.tables.checkins[0].price_cents,1600);assert.equal(h.admin.tables.checkins[0].payment_status,'paid');
});
test('lost responses and concurrent requests reuse one provider key',async()=>{const h=fixture();h.lose();await assert.rejects(h.api.refundAdmissionMembership(h.admin,h.input),/Lost response/);await Promise.all([h.api.refundAdmissionMembership(h.admin,h.input),h.api.refundAdmissionMembership(h.admin,h.input)]);assert.equal(h.posts(),1);});
test('another family, incorrect allocation, tips, taxes, prior refunds, cash, sandbox, inactive membership and customer mismatch block writes',async()=>{
 for(const scenario of ['shared','allocation','unpaid','sandbox','inactive','customer','order','amount','currency','tax','tip','split','cash','pending','prior','failed']){
  const h=fixture();
  if(scenario==='shared')h.admin.tables.checkins[0].household_id='other';
  if(scenario==='allocation')h.admin.tables.checkins[0].price_cents=1000;
  if(scenario==='unpaid')h.admin.tables.checkins[0].payment_status='unpaid';
  if(scenario==='sandbox')h.sandbox();
  if(scenario==='inactive')h.admin.tables.founding_memberships[0].status='pending';
  if(scenario==='customer')h.payment.customer_id='other';
  if(scenario==='order')h.payment.order_id='other';
  if(scenario==='amount')h.payment.amount_money.amount=3500;
  if(scenario==='currency')h.payment.amount_money.currency='CAD';
  if(scenario==='tax')h.order.total_tax_money={amount:100};
  if(scenario==='tip')h.payment.tip_money={amount:100};
  if(scenario==='split')h.order.tenders.push({payment_id:'other'});
  if(scenario==='cash')h.payment.source_type='CASH';
  if(scenario==='pending')h.payment.status='APPROVED';
  if(scenario==='prior')h.payment.refunded_money={amount:100};
  if(scenario==='failed'){h.payment.refund_ids.push('bad');h.refunds.set('bad',{id:'bad',payment_id:'payment',status:'FAILED'});}
  await assert.rejects(h.api.refundAdmissionMembership(h.admin,h.input),scenario);assert.equal(h.posts(),0,scenario);
 }
});
test('unavailable audit blocks provider write and altered frozen parameters cannot change refund',async()=>{
 const h=fixture();h.admin.failNext('membership_events');await assert.rejects(h.api.refundAdmissionMembership(h.admin,h.input));assert.equal(h.posts(),0);
 await h.api.refundAdmissionMembership(h.admin,h.input);const audit=h.admin.tables.membership_events[0];const value=JSON.parse(audit.notes);value.request.amount_cents=9999;audit.notes=JSON.stringify(value);await assert.rejects(h.api.refundAdmissionMembership(h.admin,h.input),/parameters changed/);assert.equal(h.posts(),1);
});
test('route requires private owner, same origin, explicit refund confirmation, valid selection',async()=>{
 let context={ok:false,response:new Response(null,{status:403})},calls=0;
 const route=loadSquareModules({mocks:{'@/lib/revenue-access':{requireRevenueContext:async()=>context},'@/lib/admission-membership-refund':{previewAdmissionMembershipRefund:async()=>{calls++;return{payment:{id:'p'},amount_cents:3600,existing:null};},refundAdmissionMembership:async()=>{calls++;return{status:'PENDING'};}}}}).load('src/app/api/admin/admission/membership-refund/route.ts');
 const req=(extra={},origin='https://example.test')=>new Request('https://example.test/api/admin/admission/membership-refund',{method:'POST',headers:{origin},body:JSON.stringify({action:'refund',household_id:'10000000-0000-4000-8000-000000000001',order_id:'order',expected_amount_cents:3600,...extra})});
 assert.equal((await route.POST(req())).status,403);context={ok:true,admin:{}};
 assert.equal((await route.POST(req({},'https://other.test'))).status,403);assert.equal((await route.POST(req())).status,400);assert.equal((await route.POST(req({order_id:'../bad'}))).status,400);assert.equal(calls,0);
 assert.equal((await route.POST(req({action:'preview'}))).status,200);assert.equal((await route.POST(req({confirmation:'REFUND ORIGINAL ADMISSION PAYMENT'}))).status,200);assert.equal(calls,2);
});
