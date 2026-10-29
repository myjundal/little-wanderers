import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {squareTestDatabase,localSquareAdmin,ids} from './helpers/square-harness.mjs';

async function programFixture(t) {
  const db=await squareTestDatabase();t.after(()=>db.close());
  const admin=localSquareAdmin(db), sessions=Array.from({length:5},()=>crypto.randomUUID());
  for(let i=0;i<sessions.length;i++){
    await db.query(`insert into classes(id,title,status,price_cents,capacity,start_time)
      values($1,'Art program','scheduled',15000,2,now()+($2::integer*interval '1 week'))`,[sessions[i],i+1]);
    await db.query(`insert into square_catalog_mappings(environment,kind,entity_key,variation_id,program_key)
      values('sandbox','class',$1,'program-variation','art-five-weeks')`,[sessions[i]]);
  }
  const prepare=(items=sessions.map(class_id=>({class_id,quantity:1})))=>admin.rpc('prepare_square_checkout',{
    p_household:ids.household,p_kind:'class',p_environment:'sandbox',p_location:'test-location',p_user:ids.user,
    p_role:'customer',p_request:{person_id:ids.person,items},
  });
  return {db,admin,sessions,prepare};
}

test('a five-session program charges $150 once and confirms all five only after verified payment',async t=>{
  const {db,admin,sessions,prepare}=await programFixture(t);
  const old=crypto.randomUUID();
  await db.query(`insert into class_registrations(id,class_id,person_id,household_id,status)
    values($1,$2,$3,$4,'preregistered')`,[old,sessions[0],ids.person,ids.household]);
  const result=await prepare();assert.equal(result.error,null);
  const attempt=result.data;
  assert.equal(attempt.expected_amount_cents,15000);
  assert.equal(attempt.payload.line_items.length,1);
  assert.equal(attempt.payload.line_items[0].base_price_money.amount,15000);
  assert.equal(attempt.payload.assignments.length,5);
  assert.equal((await prepare()).data.id,attempt.id);
  assert.match((await admin.rpc('fulfill_square_class_checkout',{p_id:attempt.id})).error.message,/verified checkout payment/);
  await admin.from('square_checkout_attempts').update({order_id:'program-order'}).eq('id',attempt.id);
  await admin.rpc('save_square_payment_receipt',{p_environment:'sandbox',p_payment:'program-payment',p_order:'program-order',
    p_amount:15000,p_refunded:0,p_status:'COMPLETED',p_updated:new Date().toISOString()});
  const fulfilled=await admin.rpc('fulfill_square_class_checkout',{p_id:attempt.id});assert.equal(fulfilled.error,null);
  assert.equal(fulfilled.data.registration_count,5);assert.ok(fulfilled.data.registration_ids.includes(old));
  assert.deepEqual((await admin.rpc('fulfill_square_class_checkout',{p_id:attempt.id})).data,fulfilled.data);
  const rows=(await db.query('select class_id,status from class_registrations')).rows;
  assert.equal(rows.length,5);assert.ok(rows.every(r=>r.status==='scheduled'));
});

test('selecting one occurrence includes the whole program; ordinary weekly classes remain per occurrence',async t=>{
  const {prepare,sessions}=await programFixture(t);
  const result=await prepare([{class_id:sessions[2],quantity:1},{class_id:ids.klass,quantity:1}]);
  assert.equal(result.error,null);assert.equal(result.data.expected_amount_cents,17000);
  assert.equal(result.data.payload.line_items.length,2);assert.equal(result.data.payload.assignments.length,6);
});

test('a full occurrence prevents starting the whole program checkout',async t=>{
  const {db,prepare,sessions}=await programFixture(t);
  await db.query('update classes set capacity=0 where id=$1',[sessions[3]]);
  const result=await prepare([{class_id:sessions[0],quantity:1}]);assert.match(result.error.message,/enough seats/);
  assert.equal((await db.query('select count(*)::integer n from square_checkout_attempts')).rows[0].n,0);
});

test('program checkout rejects inconsistent quantities, prices, cancelled or started occurrences',async t=>{
  const {db,prepare,sessions}=await programFixture(t);
  assert.match((await prepare([{class_id:sessions[0],quantity:1},{class_id:sessions[1],quantity:2}])).error.message,/quantities must match/);
  await db.query('update classes set price_cents=3000 where id=$1',[sessions[3]]);
  assert.match((await prepare()).error.message,/inconsistent/);
  await db.query(`update classes set price_cents=15000,status='cancelled' where id=$1`,[sessions[3]]);
  assert.match((await prepare([{class_id:sessions[0],quantity:1}])).error.message,/not available/);
  await db.query(`update classes set status='scheduled',start_time=now()-interval '1 day' where id=$1`,[sessions[3]]);
  assert.match((await prepare()).error.message,/Program has started/);
});

test('an already registered selected child never causes another sibling to be charged or registered instead',async t=>{
  const {db,prepare,sessions}=await programFixture(t);
  const sibling=crypto.randomUUID();
  await db.query(`insert into people(id,household_id,role,first_name) values($1,$2,'child','Sibling')`,[sibling,ids.household]);
  await db.query(`insert into class_registrations(class_id,person_id,household_id,status) values($1,$2,$3,'scheduled')`,[sessions[4],ids.person,ids.household]);
  assert.match((await prepare([{class_id:sessions[0],quantity:1}])).error.message,/Selected participant is not eligible/);
  assert.equal((await db.query('select count(*)::integer n from square_checkout_attempts')).rows[0].n,0);
});
