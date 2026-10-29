import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {squareTestDatabase,localSquareAdmin,loadSquareModules,ids} from './helpers/square-harness.mjs';
const adult='30000000-0000-4000-8000-000000000003',sibling='30000000-0000-4000-8000-000000000004',baby='30000000-0000-4000-8000-000000000005';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function prepare(admin,kind,request){const r=await admin.rpc('prepare_square_checkout',{p_household:ids.household,p_kind:kind,p_environment:'sandbox',p_location:'test-location',p_user:ids.user,p_role:'customer',p_request:request});if(r.error)throw new Error(r.error.message);return r.data;}
async function family(db){await db.query("insert into people(id,household_id,role,first_name,birthdate) values($1,$2,'adult','Parent',null),($3,$2,'child','Sibling','2023-01-01'),($4,$2,'child','Baby',(now() at time zone 'America/New_York')::date-interval '2 months')",[adult,ids.household,sibling,baby]);}
async function staff(db){await db.exec(`alter table people add column last_name text; alter table memberships add column person_id uuid;
 create table roles(id uuid,role text);create table user_roles(user_id uuid,role text);
 create table waivers(household_id uuid,waiver_version text,signed_at timestamptz,waiver_expires_at timestamptz,electronic_signature text,covered_person_ids uuid[]);
 create table occupancy_events(event_type text,delta integer,created_by uuid);
 insert into roles values('${ids.user}','staff');
 insert into waivers select '${ids.household}','test',now()-interval '1 day',now()+interval '89 days','Test Parent',array_agg(id) from people where household_id='${ids.household}';`);}
const scan=(admin,person)=>admin.rpc('checkin_person',{p_person_id:person,p_staff_user_id:ids.user,p_staff_role:'staff',p_source:'qr',p_waiver_version:'test',p_environment:'sandbox'});

test('membership monthly quote and frozen entitlements follow first-child/sibling/infant policy',async t=>{
 const db=await squareTestDatabase();t.after(()=>db.close());await family(db);const admin=localSquareAdmin(db);
 await assert.rejects(prepare(admin,'membership',{plan_variation_id:'plan',quoted_amount_cents:6000}),/quote changed/);
 const a=await prepare(admin,'membership',{plan_variation_id:'plan',quoted_amount_cents:8000});assert.equal(a.expected_amount_cents,8000);assert.equal(a.payload.assignments.length,3);
 await admin.from('square_checkout_attempts').update({square_subscription_id:'sub-family'}).eq('id',a.id);
 const applied=await admin.rpc('apply_square_membership',{p_attempt:a.id,p_subscription:'sub-family',p_customer:'customer',p_status:'ACTIVE',p_version:1,p_paid_through:'2032-01-01',p_review:false});assert.equal(applied.error,null);
 const m=(await db.query('select covered_person_ids from memberships')).rows[0];assert.deepEqual([...m.covered_person_ids].sort(),[ids.person,sibling,baby].sort());
});

test('renewals use enrolled ages on invoice date; next-cycle infant rate changes do not extend unpaid access',async()=>{
 const calls=[];let applied;
 const a={id:'a',environment:'sandbox',square_subscription_id:'sub',expected_amount_cents:6000,payload:{request:{plan_variation_id:'plan'},assignments:[{id:'one',birthdate:'2023-01-01'},{id:'baby',birthdate:'2032-01-15'}]}};
 const sub={id:'sub',customer_id:'c',location_id:'test-location',plan_variation_id:'plan',status:'ACTIVE',version:2,invoice_ids:['inv'],charged_through_date:'2032-07-14'};
 const invoice={id:'inv',subscription_id:'sub',location_id:'test-location',primary_recipient:{customer_id:'c'},status:'PAID',payment_requests:[{due_date:'2032-06-15',total_completed_amount_money:{amount:6000,currency:'USD'}}]};
 const admin={rpc:async(_n,args)=>{applied=args;return {error:null}}};
 const checkout=loadSquareModules({fetch:async(url,o)=>{calls.push({path:new URL(url).pathname,method:o.method,body:o.body&&JSON.parse(o.body)});return Response.json(o.method==='PUT'?{subscription:sub}:{invoice});}}).load('src/lib/square-checkout.ts');
 await checkout.reconcileMembership(admin,a,sub);assert.ok(applied.p_paid_through);assert.equal(calls.at(-1).method,'PUT');assert.equal(calls.at(-1).body.subscription.price_override_money.amount,8000);
 invoice.payment_requests[0].due_date='2032-07-15';invoice.payment_requests[0].total_completed_amount_money.amount=8000;sub.charged_through_date='2032-08-14';
 await checkout.reconcileMembership(admin,a,sub);assert.ok(applied.p_paid_through);
 invoice.status='UNPAID';await checkout.reconcileMembership(admin,a,sub);assert.equal(applied.p_paid_through,null);
});

