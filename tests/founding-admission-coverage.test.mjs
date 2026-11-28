import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
const {projectFoundingAdmission}=loadSquareModules().load('src/lib/founding-admission-coverage.ts');
test('saved-card memberships cover first-visit admission without starting monthly billing',()=>{
 const people=[{id:'child',household_id:'family',role:'child'}];
 const visit={id:'visit',person_id:'child',payment_status:'due',price_cents:1600,checked_in_at:'2026-11-15T19:09:00Z',square_environment:null};
 const enrollment={household_id:'family',environment:'production',status:'pending',child_ids:['child'],square_card_id:'saved-card',start_date:null,paid_through:null,created_at:'2026-11-14T01:49:00Z'};
 const project=(v=visit,e=enrollment,frozen=new Set())=>projectFoundingAdmission([v],people,[e],'production',frozen)[0];
 assert.equal(project().payment_status,'covered');assert.equal(project().price_cents,0);assert.equal(project().founding_membership_applied,true);
 assert.equal(enrollment.status,'pending');assert.equal(enrollment.start_date,null);
 for(const patch of [{status:'draft'},{square_card_id:null},{environment:'sandbox'},{child_ids:['someone-else']},{household_id:'other'},{created_at:'2026-11-16T10:00:00Z'},{status:'canceled'}])assert.equal(project(visit,{...enrollment,...patch}).payment_status,'due');
 assert.equal(project(visit,enrollment,new Set(['visit'])).payment_status,'due');
 assert.equal(project({...visit,payment_status:'paid'}).payment_status,'paid');
 assert.equal(project({...visit,square_environment:'sandbox'}).payment_status,'due');
 assert.equal(project(visit,{...enrollment,status:'canceled',start_date:'2026-11-01',paid_through:'2026-11-20'}).price_cents,0);
 assert.equal(project(visit,{...enrollment,status:'active',start_date:'2026-10-01',paid_through:'2026-11-01'}).payment_status,'due');
});

test('an activated saved-card subscription remains Membership when its paid-through field is missing', () => {
 const modules=loadSquareModules();
 const {softOpeningAmount}=modules.load('src/lib/soft-opening-pricing.ts');
 const {admissionPaymentLabel}=modules.load('src/lib/admission-payment-status.ts');
 const people=[{id:'child',household_id:'family',role:'child'}];
 const visit={id:'visit',person_id:'child',payment_status:'due',price_cents:1600,checked_in_at:'2026-11-26T16:00:00Z',square_environment:'production'};
 const enrollment={household_id:'family',environment:'production',status:'active',child_ids:['child'],square_card_id:'card',square_subscription_id:'subscription',start_date:'2026-11-13',paid_through:null,created_at:'2026-11-08T14:00:00Z'};
 const original=JSON.stringify(enrollment);
 const projected=projectFoundingAdmission([visit],people,[enrollment],'production')[0];
 assert.equal(projected.payment_status,'covered');assert.equal(projected.price_cents,0);assert.equal(admissionPaymentLabel(projected),'Membership');
 assert.equal(softOpeningAmount(['child'],[enrollment],'2026-11-26'),0);
 assert.equal(JSON.stringify(enrollment),original);assert.equal(visit.payment_status,'due');
 for(const patch of [{status:'canceled'},{status:'canceling'},{status:'draft'},{square_card_id:null},{square_subscription_id:null},{paid_through:'2026-11-20'},{start_date:'2026-12-01'},{environment:'sandbox'},{household_id:'other'},{child_ids:['other']}])
  assert.equal(projectFoundingAdmission([visit],people,[{...enrollment,...patch}],'production')[0].payment_status,'due');
 for(const payment_status of ['paid','prepaid','pending','review'])assert.equal(projectFoundingAdmission([{...visit,payment_status}],people,[enrollment],'production')[0].payment_status,payment_status);
 assert.equal(projectFoundingAdmission([visit],people,[enrollment],'production',new Set(['visit']))[0].payment_status,'due');
});

test('reservation clients get derived active membership eligibility without provider identifiers', async () => {
 const enrollment={child_ids:['child'],status:'active',start_date:'2026-11-13',paid_through:null,square_card_id:'private-card',square_subscription_id:'private-subscription'};
 const {readSoftOpeningFamily}=loadSquareModules({env:{SQUARE_ENVIRONMENT:'production'},mocks:{
  '@/lib/family-profile':{getPrimaryGuardianProfile:async()=>({first_name:'Parent'})},
  '@/lib/complimentary-membership':{readComplimentaryMembership:async()=>null},
 }}).load('src/lib/soft-opening-family.ts');
 const db={from(table){const q={select(){return q;},eq(){return q;},in(){return q;},order(){return q;},limit(){return q;},then(resolve){resolve({data:table==='membership_events'?[]:table==='founding_memberships'?[enrollment]:[{id:'child',first_name:'Sam',last_name:'Family',birthdate:'2024-01-15',notes:null}],error:null});}};return q;}};
 const family=await readSoftOpeningFamily(db,'family');
 assert.equal(family.memberships[0].active_subscription,true);
 assert.ok(!JSON.stringify(family).includes('private-card'));assert.ok(!JSON.stringify(family).includes('private-subscription'));
 const {softOpeningAmount}=loadSquareModules().load('src/lib/soft-opening-pricing.ts');
 assert.equal(softOpeningAmount(['child'],family.memberships,'2026-11-26',family.children),0);
});
