import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function setup({email='recipient@example.com',existing=null,inviteRole='member'}={}){
 const inserts=[],updates=[],exports={};
 const invite={id:'invite',household_id:'family',email:'recipient@example.com',role:inviteRole,status:'pending',expires_at:'2099-01-01'};
 const admin={from(table){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:table==='household_invites'?invite:existing,error:null}),insert(row){inserts.push(row);return q},update(row){updates.push(row);return q},then(resolve){resolve({error:null})}};return q}};
 const mocks={'next/server':{NextResponse:{json:Response.json}},'@/lib/family-roles':{normalizeFamilyInviteRole:()=> inviteRole},'@/lib/supabase/server':{createServerSupabaseClient:()=>({auth:{getUser:async()=>({data:{user:{id:'recipient',email}}})}})},'@/lib/supabase/admin':{createAdminSupabaseClient:()=>admin}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/family/invites/accept/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:n=>mocks[n],Date,Response});
 return{accept:()=>exports.POST({json:async()=>({token:'test-only-token'})}),inserts,updates};
}
test('accepting a family invite preserves an existing primary caregiver',async()=>{const s=setup({existing:{role:'primary_caregiver'}});assert.equal((await s.accept()).status,200);assert.equal(s.inserts.length,0);assert.equal(s.updates[0].status,'accepted');});
test('a new family invite adds only the invited member role',async()=>{const s=setup();assert.equal((await s.accept()).status,200);assert.equal(s.inserts.length,1);assert.equal(s.inserts[0].role,'member');assert.equal(s.inserts[0].household_id,'family');});
test('an invite cannot be accepted by a different account email',async()=>{const s=setup({email:'other@example.com'});assert.equal((await s.accept()).status,403);assert.equal(s.inserts.length,0);assert.equal(s.updates.length,0);});

test('a caregiver invitation upgrades an existing member without replacing the row',async()=>{const s=setup({existing:{role:'member'},inviteRole:'caregiver'});assert.equal((await s.accept()).status,200);assert.equal(s.inserts.length,0);assert.equal(s.updates[0].role,'caregiver');assert.equal(s.updates[1].status,'accepted');});
