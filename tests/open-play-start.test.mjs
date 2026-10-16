import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file, mocks = {}) {
 const exports={};const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(source,{exports,require:n=>{if(!(n in mocks))throw Error(n);return mocks[n]},Response,Date,Set,Map});return exports;
}
test('customer and operator calendars both exclude all windows before October 28',async()=>{
 const lib=load('src/lib/open-play-reservations.ts');
 assert.equal(lib.SOFT_OPENING_START_DATE,'2026-10-28');
 for(const operator of [false,true]){
  const filters=[];const admin={from(table){const q={select(){return q},eq(){return q},neq(){return q},lt(){return q},order(){return q},gte(key,value){filters.push([table,key,value]);return q},then(resolve){resolve({data:[],error:null})}};return q;}};
  const api=load(operator?'src/app/api/admin/open-play-reservations/route.ts':'src/app/api/open-play-reservations/route.ts',{
   '@/lib/open-play-reservations':lib,
   '@/lib/authz':{requireStaffContext:async()=>({ok:true,admin})},
   'next/server':{NextResponse:{json:Response.json}},
   '@/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},
   '@/lib/supabase/server':{createServerSupabaseClient:()=>({auth:{getUser:async()=>({data:{user:{id:'family'}}})}})},
   '@/lib/households':{getLatestHouseholdIdForUser:async()=> 'household'},
   '@/lib/soft-opening-access':{getSoftOpeningAccessForUser:async()=>({allowed:true})},
  });
  assert.equal((await api.GET()).status,200);
  assert.ok(filters.some(([table,key,value])=>table==='open_play_reservation_slots'&&key==='starts_at'&&value==='2026-10-28T00:00:00-04:00'));
 }
});
