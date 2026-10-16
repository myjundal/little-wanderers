import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function handler({owner=true,origin=true,found=true}={}) {
 const calls=[];
 const admin={from(){const q={select(){return q},eq(){return q},limit(){return q},maybeSingle:async()=>({data:found?{id:'session'}:null})};return q;},auth:{admin:{listUsers:async()=>({data:{users:[{id:'teacher',email:'teacher@example.com'}]}})}},rpc:async(name,args)=>{calls.push([name,args]);return{data:{ok:true}}}};
 const exports={};const source=ts.transpileModule(fs.readFileSync('src/app/api/admin/instructors/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const mocks={'@/lib/authz':{requireOwnerContext:async()=>owner?{ok:true,admin}:{ok:false,response:Response.json({ok:false},{status:403})}},'@/lib/staff-kiosk':{sameOrigin:()=>origin}};
 vm.runInNewContext(source,{exports,require:n=>mocks[n],Response,Set,Map});
 return {calls,post:body=>exports.POST(new Request('https://example.com/api/admin/instructors',{method:'POST',body:JSON.stringify(body)}))};
}
test('one class assignment atomically delegates its existing and future sessions to one account',async()=>{
 const h=handler();assert.equal((await h.post({action:'assign_course',course_title:'Music',email:' Teacher@Example.com '})).status,200);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'set_class_course_instructor');
 assert.equal(h.calls[0][1].p_class_title,'Music');assert.equal(h.calls[0][1].p_user_id,'teacher');
});
test('removing a class instructor clears its assignment through the same transaction',async()=>{
 const h=handler();assert.equal((await h.post({action:'remove_course',course_title:'Music'})).status,200);
 assert.equal(h.calls[0][1].p_user_id,null);
});
test('staff, cross-site requests, unknown classes, and unknown accounts cannot assign instructors',async()=>{
 for(const [options,body,status] of [
  [{owner:false},{action:'assign_course',course_title:'Music',email:'teacher@example.com'},403],
  [{origin:false},{action:'assign_course',course_title:'Music',email:'teacher@example.com'},403],
  [{found:false},{action:'assign_course',course_title:'Other',email:'teacher@example.com'},404],
  [{},{action:'assign_course',course_title:'Music',email:'missing@example.com'},404],
  [{},{action:'assign',class_id:'old-session',email:'teacher@example.com'},400],
  [{},null,400],
 ]){const h=handler(options);assert.equal((await h.post(body)).status,status);assert.equal(h.calls.length,0);}
});
