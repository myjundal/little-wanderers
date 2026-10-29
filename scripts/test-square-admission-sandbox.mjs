import fs from 'node:fs';
import nextEnv from '@next/env';
import {squareTestDatabase,localSquareAdmin,loadSquareModules,ids} from '../tests/helpers/square-harness.mjs';
nextEnv.loadEnvConfig(process.cwd());
if((process.env.SQUARE_ENVIRONMENT??process.env.SQUARE_ENV??'sandbox').toLowerCase()!=='sandbox')throw new Error('Sandbox only');
const db=await squareTestDatabase(),admin=localSquareAdmin(db),adult='30000000-0000-4000-8000-000000000003';
await db.query("insert into people(id,household_id,role,first_name) values($1,$2,'adult','Sandbox Parent')",[adult,ids.household]);
const runtime=loadSquareModules({env:{...process.env,SQUARE_ENVIRONMENT:'sandbox',ADMISSION_PAYMENTS_ENABLED:'true'}}),checkout=runtime.load('src/lib/square-checkout.ts');
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const link=await checkout.startSquareCheckout(admin,{householdId:ids.household,userId:ids.user,role:'customer',kind:'admission',personIds:[ids.person,adult],visitDate:date,quotedAmount:1600,returnPath:'/landing/admission'});
const report={environment:'sandbox',database:'isolated in-memory PostgreSQL',checkout_id:link.id,payment_url:link.url,amount_cents:1600,checks:[]};
console.log(JSON.stringify({payment_url:link.url,amount_cents:1600}));
for(let i=0;i<120;i++){
 const a=(await admin.from('square_checkout_attempts').select('*').eq('id',link.id).single()).data;
 const result=await checkout.reconcileCheckout(admin,a);
 if(result.status==='completed'){
  const passes=(await db.query('select person_id,visit_date,status from admission_passes')).rows;
  report.checks.push({name:'actual Sandbox order and payment create two admission passes',passed:passes.length===2});
  await checkout.reconcileCheckout(admin,a);report.checks.push({name:'duplicate payment verification remains idempotent',passed:(await db.query('select * from admission_passes')).rows.length===2});
  break;
 }
 await new Promise(r=>setTimeout(r,5000));
}
fs.writeFileSync('/tmp/little-wanderers-square-admission.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await db.close();
if(!report.checks.length||report.checks.some(c=>!c.passed))process.exitCode=1;
