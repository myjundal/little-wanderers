// Render the actual customer components with isolated fake family data. No Supabase or provider calls.
import fs from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {paymentPageHarness} from '../tests/helpers/payment-page-harness.mjs';
const people=[{id:'child',first_name:'Sam',role:'child'},{id:'adult',first_name:'Parent',role:'adult'}];
const page=await paymentPageHarness('src/app/landing/admission/page.tsx',{fetch:async(_u,o)=>Response.json(o?{amount_cents:1600}:{enabled:true,people,passes:[],current:null})});
for(let i=0;i<2;i++){page.nodes().filter(n=>n?.type==='input'&&n.props.type==='checkbox')[i].props.onChange({target:{checked:true}});await page.flush();}
page.find(n=>n.type==='button'&&n.props.children==='Check admission price').props.onClick();await page.flush();
const member=await paymentPageHarness('src/components/membership/StartSubscriptionButton.tsx',{fetch:async()=>Response.json({amount_cents:8000,children:[{id:'one',first_name:'Sam'},{id:'two',first_name:'Jo'}]})});
fs.mkdirSync('/tmp/lw-admission-preview',{recursive:true});
const css='body{font-family:Arial,sans-serif;background:#fbf7ff;color:#4b4360;margin:0;line-height:1.6}main{background:#fffdf9;border:1px solid #e8dfef;border-radius:24px;margin:20px auto!important}h1,h2{color:#7b6aa8}input,button{font:inherit}button{padding:10px 14px;border:1px solid #d9c8f7;border-radius:12px;background:#7b6aa8;color:white}input[type=date]{padding:8px;border:1px solid #d9c8f7;border-radius:10px}a{color:#654485}fieldset{border:1px solid #d9c8f7;border-radius:12px}.demo{margin:14px auto;max-width:720px;background:#eee4fa;padding:10px 18px;border-radius:12px}';
fs.writeFileSync('/tmp/lw-admission-preview/index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><title>Admission payment preview</title><style>${css}</style><p class="demo">Payment preview • isolated test family • no real charge</p>${renderToStaticMarkup(page.tree)}<main style="max-width:720px;padding:24px"><h2>Membership example: two children</h2>${renderToStaticMarkup(member.tree)}</main></html>`);
console.log('Rendered actual admission and membership components with isolated fake data.');
