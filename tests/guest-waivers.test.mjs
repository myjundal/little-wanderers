import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {loadModule} from './helpers/class-preregistration-harness.mjs';
import {z} from 'zod';

const content=loadModule('src/lib/waiver-content.ts');
const version=content.WAIVER_VERSION;
const name='Parent Example', email='parent@example.test';
const profile={first_name:'Parent',last_name:'Example',phone:'+18605551234',signature:name,photo_consent:false,children:[{first_name:'Sam',last_name:'Example',birthdate:'2023-01-01'}]};
const snapshot={title:content.WAIVER_TITLE,paragraphs:content.WAIVER_PARAGRAPHS,agreements:content.WAIVER_AGREEMENTS,signature_text:content.WAIVER_SIGNATURE_TEXT,is_guardian:true,electronic_consent:true};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const one=async(db,sql,args=[]) => (await db.query(sql,args)).rows[0];
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(fs.readFileSync('tests/helpers/guest-waiver-schema.sql','utf8'));
 await db.exec(fs.readFileSync('db/migrations/20261031_guest_party_waivers.sql','utf8'));
 return db;
}
async function session(db,address=email,party=null){
 const token=hash(crypto.randomUUID()), code=hash(crypto.randomUUID());
 await db.query("update guest_waiver_sessions set created_at=now()-interval '2 minutes' where email=$1",[address]);
 const result=await one(db,'select begin_guest_waiver($1,$2,$3,$4,$5) result',[address,token,code,hash('ip'),party]);
 assert.equal(result.result.ok,true);
 const verified=await one(db,'select verify_guest_waiver($1,$2) result',[token,code]);assert.equal(verified.result.ok,true);
 return token;
}
const context=async(db,token)=>(await one(db,'select guest_waiver_context($1,$2) value',[token,version])).value;
async function sign(db,token,p=profile,expected){
 return (await one(db,'select sign_guest_waiver($1,$2,$3,$4,$5) result',[token,JSON.stringify(expected??(await context(db,token)).children),JSON.stringify(p),version,JSON.stringify(snapshot)])).result;
}

test('guest signs atomically without an Auth account; keeps shared family IDs, signed evidence and party association',async t=>{
 const db=await fixture(t);const host=(await one(db,"insert into households(name) values('Host') returning id")).id;
 const party=(await one(db,'insert into party_bookings(household_id) values($1) returning id',[host])).id;
 const token=await session(db,email,party);const result=await sign(db,token);
 const waiver=await one(db,'select * from waivers where id=$1',[result.waiver_id]);
 assert.equal(waiver.parent_name,name);assert.equal(waiver.source,'guest_website');assert.equal(waiver.signed_by_user_id,null);
 assert.equal(waiver.photo_consent,false);assert.equal(waiver.agreement_snapshot.verified_email,email);
 assert.deepEqual(waiver.agreement_snapshot.paragraphs,Array.from(content.WAIVER_PARAGRAPHS));
 assert.equal(new Date(waiver.waiver_expires_at)-new Date(waiver.signed_at),90*86400000);
 assert.equal(waiver.covered_person_ids[0],waiver.agreement_snapshot.children[0].id);
 assert.equal((await one(db,'select count(*)::int n from auth.users')).n,0);
 assert.equal((await one(db,'select count(*)::int n from checkins')).n,0);
 assert.equal((await one(db,'select count(*)::int n from party_guest_waivers')).n,1);
 assert.deepEqual(await sign(db,token),result);assert.equal((await one(db,'select count(*)::int n from waivers')).n,1);
});

test('codes expire, failed attempts persist and rate limits apply before email delivery',async t=>{
 const db=await fixture(t);const token=hash('token'),code=hash('code');
 const start=()=>one(db,'select begin_guest_waiver($1,$2,$3,$4,null) result',[email,token,code,hash('ip')]);
 assert.equal((await start()).result.ok,true);assert.equal((await start()).result.code,'rate_limited');
 assert.equal((await context(db,token)).verified,false);
 for(let i=0;i<5;i++)assert.equal((await one(db,'select verify_guest_waiver($1,$2) result',[token,hash('wrong')])).result.ok,false);
 assert.equal((await one(db,'select attempts from guest_waiver_sessions')).attempts,5);
 assert.equal((await one(db,'select verify_guest_waiver($1,$2) result',[token,code])).result.code,'verification_expired');
 await db.query("update guest_waiver_sessions set attempts=0,code_expires_at=now()-interval '1 second'");
 assert.equal((await one(db,'select verify_guest_waiver($1,$2) result',[token,code])).result.ok,false);
 await assert.rejects(sign(db,token),/verify your email/);
});

