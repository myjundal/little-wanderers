import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSquareModules} from './helpers/admission-pos-harness.mjs';
const {projectAdmissionPrepayments}=loadSquareModules().load('src/lib/admission-prepayments.ts');
const visit={id:'checkin',household_id:'family',person_id:'child',checked_in_at:'2026-11-11T17:00:00Z',price_cents:1600,payment_status:'due',square_environment:'production'};
const booking={household_id:'family',child_ids:['child'],payment_status:'paid',payment_environment:'production',status:'reserved',slot:{starts_at:'2026-11-11T14:00:00Z'}};
test('verified advance payment overrides a stale due attendance record without changing the stored record',()=>{
 const shown=projectAdmissionPrepayments([visit],[booking],'production')[0];
 assert.equal(shown.payment_status,'prepaid');assert.equal(shown.price_cents,0);assert.equal(visit.payment_status,'due');assert.equal(visit.price_cents,1600);
});
test('a different child, family, day, environment or non-settled booking cannot clear admission due',()=>{
 for(const patch of [{child_ids:['other']},{household_id:'other'},{slot:{starts_at:'2026-11-12T05:00:00Z'}},{payment_environment:'sandbox'},{payment_status:'due'},{payment_status:'review'},{status:'cancelled'}]) {
  assert.equal(projectAdmissionPrepayments([visit],[{...booking,...patch}],'production')[0].payment_status,'due');
 }
 assert.equal(projectAdmissionPrepayments([{...visit,square_environment:'sandbox'}],[booking],'production')[0].payment_status,'due');
 assert.equal(projectAdmissionPrepayments([{...visit,payment_status:'paid'}],[booking],'production')[0].payment_status,'paid');
});
