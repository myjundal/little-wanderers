// Explicit integration test: Square Sandbox + an in-memory local PostgreSQL database.
// No Supabase client is instantiated, and no Production API can be called.
import fs from 'node:fs';
import nextEnv from '@next/env';
import { squareTestDatabase, localSquareAdmin, loadSquareModules, ids } from '../tests/helpers/square-harness.mjs';

nextEnv.loadEnvConfig(process.cwd());
const environment=(process.env.SQUARE_ENVIRONMENT??process.env.SQUARE_ENV??'sandbox').toLowerCase();
if(environment!=='sandbox')throw new Error('This test only runs in Square Sandbox');
if(!process.env.SQUARE_ACCESS_TOKEN||!process.env.SQUARE_LOCATION_ID)throw new Error('Sandbox credentials are missing');
const db=await squareTestDatabase();
const admin=localSquareAdmin(db);
const runtime=loadSquareModules({ fetch:async(url,options)=>{
  const response=await fetch(url,options);
  if(!response.ok)console.error(JSON.stringify({path:new URL(url).pathname,errors:(await response.clone().json()).errors}));
  return response;
}, env:{...process.env,SQUARE_ENVIRONMENT:'sandbox',PARTY_PAYMENTS_ENABLED:'true',
  // Exercise the catalog-free Sandbox path; production requires an explicit party variation.
  SQUARE_PARTY_ITEM_VARIATION_ID:'',SQUARE_SANDBOX_EMAIL_TO:''} });
const party=runtime.load('src/lib/square-party.ts');
const client=runtime.load('src/lib/square-client.ts');
const { locations }=await client.squareRequest('/v2/locations');
if(!locations.some(l=>l.id===process.env.SQUARE_LOCATION_ID&&l.currency==='USD'&&l.status==='ACTIVE'))throw new Error('Sandbox location does not match');
const day=new Date();day.setUTCDate(day.getUTCDate()+45);
const dayString=day.toISOString().slice(0,10);
const result=await party.startPartyInvoice(admin,{householdId:ids.household,userId:ids.user,role:'customer',
  booking:{start_time:`${dayString}T15:00:00Z`,end_time:`${dayString}T18:00:00Z`,birthday_child_name:'Sandbox Test',headcount_expected:10}});
const report={environment:'sandbox',database:'isolated in-memory PostgreSQL',booking_id:result.booking.id,
  invoice_id:result.booking.square_invoice_id,order_id:result.booking.square_order_id,payment_url:result.url,
  created_at:new Date().toISOString(),checks:[{name:'create $300 invoice with $150 deposit and $150 balance',passed:true}],observations:[]};
const output=process.env.SQUARE_SANDBOX_REPORT||'/tmp/little-wanderers-square-sandbox.json';
fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({report:output,payment_url:result.url,invoice_id:report.invoice_id,status:result.booking.status}));
// Browser payment must use the invoice page. CreatePayment/PayOrder cannot pay invoice orders.
// Leave the isolated test running while a tester enters Sandbox card details.
let booking=result.booking,previous='';
for(let i=0;i<180;i++) {
  booking=await party.reconcilePartyInvoice(admin,booking);
  const state=JSON.stringify({status:booking.status,deposit:booking.deposit_paid_cents,balance:booking.balance_paid_cents,review:booking.payment_review_required});
  if(state!==previous){console.log(state);report.observations.push({at:new Date().toISOString(),...JSON.parse(state)});fs.writeFileSync(output,JSON.stringify(report,null,2));previous=state;}
  if(booking.deposit_paid_cents===15000&&!report.checks.some(c=>c.name==='deposit confirms reservation'))report.checks.push({name:'deposit confirms reservation',passed:booking.status==='confirmed'});
  if(booking.balance_paid_cents===15000){report.checks.push({name:'same invoice balance paid in full',passed:booking.status==='confirmed'});break;}
  await new Promise(resolve=>setTimeout(resolve,5000));
}
fs.writeFileSync(output,JSON.stringify(report,null,2));
await db.close();
