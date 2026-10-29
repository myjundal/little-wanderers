import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {squareTestDatabase,localSquareAdmin,loadSquareModules,ids} from './helpers/square-harness.mjs';

const future={start_time:'2032-06-12T14:00:00Z',end_time:'2032-06-12T17:00:00Z',headcount_expected:10};
async function reserve(admin,household=ids.household) {
  const result=await admin.rpc('reserve_party_invoice',{p_household:household,p_environment:'sandbox',p_location:'test-location',p_user:ids.user,p_role:'customer',p_booking:future});
  if(result.error)throw new Error(result.error.message);
  return result.data;
}
async function invoiceFixture(admin) {
  const b=await reserve(admin);
  const result=await admin.from('party_bookings').update({square_order_id:'order-1',square_invoice_id:'invoice-1',square_customer_id:'customer-1'}).eq('id',b.id).select('*').single();
  const invoice={id:'invoice-1',version:1,location_id:'test-location',order_id:'order-1',status:'UNPAID',
    public_url:'https://squareupsandbox.com/pay-invoice/test',primary_recipient:{customer_id:'customer-1'},payment_requests:[
      {request_type:'DEPOSIT',computed_amount_money:{amount:15000,currency:'USD'},total_completed_amount_money:{amount:0,currency:'USD'}},
      {request_type:'BALANCE',computed_amount_money:{amount:15000,currency:'USD'},total_completed_amount_money:{amount:0,currency:'USD'}},
    ]};
  const order={id:'order-1',reference_id:b.id,customer_id:'customer-1',location_id:'test-location',total_money:{amount:30000,currency:'USD'}};
  return {booking:result.data,invoice,order};
}
const provider=(fixture)=>async url=>{
  const path=new URL(url).pathname;
  if(path==='/v2/invoices/invoice-1')return Response.json({invoice:fixture.invoice});
  if(path==='/v2/orders/order-1')return Response.json({order:fixture.order});
  throw new Error(`Unexpected provider call ${path}`);
};

test('Square configuration fails closed and flags are independent',()=>{
  const runtime=loadSquareModules();const client=runtime.load('src/lib/square-client.ts');
  assert.equal(client.paymentFlowEnabled('party'),false);
  assert.throws(()=>client.requirePaymentFlow('party'));
  runtime.env.PARTY_PAYMENTS_ENABLED='true';assert.equal(client.requirePaymentFlow('party').environment,'sandbox');
  assert.equal(client.paymentFlowEnabled('membership'),false);
  runtime.env.SQUARE_ENVIRONMENT='typo';assert.throws(()=>client.squareConfig());
  runtime.env.SQUARE_ENVIRONMENT='production';runtime.env.SQUARE_BASE_URL='https://connect.squareupsandbox.com';assert.throws(()=>client.squareConfig());
});

test('invoice payload requests $150 deposit and $150 balance with no automatic charges',async t=>{
  const db=await squareTestDatabase();t.after(()=>db.close());const admin=localSquareAdmin(db);
  const {booking}=await invoiceFixture(admin);
  const party=loadSquareModules().load('src/lib/square-party.ts');
  const body=party.buildPartyInvoice(booking);
  assert.equal(body.invoice.payment_requests.length,2);
  assert.equal(body.invoice.payment_requests[0].fixed_amount_requested_money.amount,15000);
  assert.equal(body.invoice.payment_requests[1].request_type,'BALANCE');
  assert.ok(body.invoice.payment_requests.every(r=>r.automatic_payment_source==='NONE'));
  assert.equal(body.invoice.delivery_method,'SHARE_MANUALLY');
  assert.equal(body.idempotency_key,party.buildPartyInvoice(booking).idempotency_key);
  const dates=party.partyInvoiceDueDates('2032-06-01T12:00:00Z','2032-06-12T14:00:00Z');
  assert.equal(dates.balance,'2032-06-11');
});

