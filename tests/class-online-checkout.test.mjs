import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classPageHarness,fixtureClass,fixtureChild,loadModule} from './helpers/class-preregistration-harness.mjs';

test('class payment action is absent while closed, and pre-registration can convert to verified checkout when open',async()=>{
  const closed=await classPageHarness();assert.equal(closed.payButton(),undefined);
  const open=await classPageHarness({paymentsEnabled:true,classItems:[{...fixtureClass,payment_available:true}],
    registrations:[{id:'existing-interest',person_id:fixtureChild.id,status:'preregistered',class:fixtureClass}]});
  assert.equal(open.button().props.disabled,true);
  assert.equal(open.payButton().props.disabled,false);
  await open.payButton().props.onClick();await open.flush();
  const request=open.requests.find(r=>r.url==='/api/classes/checkout'&&!JSON.parse(r.options.body).mode);
  assert.deepEqual(JSON.parse(request.options.body),{person_id:fixtureChild.id,items:[{class_id:fixtureClass.id,quantity:1}]});
  assert.equal(open.redirected,'https://square.link/u/test-checkout');
});

test('a browser checkout return requests server verification and never treats the URL as payment evidence',async()=>{
  const page=await classPageHarness({paymentsEnabled:true,initialSearch:'?checkout=success&checkout_id=existing-checkout',
    checkout:async()=>Response.json({ok:true,status:'pending'})});
  await page.flush();
  const requests=page.requests.filter(r=>r.url==='/api/classes/checkout');assert.equal(requests.length,1);
  assert.deepEqual(JSON.parse(requests[0].options.body),{mode:'finalize',checkout_id:'existing-checkout'});
  assert.equal(page.redirected,undefined);
  assert.ok(!requests.some(r=>JSON.parse(r.options.body).status==='completed'));
});

test('a paid class cannot be cancelled through the free pre-registration cancellation path',async()=>{
  let writes=0;
  const admin={from(table){const query={select(){return query;},eq(){return query;},contains(){return query;},limit(){return query;},
    maybeSingle:async()=>({data:table==='square_checkout_attempts'?{id:'paid-checkout'}:{id:'reg',household_id:'family',status:'scheduled'}}),
    update(){writes++;return query;}};return query;}};
  const api=loadModule('src/app/api/classes/cancel/route.ts',{
    '@supabase/supabase-js':{createClient:()=>admin},
    '@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'user'}}})}})},
    '@/lib/households':{getLatestHouseholdIdForUser:async()=> 'family'},
    '@/lib/class-waitlist':{},'@/lib/admin-notifications':{},'@/lib/family-profile':{},'@/lib/logger':{},
  },{process:{env:{}}});
  const response=await api.POST({json:async()=>({registration_id:'reg'})});
  assert.equal(response.status,409);assert.equal(writes,0);
});
