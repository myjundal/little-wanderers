import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {loadSquareModules,localSquareAdmin,ids} from './helpers/admission-pos-harness.mjs';

const gift={id:ids.other,household_id:ids.household,person_id:null,renews_at:null,square_environment:'production',square_subscription_id:null,square_customer_id:null,payment_review_required:false,covered_person_ids:[ids.person]};
const modules=()=>loadSquareModules({env:{SQUARE_ENVIRONMENT:'production'}});
test('only verified nonexpiring entitlements without a billing connection are complimentary',()=>{
 const {isComplimentaryMembership:check}=modules().load('src/lib/complimentary-membership.ts');
 assert.equal(check(gift,'production'),true);
 for(const patch of [{square_environment:'sandbox'},{square_environment:null},{renews_at:'2027-01-01'}, {square_subscription_id:'paid'},{square_customer_id:'customer'},{payment_review_required:true},{covered_person_ids:[]},{person_id:ids.person}])assert.equal(check({...gift,...patch},'production'),false);
});
async function setup(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create table memberships(id uuid,household_id uuid,person_id uuid,renews_at timestamptz,square_environment text,square_subscription_id text,square_customer_id text,payment_review_required boolean,covered_person_ids jsonb);
 create table people(id uuid,household_id uuid,first_name text,last_name text,birthdate date,role text,created_at timestamptz);
 create table founding_memberships(household_id uuid,child_ids jsonb,status text,start_date date,paid_through date,environment text);`);
 await db.query('insert into memberships values($1,$2,null,null,$3,null,null,false,$4)',[gift.id,gift.household_id,'production',JSON.stringify(gift.covered_person_ids)]);
 await db.query("insert into people values($1,$2,'Child','Family','2023-01-01','child',now()),($3,$2,'Parent','Family',null,'adult',now())",[ids.person,ids.household,ids.user]);
 return {db,admin:localSquareAdmin(db)};
}
test('complimentary family books future Open Play for zero; another child remains chargeable',async t=>{
 const {admin}=await setup(t);const m=modules();
 const family=await m.load('src/lib/soft-opening-family.ts').readSoftOpeningFamily(admin,ids.household);
 const {softOpeningAmount}=m.load('src/lib/soft-opening-pricing.ts');
 assert.equal(family.memberships[0].status,'complimentary');
 assert.equal(softOpeningAmount([ids.person],family.memberships,'2036-11-14',family.children),0);
 assert.equal(softOpeningAmount([ids.otherPerson],family.memberships,'2036-11-14',[]),1600);
});
test('owner activation cannot create a paid subscription for a complimentary household',async t=>{
 const {admin}=await setup(t);let providerCalls=0;
 const m=loadSquareModules({env:{SQUARE_ENVIRONMENT:'production',FOUNDING_BILLING_ENABLED:'true'},fetch:async()=>{providerCalls++;throw Error('Forbidden provider write');}});
 const {easternDate,FOUNDING_TERMS_VERSION}=m.load('src/lib/founding-membership.ts');
 await assert.rejects(m.load('src/lib/founding-square.ts').activateFounding(admin,{id:ids.other,household_id:ids.household,status:'pending',environment:'production',square_card_id:'card',square_customer_id:'customer',terms_version:FOUNDING_TERMS_VERSION},easternDate()),/lifetime Friends & Family/);
 assert.equal(providerCalls,0);
});
test('membership lookup failure prevents paid activation',async()=>{
 const m=modules();const admin={from:()=>({select(){return this;},eq(){return Promise.resolve({data:null,error:{message:'DB unavailable'}});}})};
 await assert.rejects(m.load('src/lib/complimentary-membership.ts').readComplimentaryMembership(admin,ids.household),/Unable to confirm/);
});