test('database prevents unpaid confirmation, overlapping parties, and browser fulfillment',async t=>{
  const db=await squareTestDatabase();t.after(()=>db.close());const admin=localSquareAdmin(db);
  const booking=await reserve(admin);assert.equal(booking.status,'pending');
  assert.equal((await reserve(admin)).id,booking.id);
  const bad=await admin.from('party_bookings').update({status:'confirmed'}).eq('id',booking.id);
  assert.match(bad.error.message,/verified Square deposit/);
  await assert.rejects(reserve(admin,ids.other),/already booked/);
  // Expiry alone must not release a slot while its invoice can still be paid.
  await admin.from('party_bookings').update({payment_hold_expires_at:'2000-01-01T00:00:00Z'}).eq('id',booking.id);
  await assert.rejects(reserve(admin,ids.other),/already booked/);
  await db.exec('set role anon');
  await assert.rejects(db.query('select public.fulfill_square_class_checkout($1)',[crypto.randomUUID()]),/permission denied/);
  await assert.rejects(db.query('update public.party_bookings set deposit_paid_cents=15000 where id=$1',[booking.id]),/permission denied/);
  await assert.rejects(db.query('insert into public.memberships(household_id,renews_at) values($1,null)',[ids.household]),/permission denied/);
  await db.exec('reset role');
});

test('only verified deposit confirms; same invoice online/POS balance reaches full payment; stale events cannot regress state',async t=>{
  const db=await squareTestDatabase();t.after(()=>db.close());const admin=localSquareAdmin(db);const f=await invoiceFixture(admin);
  const party=loadSquareModules({fetch:provider(f)}).load('src/lib/square-party.ts');
  let booking=await party.reconcilePartyInvoice(admin,f.booking);assert.equal(booking.status,'pending');
  f.invoice.status='PAYMENT_PENDING';f.invoice.version++;
  booking=await party.reconcilePartyInvoice(admin,booking);assert.equal(booking.status,'pending');
  f.invoice.status='PARTIALLY_PAID';f.invoice.version++;f.invoice.payment_requests[0].total_completed_amount_money.amount=15000;
  booking=await party.reconcilePartyInvoice(admin,booking);assert.equal(booking.status,'confirmed');assert.equal(booking.balance_paid_cents,0);
  // Native POS invoice payments update the same Invoice payment request, so they share this fulfillment path.
  f.invoice.status='PAID';f.invoice.version++;f.invoice.payment_requests[1].total_completed_amount_money.amount=15000;
  booking=await party.reconcilePartyInvoice(admin,booking);assert.equal(booking.balance_paid_cents,15000);
  await admin.rpc('apply_party_invoice',{p_id:booking.id,p_environment:'sandbox',p_invoice_id:'invoice-1',p_version:1,p_status:'UNPAID',p_deposit:0,p_balance:0,p_review:false,p_url:null});
  const saved=await admin.from('party_bookings').select('*').eq('id',booking.id).single();assert.equal(saved.data.deposit_paid_cents,15000);assert.equal(saved.data.balance_paid_cents,15000);
  f.invoice.status='PARTIALLY_REFUNDED';f.invoice.version++;
  booking=await party.reconcilePartyInvoice(admin,booking);assert.equal(booking.payment_review_required,true);
});

test('invoice identity, amount, currency, location and customer mismatches cannot confirm a booking',async t=>{
  const db=await squareTestDatabase();t.after(()=>db.close());const f=await invoiceFixture(localSquareAdmin(db));
  const party=loadSquareModules().load('src/lib/square-party.ts');
  f.invoice.status='PARTIALLY_PAID';f.invoice.payment_requests[0].total_completed_amount_money.amount=15000;
  for(const mutate of [x=>x.invoice.location_id='wrong',x=>x.order.total_money.amount=15000,x=>x.order.total_money.currency='CAD',
    x=>x.invoice.primary_recipient.customer_id='other',x=>x.order.reference_id='another-booking',x=>x.invoice.payment_requests[0].total_completed_amount_money.amount=14999.5]) {
    const bad=structuredClone(f);mutate(bad);assert.throws(()=>party.verifyPartyInvoice(bad.booking,bad.invoice,bad.order));
  }
});