test('admission quote rejects household/price forgery; verified payment creates date-bound one-use family passes',async t=>{
 const db=await squareTestDatabase();t.after(()=>db.close());await family(db);const admin=localSquareAdmin(db);
 const request={visit_date:today(),person_ids:[adult,ids.person,sibling,baby],quoted_amount_cents:3600};
 await assert.rejects(prepare(admin,'admission',{...request,quoted_amount_cents:1}),/quote changed/);
 await assert.rejects(prepare(admin,'admission',{...request,person_ids:[adult,ids.otherPerson]}),/not found/);
 const a=await prepare(admin,'admission',request);assert.equal(a.expected_amount_cents,3600);assert.equal(a.payload.assignments.length,4);
 assert.match((await admin.rpc('fulfill_square_admission_checkout',{p_id:a.id})).error.message,/verified/);
 await admin.from('square_checkout_attempts').update({order_id:'admission-order'}).eq('id',a.id);
 await admin.from('square_payment_receipts').insert({environment:'sandbox',payment_id:'admission-payment',order_id:'admission-order',amount_cents:3600,status:'COMPLETED'});
 assert.equal((await admin.rpc('fulfill_square_admission_checkout',{p_id:a.id})).error,null);
 assert.equal((await admin.rpc('fulfill_square_admission_checkout',{p_id:a.id})).error,null);
 assert.equal((await db.query('select * from admission_passes')).rows.length,4);
 await staff(db);const checkin=await scan(admin,ids.person);assert.equal(checkin.error,null);assert.equal(checkin.data.payment_status,'paid');assert.equal(checkin.data.price_cents,0);
 assert.equal((await scan(admin,ids.person)).data.code,'already_checked_in');
 assert.equal((await db.query("select count(*)::int n from admission_passes where status='used'")).rows[0].n,1);
});

test('paid membership covers only enrolled children and never hides extra adult charges',async t=>{
 const db=await squareTestDatabase();t.after(()=>db.close());await family(db);await staff(db);const admin=localSquareAdmin(db);
 await db.query("insert into memberships(household_id,renews_at,square_environment,covered_person_ids) values($1,now()+interval '30 days','sandbox',$2)",[ids.household,[ids.person]]);
 assert.equal((await scan(admin,ids.person)).data.price_cents,0);
 assert.equal((await scan(admin,sibling)).data.price_cents,1600);
 assert.equal((await scan(admin,adult)).data.price_cents,0);
 for(let i=0;i<2;i++){const id=crypto.randomUUID();await db.query("insert into people(id,household_id,role,first_name) values($1,$2,'adult','Guest')",[id,ids.household]);const res=await scan(admin,id);assert.equal(res.error,null);assert.equal(res.data.price_cents,i===0?0:500);assert.equal(res.data.membership_applied,false);}
});

test('POS launch is single-use and receipt identity, environment, amount and refund checks protect payment status',async t=>{
 const db=await squareTestDatabase();t.after(()=>db.close());const admin=localSquareAdmin(db);const id=crypto.randomUUID();await db.query("insert into checkins(id,person_id,price_cents,payment_status) values($1,$2,1600,'due')",[id,ids.person]);
 const order={id:'pos-order',location_id:'test-location',state:'COMPLETED',total_money:{amount:1600,currency:'USD'},tenders:[{payment_id:'pos-payment'}]};let payment;
 const pos=loadSquareModules({env:{ADMISSION_PAYMENTS_ENABLED:'true',SQUARE_APPLICATION_ID:'app'},fetch:async url=>Response.json(new URL(url).pathname.includes('/orders/')?{order}:{payment})}).load('src/lib/square-admission-pos.ts');
 const first=await pos.startAdmissionPos(admin,[id],ids.user);assert.match(first.url,/square-commerce-v1:/);assert.equal((await pos.startAdmissionPos(admin,[id],ids.user)).url,null);
 const sale=(await db.query('select * from admission_pos_sales')).rows[0];payment={id:'pos-payment',status:'COMPLETED',order_id:order.id,location_id:'test-location',amount_money:{amount:1600,currency:'USD'},note:'wrong',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
 await assert.rejects(pos.verifyAdmissionPos(admin,sale,order.id),/reference/);payment.note=`LW admission ${sale.id}`;
 payment.refunded_money={amount:100,currency:'USD'};await assert.rejects(pos.verifyAdmissionPos(admin,sale,order.id),/review/);delete payment.refunded_money;
 await pos.verifyAdmissionPos(admin,sale,order.id);assert.equal((await db.query('select payment_status from checkins where id=$1',[id])).rows[0].payment_status,'paid');
 await pos.verifyAdmissionPos(admin,{...sale,status:'paid',order_id:order.id},order.id);
 await db.exec('set role authenticated');await assert.rejects(db.query('update admission_pos_sales set status=\'paid\''),/permission denied/);await db.exec('reset role');
});
