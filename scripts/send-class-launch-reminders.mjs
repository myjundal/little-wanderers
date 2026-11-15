import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import ts from 'typescript';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/class-launch-reminders.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, URL, Date, Map, Set });
const checked = result => { if (result.error) throw Error(result.error.message); return result.data; };
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const planFile = '/tmp/lw-class-launch-reminder-plan.json';
const receiptFile = '/tmp/lw-class-launch-reminder-receipts.json';
let plan;
if (process.argv.includes('--send')) {
  plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  if (plan.campaign !== 'classes-2026-11-16' || plan.issues.some(issue => !/^Family [a-f0-9-]+ needs a valid email\.$/.test(issue))) throw Error('Review the prepared recipient plan before sending.');
} else {
  const classes = checked(await db.from('classes').select('id,title,status,start_time,end_time,price_cents').eq('status', 'scheduled').gte('start_time', '2026-11-16T05:00:00Z').lt('start_time','2026-12-18T05:00:00Z'));
  const registrations = checked(await db.from('class_registrations').select('id,class_id,person_id,household_id,status').in('class_id', classes.filter(row => row.title !== 'Little Hands, Big Canvases').map(row => row.id)).in('status', ['preregistered','scheduled','attended']).limit(1001));
  if (registrations.length > 1000) throw Error('Recipient list needs pagination.');
  const people = checked(await db.from('people').select('id,household_id,first_name,last_name,role').in('id',[...new Set(registrations.map(row=>row.person_id))]));
  const households = checked(await db.from('households').select('id,name,email').in('id',[...new Set(registrations.map(row=>row.household_id))]));
  plan = { campaign:'classes-2026-11-16',preparedAt:new Date().toISOString(),...exports.prepareClassLaunchReminders({classes,registrations,people,households,siteUrl:'https://www.thelittlewanderers.com'}) };
  fs.writeFileSync(planFile, JSON.stringify(plan,null,2), {mode:0o600});
  if (plan.messages[0]) fs.writeFileSync('/tmp/lw-class-launch-email-preview.html',plan.messages[0].html);
}
console.log(JSON.stringify({recipients:plan.messages.length,registrationCount:plan.registrationCount,unpaid:plan.messages.reduce((sum,row)=>sum+row.unpaidCount,0),paid:plan.messages.reduce((sum,row)=>sum+row.paidCount,0),issues:plan.issues,classes:[...new Set(plan.messages.flatMap(row=>row.classTitles))]}));
if (!process.argv.includes('--send')) process.exit(plan.issues.length ? 2 : 0);
if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) throw Error('Business email transport is unavailable.');
const receipts = fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile,'utf8')) : [];
for (const message of plan.messages) {
  if (receipts.some(receipt=>receipt.householdId===message.householdId&&receipt.id)) continue;
  // Re-read statuses just before sending. A saved plan must never ask for an
  // additional payment if the family paid after the reminder was prepared.
  const current = checked(await db.from('class_registrations').select('id,status').in('id',message.registrationIds));
  if (current.length!==message.registrationIds.length || current.some(row=>message.registrationStates.find(original=>original.id===row.id)?.status!==row.status)) throw Error('Registration changed after preparation; rebuild the unsent plan before continuing.');
  const key = `class-launch-20261116-${message.householdId}`;
  const payload = JSON.stringify({from:process.env.RESEND_FROM_EMAIL,to:[message.to],subject:message.subject,html:message.html,reply_to:'hello@thelittlewanderers.com'});
  let delivered;
  for (let attempt=0;attempt<3;attempt++) {
    try {
      const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':key},body:payload,signal:AbortSignal.timeout(15000)});
      const result=await response.json();
      if(response.ok&&result.id){delivered=result;break;}
      if(response.status<500&&response.status!==429&&response.status!==409)throw Error('Email provider rejected the request.');
    } catch(error) {if(attempt===2)throw error;}
    await new Promise(resolve=>setTimeout(resolve,1200));
  }
  if(!delivered?.id)throw Error('Email delivery is uncertain; retry only this same frozen campaign plan.');
  receipts.push({householdId:message.householdId,id:delivered.id,sentAt:new Date().toISOString(),unpaidCount:message.unpaidCount,paidCount:message.paidCount});
  fs.writeFileSync(receiptFile,JSON.stringify(receipts,null,2),{mode:0o600});
  console.log(JSON.stringify({sent:receipts.length,total:plan.messages.length,providerAccepted:true}));
  await new Promise(resolve=>setTimeout(resolve,650));
}
console.log(JSON.stringify({sent:receipts.length,total:plan.messages.length,complete:receipts.length===plan.messages.length}));
