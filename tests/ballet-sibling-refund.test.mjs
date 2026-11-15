import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
import { memoryAdmin } from './helpers/family-memory-admin.mjs';

function fixture() {
 const rows=['first','second'].map((id,index)=>({id,household_id:'family',kind:'class',environment:'production',status:'completed',order_id:`order-${id}`,
  expected_amount_cents:2500,created_at:`2026-11-15T01:0${index}:00Z`,payload:{assignments:[{class_id:'ballet',person_id:id}],line_items:[{base_price_money:{amount:2500,currency:'USD'}}]}}));
 const admin=memoryAdmin({classes:[{id:'ballet',title:'PreK+ Ballet'}],people:rows.map(row=>({id:row.id,household_id:'family',role:'child'})),square_checkout_attempts:rows,
  class_registrations:rows.map(row=>({person_id:row.id,class_id:'ballet',household_id:'family',status:'scheduled'}))});
 const payments=new Map(rows.map(row=>[`payment-${row.id}`,{id:`payment-${row.id}`,order_id:row.order_id,location_id:'location',status:'COMPLETED',amount_money:{amount:2500,currency:'USD'},updated_at:'2026-11-15T02:00:00Z',refund_ids:[]}]));
 const refunds=new Map();let refundCalls=0;
 const runtime=loadSquareModules({mocks:{'@/lib/square-client':{
  squareConfig:()=>({environment:'production',locationId:'location'}),
  assertUsd:(money,amount)=>{assert.equal(money.currency,'USD');assert.equal(money.amount,amount);},
  squareRequest:async(path,method='GET',body)=>{
   if(path.startsWith('/v2/orders/')){const id=path.split('/').at(-1).replace('order-','');return {order:{id:`order-${id}`,reference_id:id,location_id:'location',total_money:{amount:2500,currency:'USD'},tenders:[{payment_id:`payment-${id}`}]}};}
   if(path.startsWith('/v2/payments/'))return {payment:payments.get(path.split('/').at(-1))};
   if(path.startsWith('/v2/refunds/'))return {refund:refunds.get(path.split('/').at(-1))};
   assert.equal(path,'/v2/refunds');assert.equal(method,'POST');refundCalls++;
   assert(body.idempotency_key.length<=45);assert.equal(body.amount_money.amount,500);
   const refund={id:'refund-second',status:'PENDING',payment_id:body.payment_id,reason:body.reason,amount_money:body.amount_money};
   refunds.set(refund.id,refund);payments.get(body.payment_id).refund_ids.push(refund.id);return {refund};
  },
 }}});
 return {api:runtime.load('src/lib/ballet-sibling-refund.ts'),admin,payments,refundCalls:()=>refundCalls,input:{householdId:'family',classId:'ballet',personId:'second'}};
}
test('a second paid ballet child receives only $5 back, retries reuse the refund and paid seats remain intact',async()=>{
 const h=fixture();
 assert.equal((await h.api.previewBalletSiblingRefund(h.admin,h.input)).amountCents,500);assert.equal(h.refundCalls(),0);
 const result=await h.api.refundBalletSibling(h.admin,{...h.input,expectedAmountCents:500,ownerId:'owner'});
 assert.equal(result.status,'PENDING');assert.equal(result.amount_cents,500);assert.equal(result.registrations_unchanged,true);
 assert.equal((await h.api.refundBalletSibling(h.admin,{...h.input,expectedAmountCents:500,ownerId:'owner'})).refund_id,result.refund_id);
 assert.equal(h.refundCalls(),1);assert(h.admin.tables.square_checkout_attempts.every(row=>row.status==='completed'));
 assert.equal(h.admin.tables.square_checkout_attempts[1].payload.sibling_refund.authorized_by,'owner');
});
test('first child, unrelated previous refund, wrong amount and a refunded first sibling cannot produce a new refund',async()=>{
 for(const scenario of ['first','previous-refund','wrong-amount','first-refunded']){
  const h=fixture();
  if(scenario==='previous-refund')h.payments.get('payment-second').refunded_money={amount:100};
  if(scenario==='first-refunded')h.payments.get('payment-first').refunded_money={amount:2500};
  await assert.rejects(h.api.refundBalletSibling(h.admin,{...h.input,personId:scenario==='first'?'first':'second',expectedAmountCents:scenario==='wrong-amount'?1000:500,ownerId:'owner'}));
  assert.equal(h.refundCalls(),0);
 }
});
test('refund endpoint requires owner access and same-origin confirmation before provider work',async()=>{
 let context={ok:false,response:new Response(null,{status:403})},calls=0;
 const route=loadSquareModules({mocks:{'@/lib/authz':{requireOwnerContext:async()=>context},
  '@/lib/class-checkout':{validCheckoutId:()=>true},'@/lib/ballet-sibling-refund':{refundBalletSibling:async()=>{calls++;return {status:'PENDING'};},previewBalletSiblingRefund:async()=>{calls++;}},
 }}).load('src/app/api/admin/classes/sibling-refund/route.ts');
 const request=(origin='https://example.test',extra={})=>new Request('https://example.test/api/admin/classes/sibling-refund',{method:'POST',headers:{origin},body:JSON.stringify({household_id:'family',class_id:'ballet',person_id:'second',action:'refund',...extra})});
 assert.equal((await route.POST(request())).status,403);
 context={ok:true,user:{id:'owner'},admin:{}};
 assert.equal((await route.POST(request('https://elsewhere.test'))).status,403);
 assert.equal((await route.POST(request())).status,400);assert.equal(calls,0);
 assert.equal((await route.POST(request('https://example.test',{confirmation:'REFUND BALLET SIBLING DISCOUNT',expected_amount_cents:500}))).status,200);assert.equal(calls,1);
});
