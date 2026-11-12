import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadModule } from './helpers/class-preregistration-harness.mjs';
const booking={id:'party',start_time:'2099-11-16T20:00:00Z',end_time:'2099-11-16T23:00:00Z',is_private:false};
function harness({fail=false,conflicts=[]}={}) {
 const hooks=[],requests=[],events=[];let cursor=0,tree;const effects=[];
 const react={...React,
  useState(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:initial};return [hooks[index].value,value=>{hooks[index].value=typeof value==='function'?value(hooks[index].value):value;}];},
  useRef(initial){return hooks[cursor++]??={current:initial};},
  useEffect(fn,deps){const index=cursor++;if(!hooks[index]||deps.some((value,i)=>value!==hooks[index].deps[i])){hooks[index]={deps};effects.push(fn);}},
 };
 const Editor=loadModule('src/components/staff/PartyPrivacyEditor.tsx',{
  react,'next/link':'a','./party-schedule-editor.module.css':{},'@/lib/private-party-open-play':{PARTY_PRIVACY_UPDATED_EVENT:'party-privacy-updated'},
 },{React:react,AbortController,CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},window:{dispatchEvent:event=>events.push(event)},fetch:async(url,options)=>{requests.push({url,body:options.body?JSON.parse(options.body):null});return Response.json(fail?{ok:false,error:'Changed elsewhere. Refresh.'}:{ok:true,item:{...booking,is_private:true},conflicts,conflicts_available:true},{status:fail?409:200});}}).default;
 const render=()=>{cursor=0;tree=Editor({booking});effects.splice(0).forEach(fn=>fn());};
 const all=predicate=>{const found=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(predicate(node))found.push(node);visit(node.props.children);};visit(tree);return found;};
 render();return {requests,events,render,all,check:()=>all(node=>node.type==='input')[0].props.onChange({target:{checked:true}}),flush:async()=>{await new Promise(resolve=>setImmediate(resolve));render();}};
}

test('private checkbox saves once, keeps existing conflict families visible, and syncs party views',async()=>{
 const h=harness({conflicts:[{id:'r',household_id:'family',household_name:'Family',child_count:2,adult_count:1}]});
 h.check();h.check();await h.flush();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/admin/party-bookings/party/privacy');
 assert.deepEqual(h.requests[0].body,{is_private:true,expected_is_private:false,expected_start_time:booking.start_time});
 assert.equal(h.all(node=>node.type==='input')[0].props.checked,true);assert.equal(h.events.length,1);
 assert.equal(h.all(node=>node.type==='a')[0].props.href,'/staff/families/family');assert.ok(h.all(node=>node.props.role==='alert').length);
});

test('a failed save keeps the old checkbox and displays the actual error without dispatching a false update',async()=>{
 const h=harness({fail:true});h.check();await h.flush();assert.equal(h.all(node=>node.type==='input')[0].props.checked,false);
 assert.equal(h.events.length,0);assert.equal(h.all(node=>node.props.role==='alert')[0].props.children,'Changed elsewhere. Refresh.');assert.equal(h.all(node=>node.type==='input')[0].props.disabled,false);
});
