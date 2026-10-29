import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paymentPageHarness} from './helpers/payment-page-harness.mjs';
const people=[{id:'child',first_name:'Sam',role:'child'},{id:'adult',first_name:'Parent',role:'adult'}];
test('online admission shows a reviewed server quote before creating checkout and sends only selected family IDs',async()=>{
 const requests=[];
 const page=await paymentPageHarness('src/app/landing/admission/page.tsx',{fetch:async(url,o)=>{
  requests.push(o?.body&&JSON.parse(o.body));return Response.json(!o?{enabled:true,people,passes:[],current:null}:JSON.parse(o.body).mode==='quote'?{amount_cents:1600}:{payment_url:'https://square.link/u/verified'});
 }});
 for(let i=0;i<2;i++){page.nodes().filter(n=>n?.type==='input'&&n.props.type==='checkbox')[i].props.onChange({target:{checked:true}});await page.flush();}
 page.find(n=>n.type==='button'&&n.props.children==='Check admission price').props.onClick();await page.flush();assert.match(page.text(),/Pay \$\s*16.00\s*with Square/);
 page.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='Pay $').props.onClick();await page.flush();
 assert.equal(page.redirected,'https://square.link/u/verified');const body=requests.filter(Boolean).at(-1);assert.deepEqual(body.person_ids.sort(),['adult','child']);assert.equal(body.quoted_amount_cents,1600);
});
test('an admission return keeps payment pending unless the server verifies it',async()=>{
 const page=await paymentPageHarness('src/app/landing/admission/page.tsx',{search:'?checkout_id=attempt&paid=true',fetch:async(_url,o)=>Response.json(o?{status:'pending'}:{enabled:true,people,passes:[],current:null})});
 assert.match(page.text(),/Verifying your payment/);assert.ok(!page.text().includes('Payment verified.'));
});
test('membership displays the actual family recurring price and submits that reviewed amount',async()=>{
 let body;const page=await paymentPageHarness('src/components/membership/StartSubscriptionButton.tsx',{fetch:async(_url,o)=>{if(o)body=JSON.parse(o.body);return Response.json(o?{url:'https://square.link/u/member'}:{amount_cents:8000,children:[{id:'one',first_name:'Sam'},{id:'two',first_name:'Jo'}]});}});
 assert.match(page.text(),/80.00/);assert.match(page.text(),/per month/);page.find(n=>n.type==='button').props.onClick();await page.flush();assert.equal(body.quoted_amount_cents,8000);assert.equal(page.redirected,'https://square.link/u/member');
});
