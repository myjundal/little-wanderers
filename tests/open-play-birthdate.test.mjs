import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadSquareModules, ids } from './helpers/admission-pos-harness.mjs';
import { loadModule } from './helpers/class-preregistration-harness.mjs';
import { memoryAdmin } from './helpers/family-memory-admin.mjs';
const birthdates = loadSquareModules().load('src/lib/open-play-birthdate.ts');
const formatting = loadModule('src/lib/birthdate.ts');
const policy = loadModule('src/lib/open-play-reservations.ts');

test('actual birthdays reject future/invalid dates using the Eastern check-in day and accept both US year formats', () => {
  const now = new Date('2026-11-20T02:00Z');
  for (const value of ['2026-11-20', '11/26/26', '02/30/24', '2 years', null, 2]) assert.equal(birthdates.parseOpenPlayBirthdate(value, now), null, String(value));
  for (const value of ['2024-11-26', '11/26/24', '11/26/2024']) assert.equal(birthdates.parseOpenPlayBirthdate(value, now), '2024-11-26');
  assert.equal(birthdates.parseOpenPlayBirthdate('2026-11-19', now), '2026-11-19');
});

function familyHarness(children = []) {
  const tables = { people: children.map(c => ({ household_id: ids.household, role: 'child', ...c })), founding_memberships: [], waivers: [{ id: 'signed', agreement_snapshot: { original: true } }] };
  const admin = memoryAdmin(tables);
  const guardianWrites = [];
  const modules = loadSquareModules({ mocks: {
    '@/lib/family-profile': { getPrimaryGuardianProfile: async () => ({first_name:'Parent',last_name:'Family'}), ensureGuardianProfile: async input => guardianWrites.push(input) },
    '@/lib/complimentary-membership': { readComplimentaryMembership: async () => null },
  } });
  const lib = modules.load('src/lib/soft-opening-family.ts');
  return { tables, admin, guardianWrites, read: () => lib.readSoftOpeningFamily(admin, ids.household), save: children => lib.saveSoftOpeningFamily(admin, ids.household, {id:ids.user,email:'parent@example.test'}, { children }) };
}
const estimated = { id: ids.person, first_name:'Taylor', last_name:null, birthdate:'2024-11-19', notes:'Approximate age 2 years entered for Open Play. Update birthday in My Info/People.' };

test('legacy estimates, unknown and future birthdays require confirmation, while private notes never reach the client', async () => {
  const h = familyHarness([estimated, {id:'known',birthdate:'2024-02-14',notes:'Private staff note'}, {id:'missing',birthdate:null}, {id:'future',birthdate:'2999-11-26'}, {id:'owner-estimate',birthdate:'2024-11-26',notes:'2026-11-19 owner-authorized estimated DOB: 2024-11-26.'}]);
  const family = await h.read();
  assert.deepEqual(Array.from(family.children, c=>c.birthdate_needs_confirmation), [true,false,true,true,true]);
  assert.ok(family.children.every(c=>!('notes' in c)));
  assert.equal(h.admin.writes.length, 0);
});

test('age-only, invalid and foreign-child submissions fail before any family write, including an invalid second child', async () => {
  for (const input of [[{name:'New Child',age:2,age_unit:'years'}], [{id:ids.person,name:'Taylor'}], [{id:ids.person,name:'Taylor',birthdate:'2999-11-26'}], [{id:ids.person,birthdate:'2024-02-14'}, {name:'Sibling',birthdate:'02/30/24'}], [{id:ids.otherPerson,birthdate:'2024-02-14'}]]) {
    const h = familyHarness([estimated]);
    await assert.rejects(h.save(input));
    assert.equal(h.guardianWrites.length, 0); assert.equal(h.admin.writes.length, 0);
  }
});

test('caregiver confirmation replaces only the selected estimate, audits the old value and preserves signed evidence', async () => {
  const other = {...estimated,id:ids.otherPerson,first_name:'Casey',birthdate:'2026-02-19'};
  const h = familyHarness([estimated,other]);
  const original = structuredClone(h.tables.waivers);
  const saved = await h.save([{id:ids.person,name:'Taylor Example',birthdate:'02/14/24'}]);
  assert.equal(saved.children[0].birthdate,'2024-02-14');
  assert.equal(h.tables.people[0].id,ids.person);assert.equal(h.tables.people[0].birthdate,'2024-02-14');
  assert.match(h.tables.people[0].notes,/Birthday confirmed by signed-in caregiver/);
  assert.match(h.tables.people[0].notes,/Previous birthday: 2024-11-19/);
  assert.match(h.tables.people[0].notes,/Approximate age 2 years/);
  assert.equal(h.tables.people[1].birthdate,other.birthdate);
  assert.deepEqual(h.tables.waivers,original);
  assert.equal((await h.read()).children[0].birthdate_needs_confirmation,false);
  const notes=h.tables.people[0].notes;
  await h.save([{id:ids.person,name:'Taylor Example',birthdate:'2024-02-14'}]);
  assert.equal(h.tables.people[0].notes,notes);
  const match=loadSquareModules().load('src/lib/guest-family-reconciliation.ts').matchGuestFamily;
  assert.deepEqual(Array.from(match({first_name:'Parent',last_name:'Family',phone:'',children:[{first_name:'Taylor',last_name:'Example',birthdate:'2024-02-14'}]},'parent@example.test',{email:'parent@example.test'},[{role:'adult',first_name:'Parent',last_name:'Family'},h.tables.people[0]],['parent@example.test'])),[ids.person]);
});

