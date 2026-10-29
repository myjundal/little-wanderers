import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {loadSquareModules,localSquareAdmin,ids} from './helpers/admission-pos-harness.mjs';
import {loadModule} from './helpers/class-preregistration-harness.mjs';
const checkin='50000000-0000-4000-8000-000000000001',sibling='50000000-0000-4000-8000-000000000002',other='50000000-0000-4000-8000-000000000003';
const date=new Date().toISOString();
async function database(t){
 const db=new PGlite();t.after(()=>db.close());await db.exec(fs.readFileSync('tests/fixtures/admission-pos-schema.sql','utf8'));
 await db.exec(fs.readFileSync('db/migrations/20261029_qr_admission_pos_family.sql','utf8'));
 await db.query('insert into households values($1,$2),($3,$4)',[ids.household,'Test Family',ids.other,'Other Family']);
 await db.query("insert into people values($1,$2,'First','Child'),($3,$2,'Sibling','Child'),($4,$5,'Other','Child')",[ids.person,ids.household,sibling,ids.otherPerson,ids.other]);
 await db.query("insert into checkins(id,person_id,price_cents,payment_status) values($1,$2,1600,'due'),($3,$3,1000,'due'),($4,$5,1600,'due')",[checkin,ids.person,sibling,other,ids.otherPerson]);
 return {db,admin:localSquareAdmin(db)};
}
function modules(fetch,env={}){return loadSquareModules({env:{ADMISSION_POS_PAYMENTS_ENABLED:'true',ADMISSION_PAYMENTS_ENABLED:'false',SQUARE_APPLICATION_ID:'test-app',...env},fetch});}
const prepare=(admin,selection=[checkin,sibling],user=ids.user)=>admin.rpc('prepare_admission_pos',{p_ids:selection,p_user:user,p_environment:'sandbox',p_location:'test-location'});

test('POS family grouping automatically totals the scanned family and excludes paid and covered visitors',()=>{
 const {admissionGroups,squarePosCallback}=modules().load('src/lib/admission-pos-ui.ts');
 const row={person_id:'a',household_id:'family-a',household_name:'Family A',name:'Child',payment_status:'due'};
 const groups=admissionGroups([{...row,id:'one',price_cents:1600},{...row,id:'two',price_cents:1000},{...row,id:'paid',price_cents:1600,payment_status:'paid'},{...row,id:'member',price_cents:0,payment_status:'covered'},{...row,id:'other',price_cents:1600,household_id:'family-b'}]);
 assert.equal(groups.length,2);assert.equal(groups[0].total,2600);assert.equal(groups[0].visits.length,2);
 assert.equal(squarePosCallback('?data=invalid').status,'error');assert.equal(squarePosCallback('?data=null').status,'error');
 assert.equal(squarePosCallback(''),null);assert.equal(squarePosCallback('?data='+encodeURIComponent(JSON.stringify({status:'ok',state:'sale',transaction_id:'order'}))).transaction_id,'order');
});

test('database permits one full family only and prevents duplicate or conflicting payment launches',async t=>{
 const {db,admin}=await database(t);
 assert.match((await prepare(admin,[checkin,other])).error.message,/one visiting family/);
 assert.match((await prepare(admin,[checkin])).error.message,/Family admission changed/);
 assert.match((await prepare(admin,[checkin,checkin])).error.message,/Choose unpaid/);
 const sale=await prepare(admin);assert.equal(sale.error,null);assert.equal(sale.data.amount_cents,2600);
 assert.equal((await prepare(admin)).data.id,sale.data.id);
 assert.match((await prepare(admin,[checkin,sibling],ids.other)).error.message,/already in progress/);
 await db.exec('set role authenticated');await assert.rejects(db.query('select prepare_admission_pos($1,$2,$3,$4)',[[checkin,sibling],ids.user,'sandbox','test-location']),/permission denied/);await db.exec('reset role');
});

test('Square request uses the frozen server family total, existing app callback and independent POS flag',async t=>{
 const {admin}=await database(t);const pos=modules().load('src/lib/square-admission-pos.ts');
 const first=await pos.startAdmissionPos(admin,[checkin,sibling],ids.user);
 const data=JSON.parse(new URL(first.url).searchParams.get('data'));
 assert.equal(data.amount_money.amount,2600);assert.equal(data.callback_url,'http://localhost:3000/staff/checkin');assert.equal(data.options.clear_default_fees,true);assert.deepEqual(Array.from(data.options.supported_tender_types),['CREDIT_CARD']);
 assert.equal((await pos.startAdmissionPos(admin,[checkin,sibling],ids.user)).url,null);
 const closed=modules(undefined,{ADMISSION_POS_PAYMENTS_ENABLED:'false',ADMISSION_PAYMENTS_ENABLED:'true'}).load('src/lib/square-admission-pos.ts');
 await assert.rejects(closed.startAdmissionPos(admin,[checkin,sibling],ids.user),/not available/);
});

