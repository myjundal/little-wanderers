import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadSquareModules} from './helpers/admission-pos-harness.mjs';
import {loadModule} from './helpers/class-preregistration-harness.mjs';
const {summarizeMemberships,loadMembershipSummary}=loadSquareModules().load('src/lib/membership-summary.ts');
const now=new Date('2026-11-10T15:00:00Z');
const enrollment=(household_id,pricing_tier='waitlist',status='pending',child_ids=['child'])=>({household_id,pricing_tier,status,child_ids,created_at:'2026-11-10T12:00:00Z'});

test('membership totals count enrolled families and their children, preserve tier identity, and exclude incomplete and canceled enrollments',()=>{
 const result=summarizeMemberships([
  enrollment('wander','waitlist','pending',['a','b']),enrollment('public','public','active',['c']),enrollment('regular','regular','scheduled',['d']),
  ...['draft','saving_card','canceled'].map(s=>enrollment(s,'waitlist',s,['excluded'])),
 ],[],[],'production',now);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{waitlist:{memberships:1,children:2},public:{memberships:1,children:1},regular:{memberships:1,children:1},total:{memberships:3,children:4},unverifiedGeneral:0});
});
test('legacy General memberships honor expiry and environment and never double-count a family enrolled in the newer system',()=>{
 const result=summarizeMemberships([enrollment('founding','public','pending',['founding-child'])],[
  {square_environment:'production',household_id:'founding',renews_at:null},{square_environment:'production',household_id:'legacy',renews_at:'2026-12-01T00:00:00Z'},
  {square_environment:'production',household_id:'legacy',renews_at:null},{household_id:'sandbox',square_environment:'sandbox',renews_at:null},
  {square_environment:'production',household_id:'expired',renews_at:'2026-11-10T15:00:00Z'},
 ],[{id:'l1',household_id:'legacy'},{id:'l2',household_id:'legacy'}],'production',now);
 assert.equal(result.total.memberships,2);assert.equal(result.total.children,3);assert.equal(result.regular.memberships,1);assert.equal(result.regular.children,2);
});
test('canceling membership remains counted only through its paid term, and the newest current enrollment wins over old rows',()=>{
 const result=summarizeMemberships([
  {...enrollment('paid','public','canceling'),paid_through:'2026-11-10'},
  {...enrollment('expired','public','canceling'),paid_through:'2026-11-09'},
  {...enrollment('rejoined','waitlist','canceled'),created_at:'2026-10-01'},enrollment('rejoined','regular','active'),
 ],[],[],'production',now);
 assert.equal(result.total.memberships,2);assert.equal(result.public.memberships,1);assert.equal(result.regular.memberships,1);assert.equal(result.waitlist.memberships,0);
});
test('summary loader paginates past the API row limit and scopes founding records to the configured environment',async()=>{
 const calls=[];const rows=Array.from({length:1101},(_,i)=>({...enrollment(`family-${i}`),environment:'production'}));rows.push({...enrollment('sandbox'),environment:'sandbox'});
 const admin={from(table){let environment;const q={select(){return q;},eq(k,v){if(k==='environment')environment=v;return q;},order(){return q;},async range(start,end){calls.push({table,environment,start,end});return {data:(table==='founding_memberships'?rows.filter(r=>r.environment===environment):[]).slice(start,end+1),error:null};}};return q;}};
 const result=await loadMembershipSummary(admin,'production');assert.equal(result.total.memberships,1101);assert.equal(calls.filter(c=>c.table==='founding_memberships').length,3);assert(calls.filter(c=>c.table==='founding_memberships').every(c=>c.environment==='production'));
});
test('summary endpoint requires owner access and returns a visible failure instead of zero totals on database errors',async()=>{
 for(const allowed of [false,true]){
  let reads=0;const api=loadSquareModules({mocks:{'@/lib/authz':{requireOwnerContext:async()=>allowed?{ok:true,admin:{from(){reads++;throw Error('offline');}}}:{ok:false,response:Response.json({ok:false},{status:403})}}}}).load('src/app/api/admin/membership-summary/route.ts');
  const response=await api.GET();assert.equal(response.status,allowed?503:403);assert.equal(reads,allowed?1:0);assert.equal((await response.json()).summary,undefined);
 }
});
test('owner dashboard and hamburger expose Membership management while staff retain their operational menu',()=>{
 const navigation=loadModule('src/lib/operator-navigation.ts');
 const Nav=loadModule('src/components/staff/StaffToolNav.tsx',{'next/link':'a','@/lib/operator-navigation':navigation,'./operator-navigation.module.css':{}},{React}).default;
 assert.equal(navigation.activeOperatorLink('/staff/founding-memberships'),'memberships');
 for(const role of ['owner','admin','staff']){
  const Menu=loadModule('src/components/landing/LandingMoreMenu.tsx',{'react':{...React,useState:()=>[true,()=>{}]},'next/link':'a','next/image':'img','@/lib/feature-flags':{},'@/components/staff/StaffToolNav':Nav,'@/lib/use-owner-dashboard-access':{useOperatorAccess:()=>({role,canUseOwnerDashboard:true,isLoading:false,isKiosk:false})}},{React}).default;
  const html=renderToStaticMarkup(React.createElement(Menu));assert.equal(html.includes('Membership management'),role!=='staff');
 }
});

test('individual General memberships count their family once and only their covered children',()=>{
 const general=[{household_id:null,person_id:'one',square_environment:'production',renews_at:null},{household_id:null,person_id:'two',square_environment:'production',renews_at:null},{household_id:null,person_id:'adult',square_environment:'production',renews_at:null}];
 const people=[{id:'one',household_id:'family',role:'child'},{id:'two',household_id:'family',role:'child'},{id:'uncovered',household_id:'family',role:'child'},{id:'adult',household_id:'other',role:'adult'}];
 const result=summarizeMemberships([],general,people,'production',now);
 assert.equal(result.total.memberships,2);assert.equal(result.total.children,2);
 const household=summarizeMemberships([],[...general,{household_id:'family',square_environment:'production',renews_at:null}],people,'production',now);
 assert.equal(household.total.memberships,2);assert.equal(household.total.children,3);
});
test('unclassified legacy records never become production memberships by default',()=>{
 const rows=[{household_id:'unknown',renews_at:null},{household_id:'sandbox',square_environment:'sandbox',renews_at:null},{household_id:'live',square_environment:'production',renews_at:null}];
 const result=summarizeMemberships([],rows,[],'production',now);
 assert.equal(result.total.memberships,1);assert.equal(result.unverifiedGeneral,1);
});
test('summary loader resolves person memberships and loads only covered people',async()=>{
 const calls=[];
 const admin={from(table){let field,ids,role;const q={select(){return q;},order(){return q;},eq(key,value){if(key==='role')role=value;return q;},in(key,values){field=key;ids=values;return q;},async range(){return {data:table==='memberships'?[{household_id:null,person_id:'covered',renews_at:null,square_environment:'production'}]:[],error:null};},then(resolve){calls.push({table,field,ids,role});return Promise.resolve({data:[{id:'covered',household_id:'family',role:'child'}],error:null}).then(resolve);}};return q;}};
 const result=await loadMembershipSummary(admin,'production');
 assert.equal(result.regular.memberships,1);assert.equal(result.regular.children,1);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{table:'people',field:'id',ids:['covered']}]);
});
