import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSquareModules} from './helpers/square-harness.mjs';

test('all paid customer routes default to closed, including the old unpaid party hold action',async()=>{
 const runtime=loadSquareModules({mocks:{
  '@/lib/supabase/server':{},'@/lib/supabase/admin':{},'@/lib/households':{},'@/lib/family-profile':{},
 }});
 for(const file of ['membership','membership/pause','membership/resume','checkout/subscribe','classes/checkout']){
  const api=runtime.load(`src/app/api/${file}/route.ts`);
  assert.equal((await api.POST({json:async()=>({mode:'finalize'})})).status,503,file);
 }
 const party=runtime.load('src/app/api/party-bookings/route.ts');
 for(const mode of ['finalize','create_payment_link','early_access_hold','arbitrary-mode']){
  assert.equal((await party.POST({json:async()=>({mode})})).status,503);
 }
});