test('returning guest reuses family, children and a current waiver for another party without signing again',async t=>{
 const db=await fixture(t);const token=await session(db);const first=await sign(db,token);
 const original=await one(db,'select household_id,covered_person_ids from waivers');
 const party=(await one(db,'insert into party_bookings default values returning id')).id;
 const next=await session(db,email,party);const ctx=await context(db,next);
 assert.equal(ctx.children[0].id,original.covered_person_ids[0]);assert.equal(ctx.existing_waiver.id,first.waiver_id);
 await db.query('select use_guest_waiver($1,$2,$3)',[next,first.waiver_id,version]);
 assert.equal((await one(db,'select count(*)::int n from waivers')).n,1);
 assert.equal((await one(db,'select count(*)::int n from people')).n,2);
 assert.equal((await one(db,'select household_id from party_guest_waivers')).household_id,original.household_id);
});

test('verified caregiver of an existing account signs into the same family; matching contact email alone grants no access',async t=>{
 const db=await fixture(t);const user=(await one(db,'insert into auth.users(email,email_confirmed_at) values($1,now()) returning id',[email])).id;
 const family=(await one(db,"insert into households(name) values('Existing Family') returning id")).id;
 await db.query("insert into household_members(household_id,user_id,role) values($1,$2,'caregiver')",[family,user]);
 const child=(await one(db,"insert into people(household_id,role,first_name,last_name,birthdate) values($1,'child','Sam','Example','2023-01-01') returning id",[family])).id;
 const token=await session(db);assert.equal((await context(db,token)).children[0].id,child);
 await sign(db,token);assert.equal((await one(db,'select household_id from waivers')).household_id,family);
 assert.equal((await one(db,"select count(*)::int n from people where role='child'")).n,1);
 await db.query("insert into households(name,email) values('Private victim family','other@example.test')");
 const other=await session(db,'other@example.test');assert.deepEqual((await context(db,other)).children,[]);
});

test('signup claims the existing guest family with its original waiver and person IDs, preserving empty placeholders',async t=>{
 const db=await fixture(t);await sign(db,await session(db));
 const before=await one(db,'select id,household_id,covered_person_ids from waivers');
 const user=(await one(db,'insert into auth.users(email,email_confirmed_at) values($1,now()) returning id',[email])).id;
 const empty=(await one(db,"insert into households(name) values('My Household') returning id")).id;
 await db.query("insert into household_members(household_id,user_id,role) values($1,$2,'primary_caregiver')",[empty,user]);
 const result=(await one(db,'select claim_guest_waiver_family($1) result',[user])).result;
 assert.equal(result.claimed,true);assert.equal(result.household_id,before.household_id);
 assert.deepEqual(await one(db,'select id,household_id,covered_person_ids from waivers'),before);
 assert.equal((await one(db,'select count(*)::int n from households')).n,2);
 assert.equal((await one(db,'select canonical_household_id from staff_family_search_aliases where alias_household_id=$1',[empty])).canonical_household_id,before.household_id);
 assert.equal((await one(db,'select count(*)::int n from people')).n,2);
 assert.equal((await one(db,'select claim_guest_waiver_family($1) result',[user])).result.claimed,true);
});

test('unverified or different Auth email cannot claim a family, and a populated conflicting family requires review',async t=>{
 const db=await fixture(t);await sign(db,await session(db));
 const unverified=(await one(db,'insert into auth.users(email) values($1) returning id',[email])).id;
 assert.equal((await one(db,'select claim_guest_waiver_family($1) result',[unverified])).result.claimed,false);
 const other=(await one(db,"insert into auth.users(email,email_confirmed_at) values('other@example.test',now()) returning id")).id;
 assert.equal((await one(db,'select claim_guest_waiver_family($1) result',[other])).result.claimed,false);
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[unverified]);
 const family=(await one(db,"insert into households(name) values('Another Family') returning id")).id;
 await db.query("insert into household_members(household_id,user_id,role) values($1,$2,'primary_caregiver')",[family,unverified]);
 await db.query("insert into people(household_id,role,first_name) values($1,'child','Different')",[family]);
 assert.equal((await one(db,'select claim_guest_waiver_family($1) result',[unverified])).result.review_required,true);
 assert.equal((await one(db,'select count(*)::int n from household_members where user_id=$1',[unverified])).n,1);
 await assert.rejects(context(db,await session(db)),/front desk/);
});

