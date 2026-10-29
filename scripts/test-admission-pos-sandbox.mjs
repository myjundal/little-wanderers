// Explicit provider smoke test: fake Sandbox card and isolated local PostgreSQL only.
import env from '@next/env';
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {loadSquareModules,localSquareAdmin,ids} from '../tests/helpers/admission-pos-harness.mjs';
env.loadEnvConfig(process.cwd(),false,{info(){},error(){}});
if(process.env.SQUARE_ENVIRONMENT!=='sandbox'||process.env.SQUARE_ENV&&process.env.SQUARE_ENV!=='sandbox')throw Error('Sandbox environment required');
if(!process.env.SQUARE_ACCESS_TOKEN||!process.env.SQUARE_LOCATION_ID)throw Error('Sandbox credentials required');
const config={SQUARE_ENVIRONMENT:'sandbox',SQUARE_ACCESS_TOKEN:process.env.SQUARE_ACCESS_TOKEN,SQUARE_LOCATION_ID:process.env.SQUARE_LOCATION_ID,SQUARE_API_VERSION:process.env.SQUARE_API_VERSION||'2026-07-15',ADMISSION_POS_PAYMENTS_ENABLED:'true',SQUARE_APPLICATION_ID:'sandbox-test-app'};
const {squareRequest}=loadSquareModules({env:config}).load('src/lib/square-client.ts');
const pos=loadSquareModules({env:config}).load('src/lib/square-admission-pos.ts');
const db=new PGlite();
try {
 await db.exec(fs.readFileSync('tests/fixtures/admission-pos-schema.sql','utf8'));
 await db.exec(fs.readFileSync('db/migrations/20261029_qr_admission_pos_family.sql','utf8'));
 const one=crypto.randomUUID(),two=crypto.randomUUID();
 await db.query('insert into households values($1,$2)',[ids.household,'Sandbox Test Family']);
 await db.query("insert into people values($1,$2,'First','Sandbox'),($3,$2,'Sibling','Sandbox')",[one,ids.household,two]);
 await db.query("insert into checkins(id,person_id,price_cents,payment_status) values($1,$1,1600,'due'),($2,$2,1000,'due')",[one,two]);
 const admin=localSquareAdmin(db);
 const launch=await pos.startAdmissionPos(admin,[one,two],ids.user);
 const sale=(await db.query('select * from admission_pos_sales where id=$1',[launch.id])).rows[0];
 const {order}=await squareRequest('/v2/orders','POST',{idempotency_key:crypto.randomUUID(),order:{location_id:config.SQUARE_LOCATION_ID,reference_id:sale.id,line_items:[{name:'Sandbox family admission',quantity:'1',base_price_money:{amount:2600,currency:'USD'},note:`LW admission ${sale.id}`} ]}});
 const {payment}=await squareRequest('/v2/payments','POST',{idempotency_key:crypto.randomUUID(),source_id:'cnon:card-nonce-ok',amount_money:{amount:2600,currency:'USD'},order_id:order.id,location_id:config.SQUARE_LOCATION_ID,note:`LW admission ${sale.id}`,autocomplete:true,...(process.argv.includes('--tip')?{tip_money:{amount:200,currency:'USD'}}:{})});
 assert.equal(payment.status,'COMPLETED');
 await pos.verifyAdmissionPos(admin,sale,order.id);
 await pos.verifyAdmissionPos(admin,sale,order.id);
 assert.equal((await db.query("select count(*)::integer n from checkins where payment_status='paid'")).rows[0].n,2);
 const report={environment:'sandbox',amount_cents:2600,tip_cents:payment.tip_money?.amount??0,order_id:order.id,payment_id:payment.id,provider_status:payment.status,local_paid_checkins:2,repeated_verification:'idempotent',production_database_used:false,real_charge:false,hardware_tested:false};
 fs.writeFileSync('/tmp/lw-qr-pos-sandbox.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await db.close();}