test('provider-verified completed card receipt marks both check-ins paid; forged and refunded receipts cannot',async t=>{
 const {db,admin}=await database(t);const calls=[];
 const order={id:'pos-order',location_id:'test-location',state:'COMPLETED',total_money:{amount:2600,currency:'USD'},tenders:[{payment_id:'pos-payment'}]};
 const payment={id:'pos-payment',source_type:'CARD',order_id:order.id,location_id:'test-location',status:'COMPLETED',amount_money:{amount:2600,currency:'USD'},created_at:date,updated_at:date,note:'forged'};
 const pos=modules(async(url,options)=>{calls.push(options.method);return Response.json(new URL(url).pathname.includes('/orders/')?{order}:{payment});}).load('src/lib/square-admission-pos.ts');
 const launch=await pos.startAdmissionPos(admin,[checkin,sibling],ids.user);const sale=(await db.query('select * from admission_pos_sales where id=$1',[launch.id])).rows[0];
 await assert.rejects(pos.verifyAdmissionPos(admin,sale,order.id),/reference/);
 payment.note=`LW admission ${sale.id}`;payment.amount_money.amount=100;await assert.rejects(pos.verifyAdmissionPos(admin,sale,order.id),/paid amount/);payment.amount_money.amount=2600;
 payment.refunded_money={amount:1,currency:'USD'};await assert.rejects(pos.verifyAdmissionPos(admin,sale,order.id),/review/);delete payment.refunded_money;
 payment.location_id='other-location';await assert.rejects(pos.verifyAdmissionPos(admin,sale,order.id),/review/);payment.location_id='test-location';
 payment.status='FAILED';await assert.rejects(pos.verifyAdmissionPos(admin,sale,order.id),/review/);payment.status='COMPLETED';
 assert.equal((await db.query("select count(*)::integer n from checkins where payment_status='paid'")).rows[0].n,0);
 order.total_tip_money={amount:200,currency:'USD'};order.total_money.amount=2800;payment.tip_money={amount:200,currency:'USD'};
 await pos.verifyAdmissionPos(admin,sale,order.id);await pos.verifyAdmissionPos(admin,sale,order.id);
 assert.equal((await db.query("select count(*)::integer n from checkins where payment_status='paid'")).rows[0].n,2);
 assert.equal((await db.query('select count(*)::integer n from square_payment_receipts')).rows[0].n,1);
 assert.ok(calls.every(method=>method==='GET'));
});

test('completed Square receipt can be retried after a database failure without another payment launch',async t=>{
 const {db,admin}=await database(t);const sale=(await prepare(admin)).data;
 const order={id:'retry-order',location_id:'test-location',state:'COMPLETED',total_money:{amount:2600,currency:'USD'},tenders:[{payment_id:'retry-payment'}]};
 const payment={id:'retry-payment',source_type:'CARD',order_id:order.id,location_id:'test-location',status:'COMPLETED',amount_money:{amount:2600,currency:'USD'},note:`LW admission ${sale.id}`,created_at:date,updated_at:date};
 const pos=modules(async url=>Response.json(new URL(url).pathname.includes('/orders/')?{order}:{payment})).load('src/lib/square-admission-pos.ts');
 let fail=true;const flaky={...admin,rpc:async(name,args)=>name==='fulfill_admission_pos'&&fail?{error:{message:'DB unavailable'}}:admin.rpc(name,args)};
 await assert.rejects(pos.verifyAdmissionPos(flaky,sale,order.id),/DB unavailable/);fail=false;await pos.verifyAdmissionPos(flaky,sale,order.id);
 assert.equal((await db.query("select count(*)::integer n from checkins where payment_status='paid'")).rows[0].n,2);
});

test('POS API requires staff and verification looks up the signed-in operator’s stored sale',async()=>{
 let expected;
 const base={'@/lib/square-client':{squareConfig:()=>({environment:'production'}),paymentFlowEnabled:()=>true},'@/lib/square-admission-pos':{startAdmissionPos:()=>{throw Error('must not launch')},verifyAdmissionPos:async()=>({status:'paid'})},'@/lib/party-config':{},'@/lib/open-play-reservations':{isUuid:value=>/^[a-f0-9-]{36}$/.test(value)}};
 const denied=loadModule('src/app/api/admin/admission/pos/route.ts',{...base,'@/lib/authz':{requireStaffContext:async()=>({ok:false,response:Response.json({}, {status:403})})}});
 assert.equal((await denied.POST({json:async()=>({})})).status,403);
 const query={select(){return this},eq(key,value){expected??={};expected[key]=value;return this},async maybeSingle(){return {data:null,error:null}}};
 const api=loadModule('src/app/api/admin/admission/pos/route.ts',{...base,'@/lib/authz':{requireStaffContext:async()=>({ok:true,user:{id:'operator'},admin:{from:()=>query}})}});
 const response=await api.POST({json:async()=>({mode:'verify',state:checkin,transaction_id:'order',created_by_user_id:'forged'})});
 assert.equal(response.status,409);assert.equal(expected.created_by_user_id,'operator');assert.equal(expected.environment,'production');
});
