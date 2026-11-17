import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { localSquareAdmin, loadSquareModules } from './helpers/admission-pos-harness.mjs';
async function fixture(t) {
 const db=new PGlite(); t.after(()=>db.close()); await db.exec(fs.readFileSync('tests/fixtures/class-checkout-installed.sql','utf8'));
 await db.exec(`alter table classes add column end_time timestamptz, add column schedule_note text;
 alter table class_registrations add column attendance_status text default 'unknown';
 create table class_series_programs(id text,class_ids uuid[]);
 create table membership_events(id uuid primary key,household_id uuid,action text,notes text,created_by_user_id uuid,created_by_role text,created_at timestamptz default now());
 alter table households add column name text;
 alter table people add column last_name text;`);
 const user=crypto.randomUUID(),family=crypto.randomUUID(),child=crypto.randomUUID(),klass=crypto.randomUUID(),next=crypto.randomUUID(),other=crypto.randomUUID(),checkout=crypto.randomUUID(),registration=crypto.randomUUID();
 await db.query('insert into auth.users values($1)',[user]);await db.query("insert into households values($1,'fictional@example.invalid')",[family]);await db.query("insert into people(id,household_id,role) values($1,$2,'child')",[child,family]);
 await db.query("insert into classes(id,title,status,price_cents,capacity,start_time) values($1,'Juega en Español','scheduled',2500,8,'2026-11-16T15:30:00Z'),($2,'Juega en Español','scheduled',2500,8,'2026-11-23T15:30:00Z'),($3,'Other class','scheduled',2500,8,'2026-11-19T15:30:00Z')",[klass,next,other]);
 await db.query("insert into class_registrations(id,class_id,person_id,household_id,child_id,status,created_by_user_id) values($1,$2,$3,$4,$3,'scheduled',$5)",[registration,klass,child,family,user]);
 const payload={request:{person_id:child,items:[{class_id:klass,quantity:1},{class_id:other,quantity:1}]},assignments:[{class_id:klass,person_id:child},{class_id:other,person_id:child}],line_items:[{quantity:'1',base_price_money:{amount:2500,currency:'USD'}},{quantity:'1',base_price_money:{amount:2500,currency:'USD'}}],provider_request:{order:{line_items:[{quantity:'1',base_price_money:{amount:2500,currency:'USD'}},{quantity:'1',base_price_money:{amount:2500,currency:'USD'}}]}}};
 await db.query("insert into square_checkout_attempts(id,household_id,kind,environment,location_id,expected_amount_cents,payload,status,order_id,created_by_user_id) values($1,$2,'class','sandbox','test-location',5000,$3,'completed','order-test',$4)",[checkout,family,JSON.stringify(payload),user]);
 const requests=[],emails=[],mailControl={failOwner:0};const refunds=new Map();const payment={id:'payment-test',order_id:'order-test',location_id:'test-location',status:'COMPLETED',amount_money:{amount:5000,currency:'USD'},refund_ids:[]};
 const fetch=async(url,opt={})=>{const p=new URL(url).pathname,body=opt.body&&JSON.parse(opt.body);requests.push({path:p,body,method:opt.method||'GET'});
 if(p==='/v2/orders/order-test')return Response.json({order:{id:'order-test',reference_id:checkout,location_id:'test-location',total_money:{amount:5000,currency:'USD'},tenders:[{payment_id:payment.id}]}});
 if(p==='/v2/payments/payment-test')return Response.json({payment});
 if(p==='/v2/refunds'&&opt.method==='POST'){if(!refunds.has(body.idempotency_key)){const r={id:'refund-'+refunds.size,payment_id:body.payment_id,amount_money:body.amount_money,status:'PENDING',reason:body.reason};refunds.set(body.idempotency_key,r);payment.refund_ids.push(r.id);payment.refunded_money={amount:body.amount_money.amount};}return Response.json({refund:refunds.get(body.idempotency_key)});}
 if(p.startsWith('/v2/refunds/'))return Response.json({refund:[...refunds.values()].find(r=>r.id===p.split('/').at(-1))});
 throw Error('Unexpected request '+p);
 };
 const env={RESEND_API_KEY:'test-email-secret',RESEND_FROM_EMAIL:'Little Wanderers <hello@example.invalid>'};
 const runtime=loadSquareModules({fetch,env,mocks:{'@/lib/email-campaigns':{sendResendEmail:async m=>{emails.push(m);if(m.idempotencyKey.startsWith('class-choice-owner/')&&mailControl.failOwner>0){mailControl.failOwner--;return {ok:false,error:'Temporary mail outage'};}return {ok:true,id:'email-'+emails.length};}}}});
 const flow=runtime.load('src/lib/class-cancellations.ts'),admin=localSquareAdmin(db);const run=(dryRun=false)=>flow.runClassMinimumCancellations(admin,{dryRun,now:new Date('2026-11-16T12:00:00Z')});
 const token=async()=>flow.classCancellationToken((await db.query('select id from membership_events')).rows[0].id);
 return {db,admin,flow,run,token,klass,next,other,registration,checkout,child,family,user,payment,requests,emails,refunds,mailControl};
}

