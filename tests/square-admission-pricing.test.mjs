import {test} from 'node:test';
import assert from 'node:assert/strict';
import {squareTestDatabase,localSquareAdmin,loadSquareModules,ids} from './helpers/square-harness.mjs';

test('published infant boundary matches online quotes, checkout amounts and QR family totals',async t=>{
  const db=await squareTestDatabase();t.after(()=>db.close());
  const admin=localSquareAdmin(db);
  const {admissionPrice,addMonths}=loadSquareModules().load('src/lib/payment-pricing.ts');
  const now=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const visit=addMonths(now.slice(0,8)+'01',1);
  const boundary=addMonths(visit,-6);
  const day=(date,offset)=>new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
  const adults=['30000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000013'];
  for(const id of adults)await db.query("insert into people(id,household_id,role,first_name,birthdate) values($1,$2,'adult','Parent',null)",[id,ids.household]);
  for(const [birthdate,expected] of [[day(boundary,1),1500],[boundary,1500],[day(boundary,-1),2100]]){
    await db.query('update people set birthdate=$1 where id=$2',[birthdate,ids.person]);
    const people=[{id:ids.person,role:'child',birthdate},...adults.map(id=>({id,role:'adult',birthdate:null}))];
    assert.equal(admissionPrice(people,visit),expected);
    const qr=await db.query('select open_play_total_cents($1::date[],3,$2::date) amount',[[birthdate],visit]);
    assert.equal(qr.rows[0].amount,expected);
    const checkout=await admin.rpc('prepare_square_checkout',{p_household:ids.household,p_kind:'admission',p_environment:'sandbox',p_location:'test-location',p_user:ids.user,p_role:'customer',p_request:{visit_date:visit,person_ids:people.map(p=>p.id),quoted_amount_cents:expected}});
    assert.equal(checkout.error,null);assert.equal(checkout.data.expected_amount_cents,expected);
    await admin.from('square_checkout_attempts').update({status:'cancelled'}).eq('id',checkout.data.id);
  }
  assert.equal(admissionPrice([{id:'baby',role:'child',birthdate:boundary},{id:'older',role:'child',birthdate:'2023-01-01'},...adults.map(id=>({id,role:'adult',birthdate:null}))],visit),3100);
  // Reapplying the compatibility correction must preserve the latest checkout recovery logic.
  const {readFileSync}=await import('node:fs');
  const original=(await db.query("select pg_get_functiondef('prepare_square_checkout(uuid,text,text,text,uuid,text,jsonb)'::regprocedure) body")).rows[0].body;
  await db.exec(readFileSync('db/migrations/20261029_admission_infant_boundary.sql','utf8'));
  const definition=(await db.query("select pg_get_functiondef('prepare_square_checkout(uuid,text,text,text,uuid,text,jsonb)'::regprocedure) body")).rows[0].body;
  assert.equal(definition,original);
});
