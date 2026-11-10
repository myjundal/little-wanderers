import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';

function setup({ populated = ['source-family'], otherRole = 'primary_caregiver', sourceRole = 'primary_caregiver' } = {}) {
  const writes = [];
  const db = { from(table) {
    const filters = {};
    let row;
    const q = { select() { return q; }, eq(k,v) { filters[k]=v; return q; }, in(){return q;}, maybeSingle() { return q; }, limit() { return q; },
      upsert(value) { row=value; writes.push({table,row}); return q; },
      then(resolve) { resolve({ error: null, data: row ? row : table==='household_members' ? {role:filters.user_id==='source-user'?sourceRole:otherRole} : table==='people'&&populated.includes(filters.household_id)?[{id:'child'}]:[] }); },
    };return q;
  } };
  const api=loadSquareModules({env:{SUPABASE_SERVICE_ROLE_KEY:'local-test-signing-key'},mocks:{'@/lib/households':{getLatestHouseholdIdForUser:async()=> 'other-family'}}}).load('src/lib/account-link.ts');
  const intent={user:'source-user',household:'source-family',method:'email',contact:'parent@example.test',expires:Date.now()+60000};
  const user={id:'other-user',email:'parent@example.test',email_confirmed_at:'2026-01-01'};
  return {api,db,writes,intent,user};
}
test('link intents are signed, expire, and reject tampering before any family access',()=>{
  const h=setup();const token=h.api.signAccountLink(h.intent);
  assert.equal(h.api.readAccountLink(token).user,'source-user');
  assert.equal(h.api.readAccountLink(token+'x'),null);
  assert.equal(h.api.readAccountLink(h.api.signAccountLink({...h.intent,expires:Date.now()-1})),null);
  assert.equal(h.api.readAccountLink(h.api.signAccountLink({...h.intent,expires:Date.now()+3600000})),null);
});
test('both verified login identities open the existing populated family without deleting history',async()=>{
  for(const populated of [['source-family'],['other-family'],[]]){
    const h=setup({populated});const id=await h.api.linkVerifiedFamilyLogins(h.db,h.user,h.intent);
    assert.equal(id,populated[0]||'other-family');
    assert.equal(h.writes.length,3);const members=h.writes.filter(w=>w.table==='household_members');assert(members.every(w=>w.row.household_id===id));
    assert.deepEqual(members.map(w=>w.row.user_id),['source-user','other-user']);
    assert.equal(h.writes[2].table,'staff_family_search_aliases');assert.equal(h.writes[2].row.canonical_household_id,id);
  }
});
test('contact-only matches, wrong verified identities, same-user replay, lost caregiver access and populated conflicts cannot link',async()=>{
  for(const options of [{user:{email_confirmed_at:null}},{user:{email:'attacker@example.test'}},{user:{id:'source-user'}},{sourceRole:'member'},{otherRole:'member'},{populated:['source-family','other-family']}]){
    const h=setup(options);
    await assert.rejects(h.api.linkVerifiedFamilyLogins(h.db,{...h.user,...options.user},h.intent));
    assert.equal(h.writes.length,0);
  }
});
test('phone linking requires verified phone ownership, independently of email and profile fields',async()=>{
  const h=setup();const intent={...h.intent,method:'phone',contact:'18605550123'};
  await assert.rejects(h.api.linkVerifiedFamilyLogins(h.db,{id:'other-user',phone:'18605550123'},intent));
  assert.equal(h.writes.length,0);
  assert.equal(await h.api.linkVerifiedFamilyLogins(h.db,{id:'other-user',phone:'+18605550123',phone_confirmed_at:'2026-01-01'},intent),'source-family');
});
