import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {loadModule} from './helpers/class-preregistration-harness.mjs';
const request=(body,origin='https://example.test')=>new Request('https://example.test/api/auth/session',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
test('session persistence validates the bearer identity and same-origin request before storing auth cookies',async()=>{
  let writes=0;
  const api=loadModule('src/app/api/auth/session/route.ts',{'@/lib/request-origin':loadModule('src/lib/request-origin.ts'),'@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{getUser:async token=>({data:{user:token==='valid'?{id:'verified'}:null},error:null}),setSession:async()=>{writes++;return {data:{user:{id:'verified'}}};}}})}});
  assert.equal((await api.POST(request({access_token:'valid',refresh_token:'refresh'},'https://evil.test'))).status,403);
  assert.equal((await api.POST(request({access_token:'invalid',refresh_token:'refresh'}))).status,401);
  assert.equal((await api.POST(request({access_token:'valid'}))).status,400);
  assert.equal(writes,0);
  assert.equal((await api.POST(request({access_token:'valid',refresh_token:'refresh'}))).status,200);
  assert.equal(writes,1);
});
test('browser continuation waits for the server to persist its session and surfaces cookie failures',async()=>{
  for(const ok of [true,false]){
    const calls=[];
    const api=loadModule('src/lib/browser-session.ts',{'@/lib/supabase/browser':{createBrowserSupabaseClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'access',refresh_token:'refresh'}}})}})},'@/lib/auth-request':{withAuthDeadline:fn=>fn()}},{fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok};}});
    if(ok)await api.persistBrowserSession();else await assert.rejects(api.persistBrowserSession(),/cookies/);
    assert.equal(calls[0].url,'/api/auth/session');assert.equal(calls[0].body.refresh_token,'refresh');
  }
});
test('protected reservation navigation preserves its exact destination across login',async()=>{
  const Layout=loadModule('src/app/landing/layout.tsx',{
    'next/headers':{headers:async()=>({get:()=>'/landing/soft-opening?reservation=123'})},
    'next/navigation':{redirect:url=>{throw new Error(url);}},
    '@/lib/auth-redirect':loadModule('src/lib/auth-redirect.ts'),
    '@/lib/auth':{supabaseServer:async()=>({auth:{getUser:async()=>({data:{user:null}})}})},
    '@/components/staff/StaffSessionBar':'bar','@/components/staff/StaffQuickNav':'quick',
    '@/components/pastel/PastelShells':{},'@/components/landing/LandingMoreMenu':'menu',
  },{React}).default;
  await assert.rejects(Layout({children:null}),/\/login\?next=%2Flanding%2Fsoft-opening%3Freservation%3D123/);
});

test('origin checks honor the public Host behind Next internals without accepting another site',()=>{
  const {isSameOriginRequest}=loadModule('src/lib/request-origin.ts');
  assert(isSameOriginRequest(new Request('http://localhost:3065/api/auth/session',{headers:{origin:'http://127.0.0.1:3065',host:'127.0.0.1:3065'}})));
  assert.equal(isSameOriginRequest(new Request('https://internal.example/api/auth/session',{headers:{origin:'https://evil.example',host:'www.thelittlewanderers.com'}})),false);
});
