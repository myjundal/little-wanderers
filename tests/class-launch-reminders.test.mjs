import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
const prepare=loadSquareModules().load('src/lib/class-launch-reminders.ts').prepareClassLaunchReminders;
test('launch reminders group families, omit Jamie and cancelled records, and separate paid dates',()=>{
 const input={now:new Date('2026-11-15T20:00:00Z'),siteUrl:'https://www.thelittlewanderers.com',
  classes:[{id:'yoga',title:'Baby + toddler yoga',status:'scheduled',start_time:'2026-11-18T15:30:00Z',price_cents:2500},
   {id:'ballet',title:'PreK+ Ballet',status:'scheduled',start_time:'2026-11-18T21:00:00Z',price_cents:2500},
   {id:'jamie',title:'Little Hands, Big Canvases',status:'scheduled',start_time:'2026-11-19T22:00:00Z',price_cents:15000}],
  registrations:[{id:'1',class_id:'yoga',person_id:'child',household_id:'family',status:'preregistered'},
   {id:'2',class_id:'ballet',person_id:'child',household_id:'family',status:'scheduled'},
   {id:'3',class_id:'jamie',person_id:'child',household_id:'family',status:'preregistered'},
   {id:'4',class_id:'ballet',person_id:'typo',household_id:'family',status:'cancelled'}],
  people:[{id:'child',household_id:'family',first_name:'<Child>',role:'child'}],households:[{id:'family',name:'Example Family',email:'family@example.test'}]};
 const result=prepare(input);assert.equal(result.messages.length,1);assert.equal(result.registrationCount,2);assert.equal(result.issues.length,0);
 const email=result.messages[0];assert.equal(email.paidCount,1);assert.equal(email.unpaidCount,1);
 assert.doesNotMatch(email.html,/Little Hands|typo|<Child>/);assert.match(email.html,/&lt;Child&gt;/);
 assert.match(email.html,/Payment received · confirmed/);assert.match(email.html,/leave it unpaid/);
 assert.match(email.html,/payment=arrival/);assert.match(email.html,/does not reserve a seat/);
 assert(!email.html.match(/class_ids=ballet/));
 input.registrations=input.registrations.filter(row=>row.status==='scheduled');
 const paidOnly=prepare(input).messages[0];assert.doesNotMatch(paidOnly.html,/Pay online &amp; confirm|I’ll pay at the studio/);assert.match(paidOnly.html,/No additional payment/);
});
