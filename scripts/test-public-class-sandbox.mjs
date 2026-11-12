// Uses fictional Square Sandbox payments and an isolated in-memory database only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { localSquareAdmin, loadSquareModules } from '../tests/helpers/admission-pos-harness.mjs';
if (process.env.SQUARE_ENVIRONMENT !== 'sandbox' || (process.env.SQUARE_ENV && process.env.SQUARE_ENV !== 'sandbox')) throw Error('Sandbox credentials required. Refusing production.');
const db = new PGlite();
try {
 await db.exec(fs.readFileSync('tests/fixtures/class-checkout-installed.sql', 'utf8'));
 const family=randomUUID(),other=randomUUID(),user=randomUUID(),child=randomUUID(),second=randomUUID(),sessions=[randomUUID(),randomUUID()],interest=randomUUID();
 await db.query('insert into auth.users values($1)',[user]);
 await db.query("insert into households values($1,'fictional@example.invalid'),($2,'second@example.invalid')",[family,other]);
 await db.query("insert into people(id,household_id,role,first_name) values($1,$2,'child','Fictional'),($3,$4,'child','Second')",[child,family,second,other]);
 await db.query("insert into classes values($1,'Sandbox Music','scheduled',3000,2,'2026-11-17T15:00:00Z'),($2,'Sandbox Yoga','scheduled',2500,2,'2026-11-18T15:30:00Z')",sessions);
 await db.query("insert into class_registrations(id,class_id,person_id,household_id,child_id,status) values($1,$2,$3,$4,$3,'preregistered')",[interest,sessions[0],child,family]);
 const runtime=loadSquareModules({env:{SQUARE_ENVIRONMENT:'sandbox',SQUARE_ENV:'sandbox',SQUARE_ACCESS_TOKEN:process.env.SQUARE_ACCESS_TOKEN,SQUARE_LOCATION_ID:process.env.SQUARE_LOCATION_ID,SQUARE_API_VERSION:process.env.SQUARE_API_VERSION,NEXT_PUBLIC_SITE_URL:'http://localhost:3026'}});
 const flow=runtime.load('src/lib/class-checkout.ts'),{squareRequest}=runtime.load('src/lib/square-client.ts'),admin=localSquareAdmin(db);
 const request=flow.classCheckoutRequest({person_id:child,items:sessions.map(class_id=>({class_id}))});
 const input={householdId:family,userId:user,request};
 const checkout=await flow.startClassCheckout(admin,input);
 assert.equal(checkout.expected_amount_cents,5500);assert.equal((await flow.startClassCheckout(admin,input)).id,checkout.id);
 assert.equal((await flow.reconcileClassCheckout(admin,checkout)).status,'open');
 console.log(JSON.stringify({sandboxCheckout:checkout.payment_url,orderId:checkout.order_id,realCharge:false,productionDatabaseUsed:false}));
 fs.writeFileSync('/tmp/lw-public-class-sandbox-pending.json',JSON.stringify({url:checkout.payment_url,orderId:checkout.order_id,linkId:checkout.payment_link_id}));
 let paid;
 if(process.argv.includes('--wait-for-payment')){
   for(let attempt=0;attempt<120;attempt++){
     paid=await flow.reconcileClassCheckout(admin,checkout);
     if(paid.status==='completed')break;
     await new Promise(resolve=>setTimeout(resolve,3000));
   }
 }else{
   // Hosted checkout payments are entered through the fictional Sandbox page.
   // A payment link's order cannot be charged directly through the Payments API.
   assert.equal((await flow.closeClassCheckout(admin,checkout)).status,'cancelled');
   console.log('Sandbox link creation, retry, and provider cancellation verified.');
   process.exit(0);
 }
 assert.equal(paid.status,'completed','Complete only the fictional Square Sandbox checkout');
 const {order:paidOrder}=await squareRequest(`/v2/orders/${checkout.order_id}`);
 const payment={id:paidOrder.tenders[0].payment_id};
 assert.equal((await flow.reconcileClassCheckout(admin,paid)).status,'completed');
 const registrations=(await db.query('select id,status from class_registrations')).rows;
 assert.equal(registrations.length,2);assert(registrations.every(r=>r.status==='scheduled'));assert(registrations.some(r=>r.id===interest));
 const unpaid=await flow.startClassCheckout(admin,{householdId:other,userId:user,request:{...request,person_id:second}});
 assert.equal((await flow.closeClassCheckout(admin,unpaid)).status,'cancelled');
 const report={verified:true,environment:'sandbox',database:'isolated in-memory PostgreSQL',orderId:checkout.order_id,paymentId:payment.id,amountCents:5500,confirmedDates:2,preregistrationIdPreserved:true,retries:'idempotent',unpaidCancellation:'provider verified',productionDatabaseUsed:false,realCharge:false};
 fs.writeFileSync('/tmp/lw-public-class-sandbox.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally { await db.close(); }