test('failed webhook processing retries after the event was logged; completed duplicates are acknowledged',async t=>{
  const db=await squareTestDatabase();t.after(()=>db.close());const admin=localSquareAdmin(db),f=await invoiceFixture(admin);
  f.invoice.status='PARTIALLY_PAID';f.invoice.payment_requests[0].total_completed_amount_money.amount=15000;
  let fail=true,calls=0;
  const flaky={...admin,async rpc(name,args){if(fail&&name==='apply_party_invoice'){fail=false;return {data:null,error:{message:'temporary database outage'}};}return admin.rpc(name,args);}};
  const url='https://test.invalid/api/webhooks/square',key='test-signature';
  const runtime=loadSquareModules({env:{SQUARE_WEBHOOK_URL:url,SQUARE_WEBHOOK_SIGNATURE_KEY:key},fetch:async(...args)=>{calls++;return provider(f)(...args);},mocks:{
    '@/lib/supabase/admin':{createAdminSupabaseClient:()=>flaky},'@/lib/party-emails':{sendPartyConfirmationEmail:async()=>({ok:true})},
  }});
  const api=runtime.load('src/app/api/webhooks/square/route.ts');
  const body=JSON.stringify({event_id:'event-retry',type:'invoice.payment_made',data:{object:{invoice:{id:'invoice-1'}}}});
  const request=()=>new Request(url,{method:'POST',body,headers:{'x-square-hmacsha256-signature':crypto.createHmac('sha256',key).update(url+body).digest('base64')}});
  assert.equal((await api.POST(request())).status,500);
  assert.equal((await api.POST(request())).status,200);
  const count=calls;assert.equal((await api.POST(request())).status,200);assert.equal(calls,count);
  const booking=await admin.from('party_bookings').select('*').eq('id',f.booking.id).single();assert.equal(booking.data.status,'confirmed');
  const log=await admin.from('webhook_log').select('*').single();assert.equal(log.data.processing_status,'processed');
});

test('a forged checkout return can only read a still-unpaid reservation',async t=>{
  const db=await squareTestDatabase();t.after(()=>db.close());const admin=localSquareAdmin(db),f=await invoiceFixture(admin);
  const runtime=loadSquareModules({env:{PARTY_PAYMENTS_ENABLED:'true'},fetch:provider(f),mocks:{
    '@supabase/supabase-js':{createClient:()=>admin},'@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>({data:{user:{id:ids.user}}})}})},
    '@/lib/households':{getLatestHouseholdIdForUser:async()=>ids.household},'@/lib/family-profile':{},
  }});
  const api=runtime.load('src/app/api/party-bookings/route.ts');
  const response=await api.POST({json:async()=>({mode:'finalize',booking_id:f.booking.id})});
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.status,'pending');assert.equal(data.deposit_paid_cents,0);
});

test('paid class fulfillment preserves pre-registration IDs and is atomic and idempotent',async t=>{
  const db=await squareTestDatabase();t.after(()=>db.close());const admin=localSquareAdmin(db);
  const old=crypto.randomUUID();await db.query('insert into class_registrations(id,class_id,person_id,household_id,status) values($1,$2,$3,$4,$5)',[old,ids.klass,ids.person,ids.household,'preregistered']);
  const prepared=await admin.rpc('prepare_square_checkout',{p_household:ids.household,p_kind:'class',p_environment:'sandbox',p_location:'test-location',p_user:ids.user,p_role:'customer',p_request:{person_id:ids.person,items:[{class_id:ids.klass,quantity:1}]}});
  assert.equal(prepared.error,null);
  const id=prepared.data.id;
  const unpaid=await admin.rpc('fulfill_square_class_checkout',{p_id:id});assert.match(unpaid.error.message,/verified checkout payment/);
  await admin.from('square_checkout_attempts').update({order_id:'class-order'}).eq('id',id);
  await admin.from('square_payment_receipts').insert({environment:'sandbox',payment_id:'class-payment',order_id:'class-order',amount_cents:2000,status:'COMPLETED'});
  const result=await admin.rpc('fulfill_square_class_checkout',{p_id:id});assert.equal(result.error,null);assert.deepEqual(result.data.registration_ids,[old]);
  const duplicate=await admin.rpc('fulfill_square_class_checkout',{p_id:id});assert.deepEqual(duplicate.data,result.data);
  const rows=await db.query('select * from class_registrations');assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].status,'scheduled');
});

