import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
function load(file, mocks = {}) {
 const exports = {};
 const js = ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(js,{exports,require:n=>mocks[n],Buffer,Date,Set,process,Response,URL});
 return exports;
}
const pin = load('src/lib/staff-pin.ts', {crypto});
test('PINs preserve leading zero, reject malformed values and use salted hashes',()=>{
 assert.equal(pin.validStaffPin('0123'),true);
 for(const value of ['123',1234,'12345','12a4','１２３４','1234\n']) assert.equal(pin.validStaffPin(value),false);
 const hash=pin.hashStaffPin('0123');
 assert.notEqual(hash,pin.hashStaffPin('0123'));
 assert.equal(pin.verifyStaffPin('0123',hash),true);
 assert.equal(pin.verifyStaffPin('0124',hash),false);
 assert.equal(pin.verifyStaffPin('0123','broken'),false);
});
const time=load('src/lib/staff-time-display.ts');
test('timecards count elapsed hours across DST and exclude open or invalid shifts',()=>{
 assert.equal(time.closedShiftHours('2026-11-01T00:00:00-04:00','2026-11-01T03:00:00-05:00'),4);
 assert.equal(time.closedShiftHours('2026-10-15T12:00:00Z',null),null);
 assert.equal(time.closedShiftHours('2026-10-15T12:00:00Z','2026-10-15T11:00:00Z'),null);
 assert.equal(time.closedShiftHours('bad','bad'),null);
});
function kioskAuth(primary, extra=[], kiosk=true) {
 const admin={auth:{admin:{getUserById:async()=>({data:{user:{id:'employee'}}})}},from(){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:{role:primary}}),then(resolve){resolve({data:extra.map(role=>({role})),error:null})}};return q;}};
 return load('src/lib/authz.ts',{'@/lib/staff-kiosk':{getKioskIdentity:async()=>kiosk?{user_id:'employee'}:null},'@/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},'@/lib/supabase/server':{createServerSupabaseClient:()=>({auth:{getUser:async()=>({data:{user:null}})}})}});
}
test('owner PIN session is limited to staff and cannot access owner controls',async()=>{
 const api=kioskAuth('owner',['instructor']); const ctx=await api.getCurrentUserRole();
 assert.equal(ctx.role,'staff'); assert.equal(ctx.isKiosk,true);
 assert.equal((await api.requireOwnerContext()).response.status,403);
 assert.equal((await api.requireTeachingContext()).ok,true);
});
test('instructor PIN session does not gain staff tools; removed role cannot sign in',async()=>{
 assert.equal((await kioskAuth('user',['instructor']).requireStaffContext()).response.status,403);
 assert.equal((await kioskAuth('user').requireStaffContext()).response.status,401);
 assert.equal((await kioskAuth('owner',[],false).requireStaffContext()).response.status,401);
});
test('family metrics skip walk-in members and count across multiple database pages', async()=>{
 const visited=[];
 const admin={from(table){let range=null,excludeWalkIn=false;const q={select(){return q},order(){return q},limit(){return q},range(from,to){range=[from,to];visited.push([table,from]);return q},not(key,op,value){assert.deepEqual([key,op,value],['user_id','is',null]);excludeWalkIn=true;return q},eq(){return q},then(resolve){let data=[];if(range){data=table==='household_members'?[...Array.from({length:501},(_,i)=>({household_id:`f${i}`,user_id:`u${i}`})),{household_id:'walk-in',user_id:null}]:Array.from({length:501},(_,i)=>({household_id:`c${Math.floor(i/2)}`}));if(excludeWalkIn)data=data.filter(r=>r.user_id);data=data.slice(range[0],range[1]+1);}resolve({data,error:null,count:502});}};return q;}};
 const api=load('src/app/api/admin/families/route.ts',{'@/lib/authz':{requireStaffContext:async()=>({ok:true,admin})},'@/lib/us-cities':{US_CITIES_BY_STATE:{}},'@/lib/waivers':{getWaiverStatus:()=>({status:'required'})}});
 const result=await (await api.GET(new Request('https://example.com/api/admin/families'))).json();
 assert.equal(result.linked_families,501);assert.equal(result.families_with_children,251);
 assert.ok(visited.some(([table,offset])=>table==='household_members'&&offset===500));
 assert.ok(visited.some(([table,offset])=>table==='people'&&offset===500));
});
