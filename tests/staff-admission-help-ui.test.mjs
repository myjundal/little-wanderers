import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const family={id:'family-a',name:'Example Family',people:[{id:'child-a',role:'child',first_name:'Addison',last_name:'Example',birthdate:'2021-04-01'},{id:'child-b',role:'child',first_name:'Elliot',last_name:'Example',birthdate:'2024-08-30'}]};
const text=node=>node==null||typeof node==='boolean'?'':typeof node!=='object'?String(node):(Array.isArray(node)?node:node.props?.children??[]).map?.(text).join('')??text(node.props?.children);
function nodes(node,filter){if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(v=>nodes(v,filter));return[...(filter(node)?[node]:[]),...nodes(node.props?.children,filter)];}
function harness(respond){
 const slots=[],effects=[],requests=[];let cursor=0,tree,changed=0,props={family,date:'2026-11-14',disabled:false,onUpdated:()=>changed++,onOpenFamily:()=>{}};
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;return slots[index]??=( {current:initial});},useEffect(fn,deps){const index=cursor++,prior=slots[index];if(!prior||deps.some((v,i)=>v!==prior[i])){slots[index]=deps;effects.push(fn);}}};
 const exports={};const source=ts.transpileModule(fs.readFileSync('src/components/staff/AdmissionHelp.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 vm.runInNewContext(source,{exports,module:{exports},require:name=>name==='react'?hooks:name.endsWith('.css')?{default:new Proxy({},{get:(_,key)=>key})}:require(name),fetch:async(url,options)=>{const body=options?.body?JSON.parse(options.body):null;requests.push(body??{mode:'list_cases'});return Response.json(await respond(body));},Date,Map,Set,console,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000099'}});
 const render=()=>{cursor=0;tree=exports.default(props);effects.splice(0).forEach(fn=>fn());return tree;};
 render();
 return{requests,render,setFamily(value){props={...props,family:value};render();render();},get tree(){return tree;},get changed(){return changed;},all(type){return nodes(tree,n=>n.type===type);},button(label,tab=false){const found=nodes(tree,n=>n.type==='button'&&text(n)===label&&(tab?n.props['aria-pressed']!==undefined:n.props['aria-pressed']===undefined));assert.equal(found.length,1,`Find button: ${label}`);return found[0];},async flush(){await new Promise(resolve=>setTimeout(resolve,0));render();await new Promise(resolve=>setTimeout(resolve,0));render();}};
}
const receipt={order_id:'order-one',admission_cents:2600,total_cents:2900,paid_at:'2026-11-14T15:00:00Z',receipt_number:'ABCD',card_last_four:'1234',items:'Admission, Coffee'};

test('staff receipt selection requires confirmation, sends one connection on rapid clicks and reports paid without launching another charge',async()=>{
 const h=harness(async body=>!body?{ok:true,cases:[]} : body.mode==='search_receipts'?{ok:true,receipts:[receipt]}:{ok:true,status:'paid'});await h.flush();
 h.all('input')[0].props.onChange({target:{value:'1234'}});h.render();await h.button('Find completed receipt').props.onClick();await h.flush();
 h.all('input').find(n=>n.props.type==='radio').props.onChange();h.render();assert.equal(h.button('Connect receipt — mark admission paid').props.disabled,true);
 h.all('input').find(n=>n.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();
 const connect=h.button('Connect receipt — mark admission paid');assert.equal(connect.props.disabled,false);connect.props.onClick();connect.props.onClick();await h.flush();
 const connections=h.requests.filter(r=>r.mode==='link_receipt');assert.equal(connections.length,1);assert.equal(connections[0].household_id,family.id);assert.equal(connections[0].order_id,'order-one');assert.equal(h.changed,1);
 assert.match(text(h.tree),/Receipt verified and linked/);assert.ok(!h.requests.some(r=>r.mode==='start'||r.checkin_ids));
});
test('staff must map a nickname to each child and confirm the birthday difference before connecting a waiver',async()=>{
 const signed={id:'waiver-one',guardian:'Parent Example',email:'parent@example.test',phone:'+18605551234',signed_at:'2026-11-14T15:00:00Z',children:[{id:'signed-a',first_name:'Addie',last_name:'Example',birthdate:'2022-10-20'},{id:'signed-b',first_name:'Elliot',last_name:'Example',birthdate:'2024-08-30'}]};
 const h=harness(async body=>!body?{ok:true,cases:[]}:body.mode==='search_waivers'?{ok:true,waivers:[signed]}:{ok:true,status:'linked'});await h.flush();
 h.button('Find signed waiver',true).props.onClick();h.render();h.all('input')[0].props.onChange({target:{value:'Parent Example'}});h.render();h.button('Find signed waiver').props.onClick();await h.flush();
 h.all('input').find(n=>n.props.type==='radio').props.onChange();h.render();assert.equal(h.button('Connect signed waiver').props.disabled,true);
 h.all('select')[0].props.onChange({target:{value:'child-a'}});h.render();assert.match(text(h.tree),/Birthdays differ/);
 h.all('textarea')[0].props.onChange({target:{value:'Guardian confirmed nickname and corrected family birthday.'}});h.render();h.all('input').find(n=>n.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();
 assert.equal(h.button('Connect signed waiver').props.disabled,false);h.button('Connect signed waiver').props.onClick();await h.flush();
 const saved=h.requests.find(r=>r.mode==='link_waiver');assert.deepEqual(saved.mapping,[{source_id:'signed-a',target_id:'child-a'},{source_id:'signed-b',target_id:'child-b'}]);assert.equal(saved.guardian_confirmed,true);assert.equal(h.changed,1);
});
test('a family switch discards an old receipt search and unresolved notes remain in the shared review list',async()=>{
 let finish;const h=harness(async body=>!body?{ok:true,cases:[{id:'case-one',household_id:'family-a',family_name:'Example Family',visit_date:'2026-11-13',category:'payment',note:'No receipt found yesterday',created_at:'2026-11-13T15:00:00Z'}]}:body.mode==='search_receipts'?await new Promise(resolve=>{finish=resolve;}):{ok:true});await h.flush();
 assert.match(text(h.tree),/No receipt found yesterday/);h.all('input')[0].props.onChange({target:{value:'1234'}});h.render();h.button('Find completed receipt').props.onClick();await h.flush();
 h.setFamily({...family,id:'family-b',name:'Other Family'});finish({ok:true,receipts:[receipt]});await h.flush();
 assert.equal(h.all('input').filter(n=>n.props.type==='radio').length,0);assert.match(text(h.tree),/Other Family/);assert.match(text(h.tree),/No receipt found yesterday/);
});
