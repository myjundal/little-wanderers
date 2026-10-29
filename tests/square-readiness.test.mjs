import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSquareModules} from './helpers/square-harness.mjs';

test('payment preflight rejects non-owners before reading configuration or calling Square',async()=>{
 let calls=0;
 const route=loadSquareModules({fetch:async()=>{calls++;throw new Error('Must not call Square');},
   mocks:{'@/lib/authz':{requireOwnerContext:async()=>({ok:false,response:Response.json({ok:false},{status:403})})}}}).load('src/app/api/admin/square/readiness/route.ts');
 assert.equal((await route.GET()).status,403);assert.equal(calls,0);
});

test('payment preflight validates provider catalog and signing key without exposing credentials or creating payments',async()=>{
 const calls=[];const admin={from(table){const q={select(){return q},eq(){return q},gt(){return q},then(resolve){resolve({data:table==='classes'?[]:[],error:null})}};return q;}};
 const route=loadSquareModules({env:{SQUARE_PARTY_ITEM_VARIATION_ID:'party',SQUARE_PLAN_VARIATION_ID:'plan',SQUARE_WEBHOOK_SIGNATURE_KEY:'private-signing-key',
   SQUARE_WEBHOOK_URL:'http://localhost:3000/api/webhooks/square'},mocks:{'@/lib/authz':{requireOwnerContext:async()=>({ok:true,admin})}},
   fetch:async(url,options)=>{const path=new URL(url).pathname;calls.push({path,method:options.method});
    if(path.includes('/locations/'))return Response.json({location:{id:'test-location',status:'ACTIVE',currency:'USD',capabilities:['CREDIT_CARD_PROCESSING']}});
    if(path==='/v2/catalog/batch-retrieve')return Response.json({objects:[{id:'party',type:'ITEM_VARIATION',item_variation_data:{price_money:{amount:30000,currency:'USD'}}},{id:'plan',type:'SUBSCRIPTION_PLAN_VARIATION',subscription_plan_variation_data:{phases:[{cadence:'MONTHLY',pricing:{type:'STATIC',price_money:{amount:6000,currency:'USD'}}}]}}]});
    return Response.json({subscriptions:[{enabled:false,notification_url:'http://localhost:3000/api/webhooks/square',signature_key:'private-signing-key',api_version:'2025-10-16',event_types:[]}]});
   }}).load('src/app/api/admin/square/readiness/route.ts');
 const response=await route.GET(),text=await response.text(),body=JSON.parse(text);
 assert.equal(body.checks.party_catalog,true);assert.equal(body.checks.membership_catalog,true);assert.equal(body.webhook_enabled,false);
 assert.equal(body.checks.webhook_configured,false);assert.ok(!text.includes('private-signing-key'));assert.ok(!text.includes('sandbox-test-token'));
 assert.ok(calls.every(call=>call.method==='GET'||call.path==='/v2/catalog/batch-retrieve'));
});