test('membership access requires a paid invoice, never grants from subscription status or a return URL alone',async t=>{
  const db=await squareTestDatabase();t.after(()=>db.close());const admin=localSquareAdmin(db);
  const prepared=await admin.rpc('prepare_square_checkout',{p_household:ids.household,p_kind:'membership',p_environment:'sandbox',p_location:'test-location',p_user:ids.user,p_role:'customer',p_request:{plan_variation_id:'plan-1'}});
  assert.equal(prepared.error,null);let attempt=prepared.data;
  await admin.from('square_checkout_attempts').update({square_subscription_id:'sub-1'}).eq('id',attempt.id);
  attempt={...attempt,square_subscription_id:'sub-1'};
  const invoice={id:'sub-invoice',subscription_id:'sub-1',location_id:'test-location',primary_recipient:{customer_id:'sub-customer'},status:'UNPAID',payment_requests:[{due_date:'2032-05-01',total_completed_amount_money:{amount:0,currency:'USD'}}]};
  const sub={id:'sub-1',location_id:'test-location',customer_id:'sub-customer',plan_variation_id:'plan-1',version:1,status:'ACTIVE',charged_through_date:'2032-05-31',invoice_ids:['sub-invoice']};
  const checkout=loadSquareModules({fetch:async()=>Response.json({invoice})}).load('src/lib/square-checkout.ts');
  await checkout.reconcileMembership(admin,attempt,sub);
  let rows=await db.query('select * from memberships');assert.ok(new Date(rows.rows[0].renews_at).getTime()<=Date.now());
  invoice.status='PAID';invoice.payment_requests[0].total_completed_amount_money.amount=6000;
  await checkout.reconcileMembership(admin,attempt,sub);rows=await db.query('select * from memberships');assert.ok(new Date(rows.rows[0].renews_at).getTime()>Date.now());
  invoice.status='UNPAID';invoice.payment_requests[0].total_completed_amount_money.amount=0;sub.charged_through_date='2032-06-30';sub.version++;
  const paidThrough=rows.rows[0].renews_at.toISOString();await checkout.reconcileMembership(admin,attempt,sub);
  rows=await db.query('select * from memberships');assert.equal(rows.rows[0].renews_at.toISOString(),paidThrough);
  // Even if the old paid invoice is briefly still listed first, the newer invoiced date cannot extend access.
  invoice.status='PAID';invoice.payment_requests[0].total_completed_amount_money.amount=6000;
  await checkout.reconcileMembership(admin,attempt,sub);rows=await db.query('select * from memberships');assert.equal(rows.rows[0].renews_at.toISOString(),paidThrough);
  const duplicate=await admin.rpc('prepare_square_checkout',{p_household:ids.household,p_kind:'membership',p_environment:'sandbox',p_location:'test-location',p_user:ids.user,p_role:'customer',p_request:{plan_variation_id:'plan-1'}});
  assert.match(duplicate.error.message,/membership already exists/);
});

