import {test} from 'node:test';
import assert from 'node:assert/strict';
import {squareTestDatabase,localSquareAdmin,ids} from './helpers/square-harness.mjs';

test('pre-opening free reservation remains compatible with the currently deployed confirmed-booking flow',async t=>{
 const db=await squareTestDatabase();t.after(()=>db.close());const admin=localSquareAdmin(db);
 const booking={household_id:ids.household,start_time:'2032-07-03T14:00:00Z',end_time:'2032-07-03T17:00:00Z',status:'confirmed',price_quote_cents:30000,created_by_user_id:ids.user,created_by_role:'customer'};
 const saved=await admin.from('party_bookings').insert(booking).select('*').single();assert.equal(saved.error,null);assert.equal(saved.data.square_invoice_id,null);assert.equal(saved.data.deposit_paid_cents,0);
 const overlap=await admin.from('party_bookings').insert({...booking,household_id:ids.other}).select('*').single();assert.match(overlap.error.message,/already booked/);
 await db.exec('set role authenticated');await assert.rejects(db.query("insert into party_bookings(household_id,start_time,end_time,status) values($1,'2032-07-04','2032-07-05','confirmed')",[ids.household]),/permission denied/);await db.exec('reset role');
});

test('a Square reservation cannot use the free-booking exception or clear its invoice association',async t=>{
 const db=await squareTestDatabase();t.after(()=>db.close());const admin=localSquareAdmin(db);
 const r=await admin.rpc('reserve_party_invoice',{p_household:ids.household,p_environment:'sandbox',p_location:'test-location',p_user:ids.user,p_role:'customer',p_booking:{start_time:'2032-07-03T14:00:00Z',end_time:'2032-07-03T17:00:00Z'}});assert.equal(r.error,null);
 const attempted=await admin.from('party_bookings').update({status:'confirmed'}).eq('id',r.data.id);assert.match(attempted.error.message,/verified Square deposit/);
 const cleared=await admin.from('party_bookings').update({square_environment:null,status:'confirmed'}).eq('id',r.data.id);assert.match(cleared.error.message,/cannot be removed/);
});
