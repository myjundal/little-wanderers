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