test('new children use the submitted actual birthday, and existing confirmed birthdays remain usable without age estimates', async () => {
  const h = familyHarness();
  const saved = await h.save([{new_id:ids.person,name:'Taylor Example',birthdate:'02/14/2024'}]);
  assert.equal(saved.children[0].birthdate,'2024-02-14');
  assert.equal(h.tables.people[0].notes,undefined);
  await h.save([{id:ids.person,name:'Taylor Example'}]);
  assert.equal(h.tables.people.length,1);assert.equal(h.tables.people[0].birthdate,'2024-02-14');
});

function nodes(tree) { const all=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!React.isValidElement(n))return;all.push(n);walk(n.props.children);}walk(tree);return all; }
function componentHarness({ paymentStatus, estimatedBirthday = false } = {}) {
  const slot={id:'slot',starts_at:'2026-11-20T14:00Z',ends_at:'2026-11-20T15:00Z',remaining_children:6,capacity_children:6,is_closed:false,is_full:false};
  const data={ok:true,slots:[slot],reservations:[],family:{guardian:{first_name:'Parent',last_name:'Family'},memberships:[],children:[{id:ids.person,first_name:'Taylor',last_name:'Example',birthdate:'2024-02-14',birthdate_needs_confirmation:estimatedBirthday}]}};
  const state=[],effects=[],requests=[],navigations=[];let i=0,mounted=false;
  const Component=loadModule('src/components/soft-opening/SoftOpeningReservation.tsx',{
    react:{...React,useState(initial){const n=i++;if(!(n in state))state[n]=initial;return[state[n],value=>{state[n]=typeof value==='function'?value(state[n]):value;}];},useCallback:fn=>fn,useEffect:fn=>{if(!mounted)effects.push(fn);}},
    'next/link':'a','next/image':()=>null,'./soft-opening.module.css':{},'@/lib/birthdate':formatting,'@/lib/open-play-birthdate':birthdates,'@/lib/open-play-reservations':policy,'@/lib/soft-opening-pricing':{softOpeningAmount:()=>1600},
  },{React,Intl,crypto:{randomUUID:()=>ids.otherPerson},window:{location:{search:paymentStatus?'?payment=returned&reservation=reserved':'',assign:value=>navigations.push(value)}},fetch:async(url,options)=>{requests.push({url,options});if(url.includes('/payment'))return Response.json({ok:true,reservation:{payment_status:paymentStatus}});return Response.json(data);}}).default;
  return {state,requests,navigations,render(){i=0;const tree=Component({publicBooking:true});mounted=true;effects.splice(0).forEach(fn=>fn());return tree;}};
}

test('booking shows and submits real birthdays; legacy estimates are blank and block submission until corrected', async () => {
  for(const estimatedBirthday of [true,false]) {
    const h=componentHarness({estimatedBirthday});h.render();await new Promise(setImmediate);
    let tree=h.render();const birthday=nodes(tree).find(n=>n.type==='input'&&n.props.inputMode==='numeric');
    assert.equal(birthday.props.value,estimatedBirthday?'':'02/14/2024');
    assert.doesNotMatch(renderToStaticMarkup(tree),/Age on file|Age unit/);
    nodes(tree).find(n=>n.type==='button'&&n.key==='slot').props.onClick();tree=h.render();
    assert.equal(nodes(tree).find(n=>n.type==='button'&&n.props.type==='submit').props.disabled,estimatedBirthday);
    if(estimatedBirthday){await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(h.requests.filter(r=>r.options?.method==='POST').length,0);birthday.props.onChange({target:{value:'02/14/24'}});tree=h.render();}
    assert.equal(nodes(tree).find(n=>n.type==='button'&&n.props.type==='submit').props.disabled,false);
    // Capture the canonical request before the fixture refuses to save a real reservation.
    await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
    const sent=JSON.parse(h.requests.find(r=>r.options?.method==='POST').options.body);
    assert.equal(sent.children[0].birthdate,'2024-02-14');assert.equal(sent.children[0].age,undefined);
  }
});

test('Square return continues only after verified payment; pending confirmation never becomes waiver success', async () => {
  for(const paymentStatus of ['due','paid','covered']) {
    const h=componentHarness({paymentStatus});h.render();await new Promise(setImmediate);
    if(paymentStatus==='due'){assert.equal(h.navigations.length,0);assert.match(h.state[2],/payment confirmation is still pending/);assert.match(h.state[2],/Do not pay again/);}
    else assert.deepEqual(h.navigations,['/landing/waiver?reservation=reserved']);
  }
});