test('changed children or conflicting birthdays reject the entire signature transaction without duplicating people',async t=>{
 const db=await fixture(t);await sign(db,await session(db));
 const next=await session(db);const old=(await context(db,next)).children;
 const family=(await one(db,'select household_id from waivers')).household_id;
 await db.query("insert into people(household_id,role,first_name,last_name,birthdate) values($1,'child','New','Example','2024-01-01')",[family]);
 await assert.rejects(sign(db,next,profile,old),/family changed/);
 await assert.rejects(sign(db,next,{...profile,first_name:'Another',children:[{...profile.children[0],birthdate:'2023-02-01'}]}),/front desk/);
 assert.equal((await one(db,"select count(*)::int n from people where role='adult'")).n,1);
 assert.equal((await one(db,'select count(*)::int n from waivers')).n,1);
 const current=(await context(db,next));assert.equal(current.existing_waiver,null);
 await assert.rejects(db.query('select use_guest_waiver($1,$2,$3)',[next,(await one(db,'select id from waivers')).id,version]),/renew/);
});

test('expired or old waivers cannot be reused and cancelled party links cannot accept a signature',async t=>{
 const db=await fixture(t);const first=await sign(db,await session(db));
 await db.exec("update waivers set waiver_expires_at=now()-interval '1 second'");
 const next=await session(db);assert.equal((await context(db,next)).existing_waiver,null);
 await assert.rejects(db.query('select use_guest_waiver($1,$2,$3)',[next,first.waiver_id,version]),/renew/);
 const party=(await one(db,'insert into party_bookings default values returning id')).id;
 const token=await session(db,'new@example.test',party);await db.query("update party_bookings set status='cancelled' where id=$1",[party]);
 await assert.rejects(sign(db,token),/no longer available/);
 assert.equal((await one(db,'select count(*)::int n from guest_waiver_identities')).n,1);
});

test('guest tables and identity RPCs are inaccessible to anonymous and authenticated browser roles',async t=>{
 const db=await fixture(t);
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  await assert.rejects(db.query('select * from guest_waiver_sessions'),/permission denied/);
  await assert.rejects(db.query('select guest_waiver_household($1)',[email]),/permission denied/);
  await assert.rejects(db.query('select claim_guest_waiver_family($1)',[crypto.randomUUID()]),/permission denied/);
  await db.exec('reset role');
 }
});

const birthdates=loadModule('src/lib/birthdate.ts');
const helper=loadModule('src/lib/guest-waivers.ts',{'node:crypto':crypto,zod:{z},'@/lib/birthdate':birthdates,'@/lib/supabase/admin':{}},{process:{env:{SUPABASE_SERVICE_ROLE_KEY:'test-only-secret'}}});
test('guest form validation accepts international contacts, preserves photo refusal and requires all child birthdays',()=>{
 const body={...profile,is_guardian:true,electronic_consent:true,agreements:{},phone:'(860) 555-1234'};
 assert.equal(helper.guestProfileSchema.parse(body).phone,'+18605551234');
 assert.equal(helper.guestProfileSchema.parse({...body,phone:'+44 20 7946 0018'}).phone,'+442079460018');
 assert.equal(helper.guestProfileSchema.parse(body).photo_consent,false);
 assert.equal(helper.guestProfileSchema.safeParse({...body,photo_consent:undefined}).success,false);
 assert.equal(helper.guestProfileSchema.safeParse({...body,children:[{...profile.children[0],birthdate:'2099-01-01'}]}).success,false);
});

