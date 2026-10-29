import fs from 'node:fs';
import nextEnv from '@next/env';
import {squareTestDatabase,localSquareAdmin,loadSquareModules,ids} from '../tests/helpers/square-harness.mjs';
nextEnv.loadEnvConfig(process.cwd());
if((process.env.SQUARE_ENVIRONMENT??process.env.SQUARE_ENV??'sandbox').toLowerCase()!=='sandbox')throw new Error('Sandbox only');
const db=await squareTestDatabase(),admin=localSquareAdmin(db);
try{
 const runtime=loadSquareModules({env:{...process.env,SQUARE_ENVIRONMENT:'sandbox',CLASS_PAYMENTS_ENABLED:'true'}});
 const checkout=runtime.load('src/lib/square-checkout.ts'),client=runtime.load('src/lib/square-client.ts');
 const started=await checkout.startSquareCheckout(admin,{householdId:ids.household,userId:ids.user,role:'customer',kind:'class',personId:ids.person,items:[{class_id:ids.klass,quantity:1}],returnPath:'/landing/classschedule'});
 const attempt=(await admin.from('square_checkout_attempts').select('*').eq('id',started.id).single()).data;
 const expired=process.argv.includes('--expired');
 let cancelled;
 if(expired){await admin.from('square_checkout_attempts').update({hold_expires_at:'2000-01-01'}).eq('id',attempt.id);const recovery=runtime.load('src/lib/square-checkout-recovery.ts');const result=await recovery.expireSquareCheckoutHolds(admin);cancelled={status:result.cancelled===1?'cancelled':'pending'};}
 else cancelled=await checkout.cancelUnpaidClassCheckout(admin,attempt);
 const {order}=await client.squareRequest(`/v2/orders/${attempt.order_id}`);
 const local=(await admin.from('square_checkout_attempts').select('*').eq('id',started.id).single()).data;
 const report={environment:'sandbox',database:'isolated in-memory PostgreSQL',charged_amount_cents:0,
   automatic_expired_cleanup:expired,provider_order_state:order.state,local_status:local.status,passed:cancelled.status==='cancelled'&&order.state==='CANCELED'&&local.status==='cancelled'};
 fs.writeFileSync(expired?'/tmp/little-wanderers-square-class-expiry.json':'/tmp/little-wanderers-square-class-cancel.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(!report.passed)process.exitCode=1;
}finally{await db.close();}
