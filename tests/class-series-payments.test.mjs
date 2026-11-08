import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const db = new PGlite();
after(() => db.close());
const user = crypto.randomUUID(), family = crypto.randomUUID(), other = crypto.randomUUID();
const children = Array.from({length:4},()=>crypto.randomUUID());
await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key);
create table households(id uuid primary key,email text);
create table household_members(household_id uuid,user_id uuid);
create table roles(id uuid,role text);
create table people(id uuid primary key,household_id uuid,role text);
create table classes(id uuid primary key,title text,start_time timestamptz,status text,price_cents integer,capacity integer);
create table class_registrations(id uuid primary key default gen_random_uuid(),class_id uuid,person_id uuid,household_id uuid,child_id uuid,status text,created_by_user_id uuid,created_by_role text,waitlist_offer_token text,waitlist_offer_expires_at timestamptz,waitlist_offered_at timestamptz,unique(class_id,person_id));`);
await db.query('insert into auth.users values($1)',[user]);
await db.query("insert into roles values($1,'owner')",[user]);
await db.query("insert into households values($1,'first@example.com'),($2,'second@example.com')",[family,other]);
for(let i=0;i<4;i++) await db.query("insert into people values($1,$2,'child')",[children[i],i<2?family:other]);
for(const date of ['2026-11-12','2026-11-19','2026-12-03','2026-12-10','2026-12-17']) await db.query("insert into classes values($1,'Little Hands, Big Canvases',$2,'scheduled',15000,7)",[crypto.randomUUID(),`${date}T22:00:00Z`]);
await db.exec(fs.readFileSync('db/migrations/20261108_class_series_payments.sql','utf8'));
await db.exec("update class_series_programs set due_at=now()+interval '7 days',payments_enabled=true");
const program='jamie-art-2026-11-12';
const query=async(sql,params=[])=>(await db.query(sql,params)).rows;
const prepare=async(ids=children.slice(0,2),household=family)=>(await query("select * from prepare_class_series_sale($1,$2,$3,$4,'sandbox','loc','invoice')",[program,household,ids,user]))[0];
const bind=async(sale)=>{await db.query('update class_series_sales set square_order_id=$2,square_invoice_id=$3 where id=$1',[sale.id,`o-${sale.id}`,`i-${sale.id}`]);return sale;};
const hold=async(sale)=>(await query('select * from hold_class_series_sale($1,false)',[sale.id]))[0];

test('database prices one full series, applies sibling discount once, and deduplicates retries',async()=>{
 const a=await prepare();assert.equal(a.amount_cents,28000);assert.equal(a.class_ids.length,5);
 assert.equal((await prepare()).id,a.id);
 await assert.rejects(prepare([children[0],children[0]]),/distinct children/);
 await assert.rejects(prepare([children[2]]),/your family/);
 await assert.rejects(prepare([children[0]]),/already exists/);
});
test('interest never consumes capacity; concurrent family holds cannot oversell any series session',async()=>{
 const a=await bind(await prepare());
 await db.query("insert into class_registrations(class_id,person_id,status) select id,$1,'preregistered' from classes",[children[0]]);
 await db.exec('update classes set capacity=2');
 await hold(a);
 const b=await bind(await prepare([children[2]],other));
 await assert.rejects(hold(b),/Not enough seats/);
 assert.equal((await query("select count(*)::int as n from class_registrations where status='scheduled'"))[0].n,0);
});
test('payment verification promotes all five sessions atomically and preserves interest IDs',async()=>{
 const sale=await prepare();
 const before=await query('select id from class_registrations where person_id=$1',[children[0]]);
 const args=[sale.id,`o-${sale.id}`,['receipt-one'],28000];
 const paid=(await query('select * from fulfill_class_series_sale($1,$2,$3,$4)',args))[0];assert.equal(paid.status,'paid');
 assert.equal((await query("select count(*)::int n from class_registrations where status='scheduled'"))[0].n,10);
 assert.deepEqual((await query('select id from class_registrations where person_id=$1',[children[0]])).map(r=>r.id).sort(),before.map(r=>r.id).sort());
 assert.equal((await query('select * from fulfill_class_series_sale($1,$2,$3,$4)',args))[0].status,'paid');
 assert.equal((await query('select count(*)::int n from class_series_payment_receipts'))[0].n,1);
 await assert.rejects(query("select cancel_class_series_sale($1,'CANCELED')",[sale.id]),/Verify/);
});
test('holds release only after the provider invoice is closed; authenticated users cannot read private sales',async()=>{
 const b=(await query('select * from class_series_sales where household_id=$1',[other]))[0];
 await assert.rejects(query("select cancel_class_series_sale($1,'UNPAID')",[b.id]),/Verify/);
 await query("select cancel_class_series_sale($1,'DELETED')",[b.id]);
 assert.equal((await query('select status from class_series_sales where id=$1',[b.id]))[0].status,'cancelled');
 await db.exec('set role authenticated');
 await assert.rejects(query('select * from class_series_sales'),/permission denied/);
 await db.exec('reset role');
});

function providerHarness({ invoiceStatus='PAID', amount=15000, paymentOrder='order', refunded=0, paymentStatus='COMPLETED' }={}) {
 const sale={id:crypto.randomUUID(),program_id:program,household_id:family,child_ids:[children[0]],class_ids:[],environment:'sandbox',location_id:'loc',amount_cents:15000,discount_cents:0,recipient_email:'parent@example.com',source:'invoice',status:'held',due_at:'2099-01-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z',square_customer_id:'customer',square_order_id:'order',square_invoice_id:'invoice',payment_url:null};
 const requests=[],rpc=[];
 const squareRequest=async(path,method='GET',body)=>{
  requests.push({path,method,body});
  if(path==='/v2/customers')return {customer:{id:'customer'}};
  if(path==='/v2/orders'&&method==='POST')return {order:{id:'order',total_money:{amount:15000,currency:'USD'}}};
  if(path==='/v2/invoices'&&method==='POST')return {invoice:{id:'invoice',version:0,status:'DRAFT',order_id:'order'}};
  if(path.startsWith('/v2/invoices/'))return {invoice:{id:'invoice',version:1,status:invoiceStatus,order_id:'order',location_id:'loc',primary_recipient:{customer_id:'customer'}}};
  if(path==='/v2/orders/order')return {order:{id:'order',location_id:'loc',reference_id:`cs_${sale.id}`,customer_id:'customer',total_money:{amount:15000,currency:'USD'},net_amount_due_money:{amount:0,currency:'USD'},tenders:[{payment_id:'payment'}]}};
  if(path==='/v2/payments/payment')return {payment:{id:'payment',order_id:paymentOrder,location_id:'loc',status:paymentStatus,amount_money:{amount,currency:'USD'},refunded_money:{amount:refunded},created_at:'2026-01-02T00:00:00Z'}};
  throw Error(`Unexpected request ${path}`);
 };
 const admin={from(){let patch;const q={update(p){patch=p;Object.assign(sale,p);return q;},select(){return q;},eq(){return q;},in(){return q;},single:async()=>({data:{...sale},error:null}),then(resolve){resolve({data:patch?sale:[{id:children[0],first_name:'Test',last_name:'Child'}],error:null});}};return q;},async rpc(name,args){rpc.push({name,args});return {data:{...sale,status:name==='fulfill_class_series_sale'?'paid':sale.status},error:null};}};
 const client={squareConfig:()=>({environment:'sandbox',locationId:'loc'}),squareRequest,assertUsd(money,expected){assert.equal(money.currency,'USD');assert.equal(money.amount,expected);}};
 const module=loadModule('src/lib/class-series-payments.ts',{'@/lib/square-client':client},{console});
 return {sale,requests,rpc,admin,module};
}
test('a draft invoice includes deadline, refund terms, all dates, and cannot send email',async()=>{
 const h=providerHarness();Object.assign(h.sale,{square_customer_id:null,square_order_id:null,square_invoice_id:null,status:'draft'});
 await h.module.createSeriesInvoiceDraft(h.admin,{householdId:family,childIds:[children[0]],userId:user,source:'invoice'});
 const invoice=h.requests.find(r=>r.path==='/v2/invoices').body.invoice;
 assert.equal(invoice.delivery_method,'EMAIL');assert.equal(invoice.payment_requests[0].due_date,'2026-11-11');
 assert.match(invoice.description,/nonrefundable unless canceled by the instructor/);
 assert.match(invoice.description,/November 11, 2026 at 5:00 PM Eastern/);
 assert.match(invoice.description,/November 12, November 19, December 3, December 10, and December 17/);
 assert.equal(h.requests.some(r=>r.path.endsWith('/publish')),false);
});
test('return URLs or invoice status alone cannot confirm a seat without verified exact-amount receipts',async()=>{
 for(const options of [{invoiceStatus:'UNPAID'},{amount:13000},{paymentOrder:'wrong'},{refunded:1},{paymentStatus:'PENDING'}]){
  const h=providerHarness(options);
  try{await h.module.verifySeriesPayment(h.admin,h.sale);}catch{}
  assert.equal(h.rpc.some(r=>r.name==='fulfill_class_series_sale'),false,JSON.stringify(options));
 }
 const good=providerHarness();assert.equal((await good.module.verifySeriesPayment(good.admin,good.sale)).status,'paid');
 assert.equal(good.rpc[0].name,'fulfill_class_series_sale');
});