test('a fully paid OPEN checkout order is fulfilled, while failed, refunded or unrelated payments cannot grant seats',async()=>{
  const attempt={id:'attempt',kind:'class',environment:'sandbox',location_id:'test-location',order_id:'paid-open',expected_amount_cents:2000};
  const order={id:'paid-open',state:'OPEN',location_id:'test-location',total_money:{amount:2000,currency:'USD'},tenders:[{payment_id:'p-1'}]};
  const payment={id:'p-1',status:'COMPLETED',order_id:'paid-open',location_id:'test-location',amount_money:{amount:2000,currency:'USD'}};
  const checkout=loadSquareModules({fetch:async url=>Response.json(new URL(url).pathname.includes('/orders/')?{order}:{payment})}).load('src/lib/square-checkout.ts');
  assert.equal((await checkout.verifyCheckoutOrder(attempt)).paid,true);
  payment.status='FAILED';await assert.rejects(checkout.verifyCheckoutOrder(attempt),/requires review/);
  payment.status='COMPLETED';payment.refunded_money={amount:1000,currency:'USD'};await assert.rejects(checkout.verifyCheckoutOrder(attempt),/requires review/);
  delete payment.refunded_money;payment.order_id='another';await assert.rejects(checkout.verifyCheckoutOrder(attempt),/requires review/);
  order.state='DRAFT';assert.equal((await checkout.verifyCheckoutOrder(attempt)).paid,false);
});

test('membership pause/resume/cancel call Square; resuming a scheduled pause deletes the pending action',async t=>{
  const db=await squareTestDatabase();t.after(()=>db.close());const admin=localSquareAdmin(db);
  const prepared=await admin.rpc('prepare_square_checkout',{p_household:ids.household,p_kind:'membership',p_environment:'sandbox',p_location:'test-location',p_user:ids.user,p_role:'customer',p_request:{plan_variation_id:'plan-1'}});
  await admin.from('square_checkout_attempts').update({square_subscription_id:'sub-lifecycle'}).eq('id',prepared.data.id);
  const sub={id:'sub-lifecycle',location_id:'test-location',customer_id:'customer-lifecycle',plan_variation_id:'plan-1',version:1,status:'ACTIVE',invoice_ids:[],actions:[]};
  const calls=[];
  const checkout=loadSquareModules({env:{MEMBERSHIP_PAYMENTS_ENABLED:'true'},fetch:async(url,options)=>{
    const parsed=new URL(url);calls.push({path:parsed.pathname,method:options.method,body:options.body?JSON.parse(options.body):null});
    if(options.method==='GET')assert.equal(parsed.searchParams.get('include'),'actions');
    return Response.json({subscription:sub});
  }}).load('src/lib/square-checkout.ts');
  await checkout.changeSquareMembership(admin,ids.household,'pause');assert.equal(calls.at(-1).path,'/v2/subscriptions/sub-lifecycle/pause');
  sub.status='PAUSED';await checkout.changeSquareMembership(admin,ids.household,'resume');assert.equal(calls.at(-1).body.resume_change_timing,'IMMEDIATE');
  sub.status='ACTIVE';sub.actions=[{id:'pause-action',type:'PAUSE'}];
  await checkout.changeSquareMembership(admin,ids.household,'resume');assert.equal(calls.at(-1).method,'DELETE');assert.equal(calls.at(-1).path,'/v2/subscriptions/sub-lifecycle/actions/pause-action');
  sub.actions=[];await checkout.changeSquareMembership(admin,ids.household,'cancel');assert.equal(calls.at(-1).path,'/v2/subscriptions/sub-lifecycle/cancel');
  const rows=(await db.query('select renews_at from memberships')).rows;assert.ok(new Date(rows[0].renews_at).getTime()<=Date.now());
});

test('an older payment notification cannot erase a recorded refund',async t=>{
  const db=await squareTestDatabase();t.after(()=>db.close());const admin=localSquareAdmin(db);
  const receipt={p_environment:'sandbox',p_payment:'refunded-payment',p_order:'refunded-order',p_amount:2000,p_refunded:2000,p_status:'COMPLETED',p_updated:'2032-06-01T12:01:00Z'};
  assert.equal((await admin.rpc('save_square_payment_receipt',receipt)).error,null);
  assert.equal((await admin.rpc('save_square_payment_receipt',{...receipt,p_refunded:0,p_updated:'2032-06-01T12:00:00Z'})).error,null);
  const {rows}=await db.query('select refunded_cents from square_payment_receipts');assert.equal(rows[0].refunded_cents,2000);
});
