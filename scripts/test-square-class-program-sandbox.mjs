import fs from 'node:fs';
import crypto from 'node:crypto';
import nextEnv from '@next/env';
import {squareTestDatabase,localSquareAdmin,loadSquareModules,ids} from '../tests/helpers/square-harness.mjs';

nextEnv.loadEnvConfig(process.cwd());
if((process.env.SQUARE_ENVIRONMENT??process.env.SQUARE_ENV??'sandbox').toLowerCase()!=='sandbox')throw new Error('Sandbox only');
const db=await squareTestDatabase(),admin=localSquareAdmin(db);
const runtime=loadSquareModules({env:{...process.env,SQUARE_ENVIRONMENT:'sandbox',CLASS_PAYMENTS_ENABLED:'true'}});
const client=runtime.load('src/lib/square-client.ts'),checkout=runtime.load('src/lib/square-checkout.ts');
const sessions=[ids.klass,...Array.from({length:4},()=>crypto.randomUUID())];
const output='/tmp/little-wanderers-square-class-program.json';
try{
  const original=await client.squareRequest('/v2/catalog/object','POST',{idempotency_key:crypto.randomUUID(),object:{
    type:'ITEM',id:'#sandbox-art-class',item_data:{name:'Sandbox Art Program',variations:[{type:'ITEM_VARIATION',id:'#sandbox-single-session',
      item_variation_data:{name:'Single session',pricing_type:'FIXED_PRICING',price_money:{amount:3000,currency:'USD'}}}]},
  }});
  const itemId=original.catalog_object.id;
  const program=await client.squareRequest('/v2/catalog/object','POST',{idempotency_key:crypto.randomUUID(),object:{
    type:'ITEM_VARIATION',id:'#sandbox-program-package',present_at_all_locations:true,item_variation_data:{
      item_id:itemId,name:'Program package',pricing_type:'FIXED_PRICING',price_money:{amount:15000,currency:'USD'},track_inventory:false,
    },
  }});
  const variation=program.catalog_object.id;
  await db.query('update classes set price_cents=15000,capacity=7 where id=$1',[ids.klass]);
  for(const id of sessions.slice(1))await db.query(`insert into classes(id,title,status,price_cents,capacity) values($1,'Sandbox Art Program','scheduled',15000,7)`,[id]);
  for(const id of sessions)await db.query(`insert into square_catalog_mappings(environment,kind,entity_key,variation_id,program_key)
    values('sandbox','class',$1,$2,'sandbox-art-five-sessions')`,[id,variation]);
  const previous=crypto.randomUUID();
  await db.query(`insert into class_registrations(id,class_id,person_id,household_id,status) values($1,$2,$3,$4,'preregistered')`,[previous,ids.klass,ids.person,ids.household]);
  const started=await checkout.startSquareCheckout(admin,{householdId:ids.household,userId:ids.user,role:'customer',kind:'class',
    personId:ids.person,items:[{class_id:ids.klass,quantity:1}],returnPath:'/landing/classschedule?checkout=success'});
  const attempt=(await admin.from('square_checkout_attempts').select('*').eq('id',started.id).single()).data;
  if(attempt.expected_amount_cents!==15000||attempt.payload.assignments.length!==5)throw new Error('Invalid program checkout');
  const report={environment:'sandbox',database:'isolated in-memory PostgreSQL',url:started.url,checkout_id:started.id,
    variation_id:variation,expected_amount_cents:15000,session_count:5,checks:[]};
  fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({report:output,url:started.url}));
  for(let tries=0;tries<180;tries++){
    const result=await checkout.reconcileCheckout(admin,attempt);
    if(result.status==='completed'){
      const registrations=(await db.query('select id,status from class_registrations')).rows;
      report.checks.push({name:'one $150 Square payment confirms five program occurrences',passed:registrations.length===5&&registrations.every(r=>r.status==='scheduled')});
      report.checks.push({name:'existing pre-registration ID is preserved',passed:registrations.some(r=>r.id===previous)});
      report.checks.push({name:'duplicate reconciliation does not add registrations',passed:(await checkout.reconcileCheckout(admin,attempt)).status==='completed'&&(await db.query('select count(*)::integer n from class_registrations')).rows[0].n===5});
      fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));break;
    }
    if(tries===179)throw new Error('Sandbox payment was not completed within 15 minutes');
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
}finally{await db.close();}
