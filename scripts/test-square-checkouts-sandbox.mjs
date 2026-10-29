import fs from 'node:fs';
import crypto from 'node:crypto';
import nextEnv from '@next/env';
import { squareTestDatabase,localSquareAdmin,loadSquareModules,ids } from '../tests/helpers/square-harness.mjs';
nextEnv.loadEnvConfig(process.cwd());
if((process.env.SQUARE_ENVIRONMENT??process.env.SQUARE_ENV??'sandbox').toLowerCase()!=='sandbox')throw new Error('Sandbox only');
const db=await squareTestDatabase(),admin=localSquareAdmin(db);
const runtime=loadSquareModules({env:{...process.env,SQUARE_ENVIRONMENT:'sandbox',CLASS_PAYMENTS_ENABLED:'true',MEMBERSHIP_PAYMENTS_ENABLED:'true'},
  fetch:async(url,options)=>{const response=await fetch(url,options);if(!response.ok)console.error(JSON.stringify({path:new URL(url).pathname,errors:(await response.clone().json()).errors}));return response;}});
const client=runtime.load('src/lib/square-client.ts'),checkout=runtime.load('src/lib/square-checkout.ts');
let classCheckout,membership,classAttempt;
const inputReport='/tmp/little-wanderers-square-checkouts.json';
const output=process.argv.includes('--class-only')?'/tmp/little-wanderers-square-class.json':inputReport;
if(process.argv.includes('--verify-existing')){
  const saved=JSON.parse(fs.readFileSync(inputReport,'utf8'));
  const {payment_links:links}=await client.squareRequest('/v2/online-checkout/payment-links?limit=100');
  for(const kind of ['class','membership']){
    const url=kind==='class'?saved.class_url:saved.membership_url;
    const link=links.find(l=>l.url===url);if(!link)throw new Error('Saved Sandbox link not found');
    const request=kind==='class'?{person_id:ids.person,items:[{class_id:ids.klass,quantity:1}]}:{plan_variation_id:saved.plan_variation_id};
    const prepared=await admin.rpc('prepare_square_checkout',{p_household:ids.household,p_kind:kind,p_environment:'sandbox',p_location:process.env.SQUARE_LOCATION_ID,p_user:ids.user,p_role:'customer',p_request:request});
    if(prepared.error)throw new Error(prepared.error.message);
    const id=kind==='class'?saved.class_checkout_id:saved.membership_checkout_id;
    const updated=await admin.from('square_checkout_attempts').update({id,order_id:link.order_id,payment_link_id:link.id,payment_url:link.url,status:'open',created_at:link.created_at}).eq('id',prepared.data.id).select('*').single();
    if(updated.error)throw new Error(updated.error.message);
    if(kind==='class'){classCheckout={id,url};classAttempt=updated.data;}else membership={id,url};
  }
  runtime.env.SQUARE_PLAN_VARIATION_ID=saved.plan_variation_id;
}else{
  classCheckout=await checkout.startSquareCheckout(admin,{householdId:ids.household,userId:ids.user,role:'customer',kind:'class',
    personId:ids.person,items:[{class_id:ids.klass,quantity:1}],returnPath:'/landing/classschedule?checkout=success'});
  classAttempt=(await admin.from('square_checkout_attempts').select('*').eq('id',classCheckout.id).single()).data;
  const catalog=await client.squareRequest('/v2/catalog/batch-upsert','POST',{idempotency_key:crypto.randomUUID(),batches:[{objects:[
    {type:'SUBSCRIPTION_PLAN',id:'#lw-test-plan',subscription_plan_data:{name:'Little Wanderers Sandbox Test Plan'}},
    {type:'SUBSCRIPTION_PLAN_VARIATION',id:'#lw-test-monthly',subscription_plan_variation_data:{name:'Sandbox $60 monthly',subscription_plan_id:'#lw-test-plan',
      phases:[{ordinal:0,cadence:'MONTHLY',pricing:{type:'STATIC',price_money:{amount:6000,currency:'USD'}}}]}},
  ]}]});
  runtime.env.SQUARE_PLAN_VARIATION_ID=catalog.id_mappings.find(m=>m.client_object_id==='#lw-test-monthly').object_id;
  membership=await checkout.startSquareCheckout(admin,{householdId:ids.household,userId:ids.user,role:'customer',kind:'membership',returnPath:'/landing/membership?success=1'});
}
const report={environment:'sandbox',database:'isolated in-memory PostgreSQL',class_checkout_id:classCheckout.id,class_url:classCheckout.url,
  membership_checkout_id:membership.id,membership_url:membership.url,plan_variation_id:runtime.env.SQUARE_PLAN_VARIATION_ID,checks:[]};
fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({report:output,class_url:classCheckout.url,membership_url:membership.url}));
if(process.argv.includes('--class-only')){
  const result=await checkout.reconcileCheckout(admin,classAttempt);
  report.checks.push({name:'class hosted checkout, verified receipt and PostgreSQL fulfillment',passed:result.status==='completed'});
  fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await db.close();process.exit(0);
}
if(process.argv.includes('--subscription-api')){
  const existing=process.argv.find(arg=>arg.startsWith('--subscription-id='))?.split('=')[1];
  let created;
  if(existing)created=await client.squareRequest(`/v2/subscriptions/${encodeURIComponent(existing)}`);
  else {
  const customer=await client.squareRequest('/v2/customers','POST',{idempotency_key:crypto.randomUUID(),given_name:'Sandbox',family_name:'Subscription Test',email_address:'test@example.com'});
  const card=await client.squareRequest('/v2/cards','POST',{idempotency_key:crypto.randomUUID(),source_id:'cnon:card-nonce-ok',card:{customer_id:customer.customer.id,cardholder_name:'Sandbox Test'}});
  created=await client.squareRequest('/v2/subscriptions','POST',{idempotency_key:crypto.randomUUID(),location_id:process.env.SQUARE_LOCATION_ID,
    plan_variation_id:runtime.env.SQUARE_PLAN_VARIATION_ID,customer_id:customer.customer.id,card_id:card.card.id});
  }
  report.subscription_id=created.subscription.id;
  fs.writeFileSync(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({subscription_id:created.subscription.id,subscription_status:created.subscription.status,invoice_count:created.subscription.invoice_ids?.length??0}));
  await admin.from('square_checkout_attempts').update({square_subscription_id:report.subscription_id}).eq('id',membership.id);
  for(let i=0;i<12;i++){
    const attempt=(await admin.from('square_checkout_attempts').select('*').eq('id',membership.id).single()).data;
    await checkout.reconcileMembership(admin,attempt);
    const rows=(await db.query('select renews_at from memberships')).rows;
    if(rows.length&&new Date(rows[0].renews_at).getTime()>Date.now())break;
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
  const paid=(await db.query('select renews_at from memberships')).rows;
  report.checks.push({name:'subscription API paid invoice fulfillment',passed:paid.length===1&&new Date(paid[0].renews_at).getTime()>Date.now()});
  for(const action of ['pause','resume','cancel']){try{report.checks.push({name:`subscription API ${action}`,response:await checkout.changeSquareMembership(admin,ids.household,action)});}catch(error){report.checks.push({name:`subscription API ${action}`,passed:false,error:error.message});}}
  fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await db.close();process.exit(0);
}
let classDone=false,memberDone=false;
for(let i=0;i<180;i++){
  if(!classDone){
    try{const result=await checkout.reconcileCheckout(admin,classAttempt);if(result.status==='completed'){classDone=true;report.checks.push({name:'class hosted checkout and fulfillment',passed:true});console.log(JSON.stringify({class_paid:result}));}}
    catch(error){if(i%6===0)console.log(JSON.stringify({class_pending:error.message}));}
  }
  if(memberDone&&classDone)break;
  if(memberDone){await new Promise(resolve=>setTimeout(resolve,5000));continue;}
  const attempt=(await admin.from('square_checkout_attempts').select('*').eq('id',membership.id).single()).data;
  try{
    const result=await checkout.reconcileCheckout(admin,attempt);
    if(result.status==='completed'){
      const before=(await db.query('select square_status,renews_at from memberships')).rows;
      const afterPause=await checkout.changeSquareMembership(admin,ids.household,'pause');
      report.checks.push({name:'subscription checkout and paid membership',passed:before.length===1&&new Date(before[0].renews_at).getTime()>Date.now()});
      report.checks.push({name:'pause calls Square',response:afterPause});
      // A scheduled pause can require deleting the scheduled action rather than ResumeSubscription.
      const attempt2=(await admin.from('square_checkout_attempts').select('*').eq('id',membership.id).single()).data;
      report.subscription_id=attempt2.square_subscription_id;
      try{report.checks.push({name:'resume calls Square',response:await checkout.changeSquareMembership(admin,ids.household,'resume')});}
      catch(error){report.checks.push({name:'resume rejected',message:error.message});}
      report.checks.push({name:'cancel calls Square',response:await checkout.changeSquareMembership(admin,ids.household,'cancel')});
      memberDone=true;console.log(JSON.stringify(report));fs.writeFileSync(output,JSON.stringify(report,null,2));
    }
  }catch(error){
    if(classDone&&error.message==='Waiting for Square subscription customer mapping'){
      report.checks.push({name:'subscription hosted checkout end to end',passed:false,limitation:'Sandbox Checkout panel omitted customer/subscription mapping; access was not granted'});break;
    }
    if(i%6===0){
    console.log(JSON.stringify({membership_pending:error.message}));
    if(i===0){const evidence=await checkout.verifyCheckoutOrder(attempt);console.log(JSON.stringify({order_state:evidence.order.state,order_customer:evidence.order.customer_id,
      recipient_fields:evidence.order.fulfillments?.map(f=>Object.keys(f.digital_details?.recipient??f.pickup_details?.recipient??{})),
      payment_customers:evidence.payments.map(p=>p.customer_id??null)}));}
  }}
  await new Promise(resolve=>setTimeout(resolve,5000));
}
fs.writeFileSync(output,JSON.stringify(report,null,2));await db.close();
