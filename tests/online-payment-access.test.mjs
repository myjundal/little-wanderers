import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file, paymentAccess) {
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:n=>n==='@/lib/online-payment-access'?paymentAccess:n==='@/lib/family-profile'?{parseGuardianName:()=>({})}:{},Response,process:{env:{}},Date,Set});return exports;
}
const access=load('src/lib/online-payment-access.ts');
test('dormant payment routes refuse to charge or fulfill without server verification',async()=>{
 for(const file of ['membership','membership/pause','membership/resume','checkout/subscribe','classes/checkout']){
  const api=load(`src/app/api/${file}/route.ts`,access);
  const result=await api.POST({json:async()=>({mode:'finalize'})});assert.equal(result.status,503,file);
 }
 const party=load('src/app/api/party-bookings/route.ts',access);
 for(const mode of ['finalize','create_payment_link','arbitrary-mode'])assert.equal((await party.POST({json:async()=>({mode})})).status,503);
 // The existing no-deposit hold path remains available and reaches ordinary validation.
 assert.equal((await party.POST({json:async()=>({mode:'early_access_hold'})})).status,400);
});