test('completed transfer notifies the owner once with family, dates and credit; link reads never send',async t=>{
 const h=await fixture(t);await h.db.query('update households set name=$1 where id=$2',['Maltz <family>',h.family]);await h.db.query('update people set first_name=$1,last_name=$2 where id=$3',['William','Maltz',h.child]);
 await h.run();const token=await h.token();await h.flow.readClassCancellation(h.admin,token);assert.equal(h.emails.length,1);
 await h.flow.chooseClassCancellation(h.admin,token,'transfer');await h.flow.chooseClassCancellation(h.admin,token,'transfer');await h.run();
 const messages=h.emails.filter(e=>e.idempotencyKey.startsWith('class-choice-owner/'));assert.equal(messages.length,1);assert.equal(messages[0].to,'hello@thelittlewanderers.com');
 assert.match(messages[0].html,/Maltz &lt;family&gt;/);assert.match(messages[0].html,/William Maltz/);assert.match(messages[0].html,/November 16/);assert.match(messages[0].html,/November 23/);assert.match(messages[0].html,/\$25.00/);assert(!messages[0].html.includes(token));
});
test('mail outage preserves the completed choice and retries the same frozen owner alert',async t=>{
 const h=await fixture(t);await h.run();h.mailControl.failOwner=1;const token=await h.token();assert.equal((await h.flow.chooseClassCancellation(h.admin,token,'refund')).state,'refunded');
 assert.equal(h.refunds.size,1);const n=(await h.flow.readClassCancellation(h.admin,token)).notice;assert(!n.owner_notice.sent_at);assert.match(n.owner_notice.payload.html,/PENDING/);
 assert.equal((await h.run()).ok,true);const messages=h.emails.filter(e=>e.idempotencyKey.startsWith('class-choice-owner/'));assert.equal(messages.length,2);assert.equal(JSON.stringify(messages[0]),JSON.stringify(messages[1]));assert.equal(h.refunds.size,1);
 assert((await h.flow.readClassCancellation(h.admin,token)).notice.owner_notice.sent_at);
});
test('7 AM Eastern handles standard time and daylight saving time, excludes prior/future days',async t=>{const h=await fixture(t);for(const [start,now,expected] of [['2026-11-16T15:30:00Z','2026-11-16T11:59:59Z',false],['2026-11-16T15:30:00Z','2026-11-16T12:00:00Z',true],['2027-06-14T14:30:00Z','2027-06-14T11:00:00Z',true],['2026-11-17T15:30:00Z','2026-11-16T12:00:00Z',false]])assert.equal(h.flow.classMinimumDue({start_time:start},new Date(now)),expected);});
test('preview is read-only; single-child cancellation sends personal choices once and leaves other dates intact',async t=>{const h=await fixture(t);assert.equal((await h.run(true)).results[0].confirmed,1);assert.equal((await h.db.query('select count(*)::int n from membership_events')).rows[0].n,0);assert.equal(h.emails.length,0);assert.equal((await h.run()).sent,1);assert.match(h.emails[0].html,/Move to next week/);assert.match(h.emails[0].html,/\$25.00 refund/);assert.match(h.emails[0].html,/Monday, November 23/);assert.equal((await h.run()).sent,0);assert.equal(h.emails.length,1);assert.equal((await h.db.query('select status from classes where id=$1',[h.other])).rows[0].status,'scheduled');const token=await h.token();assert.equal((await h.flow.readClassCancellation(h.admin,token)).notice.state,'pending');assert.equal(h.refunds.size,0);await assert.rejects(h.flow.readClassCancellation(h.admin,token.slice(0,-1)+'x'));});
test('two confirmed children run; interest and Jamie series do not trigger the drop-in policy',async t=>{const h=await fixture(t);for(let i=0;i<1;i++)await h.db.query("insert into class_registrations(class_id,person_id,status) values($1,$2,'scheduled')",[h.klass,crypto.randomUUID()]);assert.equal((await h.run()).results[0].action,'run');assert.equal(h.emails.length,0);await h.db.query("update class_registrations set status='preregistered' where id<>$1",[h.registration]);await h.db.query('insert into class_series_programs values($1,$2)',['series',[h.klass]]);assert.equal((await h.run()).results.length,0);});
test('refund returns only cancelled date from a multi-date payment, retries and changed decisions cannot refund twice',async t=>{const h=await fixture(t);await h.run();const token=await h.token();assert.equal((await h.flow.chooseClassCancellation(h.admin,token,'refund')).state,'refunded');assert.equal(h.refunds.size,1);assert.equal([...h.refunds.values()][0].amount_money.amount,2500);assert.equal((await h.flow.chooseClassCancellation(h.admin,token,'refund')).state,'refunded');assert.equal((await h.flow.chooseClassCancellation(h.admin,token,'transfer')).state,'refunded');assert.equal(h.refunds.size,1);assert.equal((await h.db.query('select status from class_registrations where id=$1',[h.registration])).rows[0].status,'cancelled');});
test('transfer consumes a held seat without another charge and keeps refund available when the target is full',async t=>{const h=await fixture(t);await h.run();const token=await h.token();await h.db.query('update classes set capacity=0 where id=$1',[h.next]);await assert.rejects(h.flow.chooseClassCancellation(h.admin,token,'transfer'),/seats/);assert.equal((await h.flow.readClassCancellation(h.admin,token)).notice.state,'pending');await h.db.query('update classes set capacity=8 where id=$1',[h.next]);const result=await h.flow.chooseClassCancellation(h.admin,token,'transfer');assert.equal(result.state,'transferred');assert.equal((await h.flow.chooseClassCancellation(h.admin,token,'transfer')).state,'transferred');assert.equal((await h.db.query("select count(*)::int n from class_registrations where class_id=$1 and status='scheduled'",[h.next])).rows[0].n,1);assert.equal(h.requests.length,0);assert.equal(h.refunds.size,0);assert.equal((await h.db.query("select count(*)::int n from square_checkout_attempts where status in ('creating','open')")).rows[0].n,0);});
test('existing target booking cannot consume a second credit and unavailable date still permits a refund',async t=>{const h=await fixture(t);await h.run();const token=await h.token();await h.db.query("insert into class_registrations(class_id,person_id,status) values($1,$2,'scheduled')",[h.next,h.child]);await assert.rejects(h.flow.chooseClassCancellation(h.admin,token,'transfer'),/already has/);assert.equal((await h.flow.chooseClassCancellation(h.admin,token,'refund')).state,'refunded');});
test('exactly two confirmed children keep the class; paid series are excluded regardless of count',async t=>{const h=await fixture(t);for(let i=0;i<1;i++){const id=crypto.randomUUID();await h.db.query("insert into people(id,household_id,role) values($1,$2,'child')",[id,h.family]);await h.db.query("insert into class_registrations(class_id,person_id,status) values($1,$2,'scheduled')",[h.klass,id]);}const r=await h.run();assert.equal(r.results[0].action,'run');assert.equal(h.emails.length,0);assert.equal((await h.db.query('select status from classes where id=$1',[h.klass])).rows[0].status,'scheduled');await h.db.query('insert into class_series_programs values($1,$2)',['jamie',`{${h.klass}}`]);assert.equal((await h.run()).results.length,0);});
test('email scans and forged tokens cannot select an option or expose family details',async t=>{const h=await fixture(t);await h.run();const token=await h.token();const n=(await h.flow.readClassCancellation(h.admin,token)).notice;assert.equal(n.state,'pending');await h.flow.readClassCancellation(h.admin,token);await assert.rejects(h.flow.readClassCancellation(h.admin,token.slice(0,-1)+(token.endsWith('0')?'1':'0')),/invalid/);assert.equal(h.requests.length,0);assert.equal((await h.flow.readClassCancellation(h.admin,token)).notice.state,'pending');});
test('competing choices cannot both transfer and refund',async t=>{const h=await fixture(t);await h.run();const token=await h.token();const results=await Promise.allSettled([h.flow.chooseClassCancellation(h.admin,token,'transfer'),h.flow.chooseClassCancellation(h.admin,token,'refund')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const n=(await h.flow.readClassCancellation(h.admin,token)).notice;assert(['transferred','refunded'].includes(n.state));const seats=(await h.db.query("select count(*)::int n from class_registrations where class_id=$1 and status='scheduled'",[h.next])).rows[0].n;assert.equal(seats,n.state==='transferred'?1:0);assert.equal(h.refunds.size,n.state==='refunded'?1:0);});
test('transfer promotes the same saved-interest record and repeat cancellation keeps the original paid credit',async t=>{const h=await fixture(t);const prereg=crypto.randomUUID();await h.db.query("insert into class_registrations(id,class_id,person_id,household_id,status) values($1,$2,$3,$4,'preregistered')",[prereg,h.next,h.child,h.family]);await h.run();const result=await h.flow.chooseClassCancellation(h.admin,await h.token(),'transfer');assert.equal(result.target_registration_id,prereg);const r=await h.flow.runClassMinimumCancellations(h.admin,{dryRun:false,classId:h.next,now:new Date('2026-11-17T12:00:00Z')});assert.equal(r.ok,true);const records=(await h.db.query('select id,notes from membership_events')).rows;const next=records.find(e=>JSON.parse(e.notes).class_id===h.next);assert.equal(JSON.parse(next.notes).checkout_id,h.checkout);assert.equal(JSON.parse(next.notes).amount_cents,2500);await h.flow.chooseClassCancellation(h.admin,h.flow.classCancellationToken(next.id),'refund');assert.equal(h.refunds.size,1);});
test('a provider amount mismatch never submits a refund and remains retryable with the same selection',async t=>{const h=await fixture(t);await h.run();const token=await h.token();h.payment.amount_money.amount=4999;await assert.rejects(h.flow.chooseClassCancellation(h.admin,token,'refund'),/review/);assert.equal(h.refunds.size,0);h.payment.amount_money.amount=5000;assert.equal((await h.flow.chooseClassCancellation(h.admin,token,'refund')).state,'refunded');});


test('one confirmed child waits until 7 AM Eastern, then receives the two-child policy and choices once', async t => {
 const h=await fixture(t);
 const early=await h.flow.runClassMinimumCancellations(h.admin,{dryRun:false,now:new Date('2026-11-16T11:59:59Z')});
 assert.equal(early.results.length,0);assert.equal(h.emails.length,0);
 assert.equal((await h.db.query('select status from classes where id=$1',[h.klass])).rows[0].status,'scheduled');
 const due=await h.run();assert.equal(due.sent,1);
 assert.match(h.emails[0].html,/at least 2 children/);assert.match(h.emails[0].html,/2-child minimum/);
 assert.match(h.emails[0].html,/Move to next week/);assert.match(h.emails[0].html,/Get a \$25.00 refund/);
 assert.doesNotMatch(h.emails[0].html,/fewer than 3|at least 3|3-child/);
 assert.equal((await h.run()).sent,0);assert.equal(h.emails.length,1);
});

test('a second payment confirmed during cancellation retains the class and suppresses its queued email', async t => {
 const h=await fixture(t),second=crypto.randomUUID();
 await h.db.query("insert into people(id,household_id,role) values($1,$2,'child')",[second,h.family]);
 let injected=false;
 const racingAdmin={...h.admin,from(table){
  const q=h.admin.from(table);
  if(table==='classes'){
   const update=q.update.bind(q);let cancelling=false;
   q.update=patch=>{cancelling=patch.status==='cancelled';return update(patch);};
   const maybeSingle=q.maybeSingle.bind(q);
   q.maybeSingle=async()=>{const result=await maybeSingle();if(cancelling&&result.data&&!injected){injected=true;await h.db.query("insert into class_registrations(class_id,person_id,status) values($1,$2,'scheduled')",[h.klass,second]);}return result;};
  }
  return q;
 }};
 const result=await h.flow.runClassMinimumCancellations(racingAdmin,{dryRun:false,now:new Date('2026-11-16T12:00:00Z')});
 assert.equal(result.ok,true);assert.equal(injected,true);assert(result.results.some(r=>r.action==='retained_after_payment_race'));
 assert.equal((await h.db.query('select status from classes where id=$1',[h.klass])).rows[0].status,'scheduled');
 assert.equal(h.emails.length,0);assert.equal(h.requests.length,0);assert.equal(h.refunds.size,0);
});
