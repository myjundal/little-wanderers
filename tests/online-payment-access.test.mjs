import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSquareModules} from './helpers/square-harness.mjs';

test('all paid customer routes default to closed, including the old unpaid party hold action',async()=>{
 const runtime=loadSquareModules({mocks:{
  '@/lib/supabase/server':{},'@/lib/supabase/admin':{},'@/lib/households':{},'@/lib/family-profile':{},
 }});
 for(const file of ['membership','membership/resume','checkout/subscribe','classes/checkout']){
  const api=runtime.load(`src/app/api/${file}/route.ts`);
  assert.equal((await api.POST({json:async()=>({mode:'finalize'})})).status,503,file);
 }
 const party=runtime.load('src/app/api/party-bookings/route.ts');
 for(const mode of ['finalize','create_payment_link','early_access_hold','arbitrary-mode']){
  assert.equal((await party.POST({json:async()=>({mode})})).status,503);
 }
});

 test('pause and cancel authenticate instead of trapping existing customers behind an enrollment flag',async()=>{
 const runtime=loadSquareModules({mocks:{'@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>({data:{user:null}})}})}}});
 for(const action of ['pause','cancel'])assert.equal((await runtime.load(`src/app/api/membership/${action}/route.ts`).POST()).status,401);
 });

 test('owner pause and cancellation stay available while new subscription enrollment is closed',async()=>{
 const calls=[];const api=loadSquareModules({mocks:{'@/lib/authz':{requireOwnerContext:async()=>({ok:true,user:{id:'owner'},role:'owner',admin:{}})},'@/lib/square-checkout':{changeSquareMembership:async(_a,id,action)=>{calls.push([id,action]);return {status:'ACTIVE'}}}}}).load('src/app/api/admin/families/[id]/membership/route.ts');
 const post=action=>api.POST({json:async()=>({action})},{params:Promise.resolve({id:'household'})});
 assert.equal((await post('pause')).status,200);assert.equal((await post('end')).status,200);assert.equal((await post('create_payment_link')).status,503);assert.equal((await post('resume')).status,503);assert.equal(calls.length,2);
 });
