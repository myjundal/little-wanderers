// Only fictional Sandbox customers and an isolated local PostgreSQL database are used.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { loadSquareModules, localSquareAdmin } from '../tests/helpers/admission-pos-harness.mjs';
if(process.env.SQUARE_ENVIRONMENT!=='sandbox')throw Error('Sandbox only');
const modules=loadSquareModules({env:{SQUARE_ENVIRONMENT:'sandbox',SQUARE_ACCESS_TOKEN:process.env.SQUARE_ACCESS_TOKEN,SQUARE_LOCATION_ID:process.env.SQUARE_LOCATION_ID,SQUARE_API_VERSION:process.env.SQUARE_API_VERSION}});
const {squareRequest}=modules.load('src/lib/square-client.ts');
const flow=modules.load('src/lib/class-series-payments.ts');
const db=new PGlite();
const user=crypto.randomUUID(),family=crypto.randomUUID(),one=crypto.randomUUID(),two=crypto.randomUUID();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table roles(id uuid,role text);create table household_members(household_id uuid,user_id uuid);create table households(id uuid primary key,email text);create table people(id uuid primary key,household_id uuid,role text,first_name text,last_name text);create table classes(id uuid primary key,title text,start_time timestamptz,status text,price_cents integer,capacity integer);create table class_registrations(id uuid primary key default gen_random_uuid(),class_id uuid,person_id uuid,household_id uuid,child_id uuid,status text,created_by_user_id uuid,created_by_role text,waitlist_offer_token text,waitlist_offer_expires_at timestamptz,waitlist_offered_at timestamptz,unique(class_id,person_id));`);
await db.query('insert into auth.users values($1)',[user]);await db.query("insert into roles values($1,'owner')",[user]);await db.query("insert into households values($1,'sandbox-family@example.invalid')",[family]);
await db.query("insert into people values($1,$3,'child','First','Sandbox'),($2,$3,'child','Twin','Sandbox')",[one,two,family]);
for(const date of ['2026-11-12','2026-11-19','2026-12-03','2026-12-10','2026-12-17'])await db.query("insert into classes values($1,'Little Hands, Big Canvases',$2,'scheduled',15000,7)",[crypto.randomUUID(),`${date}T22:00:00Z`]);
await db.exec(fs.readFileSync('db/migrations/20261108_class_series_payments.sql','utf8'));await db.exec("update class_series_programs set payments_enabled=true");
const admin=localSquareAdmin(db);
admin.rpc=async(name,args)=>{try{assert(/^[a-z_]+$/.test(name));const {rows}=await db.query(`select to_jsonb(${name}(${Object.keys(args).map((key,i)=>`${key} := $${i+1}`).join(',')})) as result`,Object.values(args));return {data:rows[0].result,error:null};}catch(error){return {data:null,error:{message:error.message}};}};
try{
 let sale=await flow.createSeriesInvoiceDraft(admin,{householdId:family,childIds:[one,two],userId:user,source:'online'});
 assert.equal(sale.amount_cents,28000);assert.equal(sale.status,'draft');assert.equal(sale.sent_at,null);
 const repeat=await flow.createSeriesInvoiceDraft(admin,{householdId:family,childIds:[one,two],userId:user,source:'online'});assert.equal(repeat.id,sale.id);
 sale=await flow.publishSeriesInvoice(admin,sale,false);
 assert.equal(sale.status,'held');assert.equal(sale.sent_at,null);
 const {invoice}=await squareRequest(`/v2/invoices/${encodeURIComponent(sale.square_invoice_id)}`);
 assert.equal(invoice.delivery_method,'SHARE_MANUALLY');assert.equal(invoice.status,'UNPAID');
 const report={environment:'sandbox',saleId:sale.id,invoiceId:invoice.id,orderId:sale.square_order_id,amountCents:28000,invoiceStatus:invoice.status,paymentUrl:sale.payment_url,productionDatabaseUsed:false,realCharge:false};
 fs.writeFileSync('/tmp/lw-series-sandbox.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 // The user-facing Sandbox invoice page takes the fictional card. No real payment API is used.
 if(process.argv.includes('--wait-for-payment')){
   for(let i=0;i<180;i++){
     const current=await flow.verifySeriesPayment(admin,sale);
     if(current.status==='paid'){
       const count=(await db.query("select count(*)::int n from class_registrations where status='scheduled'")).rows[0].n;
       assert.equal(count,10);assert.equal((await flow.verifySeriesPayment(admin,current)).status,'paid');
       const result={...report,verified:true,invoiceStatus:'PAID',confirmedSessionRegistrations:count,repeatVerification:'idempotent'};
       fs.writeFileSync('/tmp/lw-series-sandbox.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exit(0);
     }
     await new Promise(resolve=>setTimeout(resolve,3000));
   }
   throw Error('Sandbox payment was not completed in the test window');
 }else{
   const closed=await flow.closeUnpaidSeriesInvoice(admin,sale);assert.equal(closed.status,'cancelled');console.log('Unpaid invoice cancellation verified; seats released only after Square closed the invoice.');
 }
}finally{await db.close();}
