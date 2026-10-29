import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {loadSquareModules} from './square-harness.mjs';
export async function paymentPageHarness(file,{fetch,search='',states:initial=[]}={}){
 const states=[...initial],effects=[],hooks=[];let cursor=0,tree,redirected;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>v===b[i]);
 const react={...React,useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
 useEffect(fn,deps){const i=cursor++;if(!same(hooks[i],deps)){hooks[i]=deps;effects.push(fn);}},
 useCallback(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={deps,fn};return hooks[i].fn;}};
 const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{exports,require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return jsx;if(name==='next/link')return {default:props=>React.createElement('a',{...props,href:props.href},props.children),__esModule:true};if(name==='@/lib/party-config')return loadSquareModules().load('src/lib/party-config.ts');throw new Error(name);},fetch,URLSearchParams,Date,Intl,window:{location:{search,pathname:'/landing/admission',assign:url=>{redirected=url;}},history:{replaceState(){}},confirm:()=>true},setTimeout:()=>0,clearTimeout(){}});
 function render(){cursor=0;tree=exports.default({enabled:true});}
 async function flush(){for(let i=0;i<8;i++){render();for(const effect of effects.splice(0))effect();await new Promise(r=>setImmediate(r));}render();}
 function nodes(node){if(node==null||typeof node==='boolean')return [];if(Array.isArray(node))return node.flatMap(x=>nodes(x));if(typeof node==='object')return [node,...nodes(node.props?.children)];return [node];}
 function text(node=tree){return nodes(node).filter(n=>typeof n==='string'||typeof n==='number').join(' ');}
 render();await flush();return {flush,text,nodes:()=>nodes(tree),find(predicate){return nodes(tree).find(n=>n&&typeof n==='object'&&predicate(n));},get tree(){return tree;},get redirected(){return redirected;}};
}
