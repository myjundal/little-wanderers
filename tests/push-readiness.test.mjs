import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load({configured=false,error=null,user={id:'test-user'}}={}) {
 const exports={};let queries=0;
 const q={select(){return q},eq(){return q},limit(){return q},maybeSingle:async()=>({data:null,error})};
 const supabase={auth:{getUser:async()=>({data:{user}})},from(){queries++;return q}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/push/preferences/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,process:{env:configured?{NEXT_PUBLIC_VAPID_PUBLIC_KEY:'test',VAPID_PRIVATE_KEY:'test'}:{}},require:n=>n==='next/server'?{NextResponse:{json:Response.json}}:{createServerSupabaseClient:()=>supabase},Response});
 return {api:exports,queries:()=>queries};
}
test('unconfigured push does not query a missing table or pretend preferences were saved',async()=>{
 const {api,queries}=load();assert.deepEqual(await (await api.GET()).json(),{ok:true,available:false,preferences:null});assert.equal(queries(),0);assert.equal((await api.PATCH({json:async()=>({})})).status,503);
 assert.equal((await load({user:null}).api.GET()).status,401);
});
test('missing push table is unavailable, while unrelated database errors remain visible',async()=>{
 assert.equal((await (await load({configured:true,error:{code:'PGRST205'}}).api.GET()).json()).available,false);
 assert.equal((await load({configured:true,error:{code:'XX000'}}).api.GET()).status,500);
 assert.equal((await (await load({configured:true}).api.GET()).json()).available,true);
});