function apiFixture({verified=true,mailOk=true,beginOk=true}={}){
 const calls=[],mails=[],cookieWrites=[];let token='a'.repeat(64);
 const ctx={verified,email,children:[{id:'child',first_name:'Sam',last_name:'Example',birthdate:'2023-01-01'}]};
 const admin={rpc:async(fn,args)=>{
  calls.push({fn,args});
  if(fn==='begin_guest_waiver')return {data:{ok:beginOk,code:'rate_limited'}};
  if(fn==='guest_waiver_context')return {data:ctx};
  if(fn==='verify_guest_waiver')return {data:{ok:verified}};
  if(fn==='sign_guest_waiver')return {data:{waiver_id:'saved',expires_at:'2027-01-29T12:00:00Z'}};
  throw Error(fn);
 }};
 const jsonResponse={json:(body,options)=>{const response=Response.json(body,options);response.cookies={set:(...args)=>cookieWrites.push(args)};return response;}};
 const api=loadModule('src/app/api/guest-waivers/route.ts',{
  'node:crypto':crypto,'next/headers':{cookies:async()=>({get:()=>token?{value:token}:undefined})},'next/server':{NextResponse:jsonResponse},
  '@/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},'@/lib/email-campaigns':{sendResendEmail:async input=>{mails.push(input);return {ok:mailOk};}},
  '@/lib/open-play-reservations':{isUuid:value=>/^[a-f\d-]{36}$/.test(value)},'@/lib/guest-waivers':helper,'@/lib/waiver-content':content,
 },{process:{env:{NODE_ENV:'production'}}});
 const post=(payload,origin='https://example.test')=>api.POST(new Request('https://example.test/api/guest-waivers',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(payload)}));
 const body={mode:'sign',...profile,version,family_revision:helper.guestFamilyRevision(ctx.children),is_guardian:true,electronic_consent:true,agreements:Object.fromEntries(content.WAIVER_AGREEMENTS.map(item=>[item.id,true]))};
 return {api,calls,mails,cookieWrites,ctx,post,body,setToken:value=>{token=value;}};
}

test('public API sends only a verification email, keeps the token in a secure HttpOnly cookie, and never returns the code',async()=>{
 const h=apiFixture();const response=await h.post({mode:'request_code',email:' PARENT@EXAMPLE.TEST '});
 assert.equal(response.status,200);const result=await response.json();
 assert.deepEqual(result,{ok:true,code_sent:true});assert.equal(h.mails.length,1);assert.equal(h.mails[0].to,email);
 const [,token,options]=h.cookieWrites[0];assert.match(token,/^[a-f\d]{64}$/);assert.equal(options.httpOnly,true);assert.equal(options.secure,true);assert.equal(options.sameSite,'lax');
 assert.equal(h.calls[0].args.p_email,email);assert.notEqual(h.calls[0].args.p_token_hash,token);
 assert.ok(h.calls.every(call=>call.fn==='begin_guest_waiver'));
 const limited=apiFixture({beginOk:false});assert.equal((await limited.post({mode:'request_code',email})).status,429);assert.equal(limited.mails.length,0);
 const failed=apiFixture({mailOk:false});assert.equal((await failed.post({mode:'request_code',email})).status,503);assert.equal(failed.cookieWrites.length,0);
});

test('public signature API enforces verified sessions, same origin, current text, required consent and an unchanged family',async()=>{
 const h=apiFixture();
 assert.equal((await h.post(h.body,'https://foreign.test')).status,403);assert.equal(h.calls.length,0);
 h.setToken('');assert.equal((await h.post(h.body)).status,401);h.setToken('a'.repeat(64));
 for(const patch of [{is_guardian:false},{electronic_consent:false},{photo_consent:undefined},{agreements:{}},{signature:''}])assert.equal((await h.post({...h.body,...patch})).status,400);
 assert.equal((await h.post({...h.body,version:'old'})).status,409);
 assert.equal((await h.post({...h.body,family_revision:'stale'})).status,409);
 const unverified=apiFixture({verified:false});assert.equal((await unverified.post(unverified.body)).status,401);
 assert.ok(h.calls.every(call=>call.fn!=='sign_guest_waiver'));
});

test('public signature API ignores forged ownership and timestamps, and supplies the original legal text and server family revision',async()=>{
 const h=apiFixture();const response=await h.post({...h.body,household_id:'victim',signed_at:'2099-01-01',signed_by_user_id:'victim'});
 assert.equal(response.status,200);const call=h.calls.find(call=>call.fn==='sign_guest_waiver');
 assert.equal(call.args.p_profile.household_id,undefined);assert.equal(call.args.p_profile.signed_at,undefined);
 assert.equal(call.args.p_profile.photo_consent,false);assert.equal(call.args.p_version,version);
 assert.deepEqual(call.args.p_expected_children,h.ctx.children);assert.equal(call.args.p_snapshot.paragraphs,content.WAIVER_PARAGRAPHS);
});
