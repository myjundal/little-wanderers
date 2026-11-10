import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadModule} from './helpers/class-preregistration-harness.mjs';
const link=({children,...p})=>React.createElement('a',p,children);
const mocks={'next/link':link,'../public-info.module.css':{}};
test('public header leads to pricing, keeps invitation-only reservations unlisted, and retains account destinations',()=>{
 const {PastelHeader}=loadModule('src/components/pastel/PastelPrimitives.tsx',{'next/link':link,'next/image':()=>null,'./pastel.module.css':{},'./PublicMoreMenu':()=>null},{React});
 const guest=renderToStaticMarkup(PastelHeader({}));
 assert.match(guest,/href="\/pricing"/);assert.doesNotMatch(guest,/href="\/soft-opening"/);assert.match(guest,/>Sign in</);assert.doesNotMatch(guest,/Wanderlist families|Join\/Login|href="\/membership"/);
 const staff=renderToStaticMarkup(PastelHeader({isAuthenticated:true,dashboardHref:'/staff/dashboard',accessLabel:'Dashboard'}));assert.match(staff,/href="\/staff\/dashboard"/);
});
test('legacy membership URLs preserve a permanent destination to the new pricing section',()=>{
 let to;const route=loadModule('src/app/(public)/membership/page.tsx',{'next/navigation':{permanentRedirect:value=>{to=value;}}});route.default();assert.equal(to,'/pricing#memberships');
});
test('pricing links to real founding enrollment and gift card pages, with regular membership marked for after grand opening',()=>{
 const page=loadModule('src/app/(public)/pricing/page.tsx',mocks,{React});const html=renderToStaticMarkup(page.default());assert.match(html,/\$16/);assert.match(html,/\$10/);assert.match(html,/\$50/);assert.match(html,/\$60/);assert.match(html,/\+\$20\/month/);assert.match(html,/href="\/general-founding"/);assert.match(html,/Available after grand opening/);assert.match(html,/not a one-time payment/);assert.match(html,/href="\/gift-cards"/);
});
test('gift card purchase uses the exact supplied Square merchant link and a safe new tab',()=>{
 const page=loadModule('src/app/(public)/gift-cards/page.tsx',mocks,{React});const html=renderToStaticMarkup(page.default());assert.match(html,/https:\/\/app.squareup.com\/gift\/ML2Z4R0HJT14W\/order/);assert.match(html,/target="_blank"/);assert.match(html,/noopener noreferrer/);assert.match(html,/Myjundal LLC/);
});
