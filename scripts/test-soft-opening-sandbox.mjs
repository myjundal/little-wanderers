// Fictional Square Sandbox transaction only; no live database, customer, or charge.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {loadSquareModules} from '../tests/helpers/admission-pos-harness.mjs';
if(process.env.SQUARE_ENVIRONMENT!=='sandbox')throw new Error('Sandbox only');
const modules=loadSquareModules({env:{SQUARE_ENVIRONMENT:'sandbox',SQUARE_ACCESS_TOKEN:process.env.SQUARE_ACCESS_TOKEN,SQUARE_LOCATION_ID:process.env.SQUARE_LOCATION_ID,SQUARE_API_VERSION:process.env.SQUARE_API_VERSION,NEXT_PUBLIC_SITE_URL:'http://localhost:3055'}});
const flow=modules.load('src/lib/soft-opening-payments.ts');
const {squareRequest}=modules.load('src/lib/square-client.ts');
let r={id:crypto.randomUUID(),household_id:crypto.randomUUID(),status:'reserved',child_ids:[crypto.randomUUID(),crypto.randomUUID()],amount_cents:2600,payment_choice:'counter',payment_status:'due',square_order_id:null,square_payment_link_id:null,payment_url:null,payment_environment:null,created_at:new Date().toISOString()};
const db={from(){let patch;const q={update(v){patch=v;return q;},eq(){return q;},select(){return q;},async single(){r={...r,...patch};return {data:{id:r.id},error:null};}};return q;},async rpc(name,args){assert.equal(name,'fulfill_open_play_reservation');assert.equal(args.p_order,r.square_order_id);assert.equal(args.p_amount,2600);assert.equal(args.p_payments.length,1);r={...r,payment_status:'paid'};return {data:r,error:null};}};
if(process.argv.includes('--verify-existing')){
 const previous=JSON.parse(fs.readFileSync('/tmp/lw-soft-sandbox-checkout.json','utf8'));
 const {order}=await squareRequest(`/v2/orders/${previous.orderId}`);
 r={...r,id:order.reference_id.slice(3),square_order_id:previous.orderId,square_payment_link_id:previous.linkId,payment_url:previous.url,payment_choice:'now',payment_environment:'sandbox',created_at:order.created_at};
 assert.equal((await flow.verifyOpenPlayPayment(db,r)).payment_status,'paid');
 assert.equal((await flow.verifyOpenPlayPayment(db,r)).payment_status,'paid');
 await squareRequest(`/v2/online-checkout/payment-links/${r.square_payment_link_id}`,'DELETE');
 console.log(JSON.stringify({environment:'sandbox',amountCents:2600,stableCheckout:true,orderVerified:true,completedReceiptVerified:true,productionDatabaseUsed:false,realCharge:false}));
 process.exit(0);
}
const first=await flow.startOpenPlayPayment(db,r);assert(first.url.startsWith('https://'));
const repeated=await flow.startOpenPlayPayment(db,r);assert.equal(first.url,repeated.url);
assert.equal((await flow.verifyOpenPlayPayment(db,r)).payment_status,'due');
const {order}=await squareRequest(`/v2/orders/${r.square_order_id}`);assert.equal(order.reference_id,`op_${r.id}`);assert.equal(order.total_money.amount,2600);assert.equal(order.total_money.currency,'USD');
fs.writeFileSync('/tmp/lw-soft-sandbox-checkout.json',JSON.stringify({url:first.url,orderId:r.square_order_id,linkId:r.square_payment_link_id}));
console.log(JSON.stringify({checkoutUrl:first.url,environment:'sandbox',productionDatabaseUsed:false,realCharge:false}));
if(process.argv.includes('--wait-for-payment')){
 for(let i=0;i<120;i++){
  const current=await flow.verifyOpenPlayPayment(db,r);
  if(current.payment_status==='paid'){assert.equal((await flow.verifyOpenPlayPayment(db,r)).payment_status,'paid');break;}
  await new Promise(resolve=>setTimeout(resolve,3000));
 }
 assert.equal(r.payment_status,'paid','Complete the fictional Sandbox checkout');
}
await squareRequest(`/v2/online-checkout/payment-links/${r.square_payment_link_id}`,'DELETE');
console.log(JSON.stringify({environment:'sandbox',amountCents:2600,stableCheckout:true,orderVerified:true,completedReceiptVerified:r.payment_status==='paid',productionDatabaseUsed:false,realCharge:false}));
