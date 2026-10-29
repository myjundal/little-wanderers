// Real provider delivery to a temporary, signed Sandbox-only callback. No Supabase or Production connection.
// Usage: node scripts/test-square-webhook-sandbox.mjs /absolute/path/to/cloudflared
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import nextEnv from '@next/env';
import {squareTestDatabase,localSquareAdmin,loadSquareModules,ids} from '../tests/helpers/square-harness.mjs';
nextEnv.loadEnvConfig(process.cwd());
if((process.env.SQUARE_ENVIRONMENT??process.env.SQUARE_ENV??'sandbox').toLowerCase()!=='sandbox')throw new Error('Sandbox only');
const binary=process.argv[2];if(!binary?.startsWith('/'))throw new Error('Supply the official cloudflared binary path');
const db=await squareTestDatabase(),admin=localSquareAdmin(db),deliveries=[];
const runtime=loadSquareModules({env:{...process.env,SQUARE_ENVIRONMENT:'sandbox',PARTY_PAYMENTS_ENABLED:'true',SQUARE_PARTY_ITEM_VARIATION_ID:'',SQUARE_SANDBOX_EMAIL_TO:''},mocks:{
  '@/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},'@/lib/party-emails':{sendPartyConfirmationEmail:async()=>({ok:true})},
}});
const client=runtime.load('src/lib/square-client.ts'),party=runtime.load('src/lib/square-party.ts');
let api,subscription,tunnel,booking,report;
let closing=false;
const tunnelEnvironment={PATH:process.env.PATH??'',TMPDIR:process.env.TMPDIR??'/tmp'};
for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','SSL_CERT_FILE','SSL_CERT_DIR']){
  if(process.env[name])tunnelEnvironment[name]=process.env[name];
}
const server=http.createServer(async(req,res)=>{
  if((req.url==='/health'||req.url==='/api/webhooks/square')&&['GET','HEAD'].includes(req.method)){res.writeHead(200);res.end('Isolated Sandbox callback');return;}
  if(req.url!=='/api/webhooks/square'||req.method!=='POST'){res.writeHead(404);res.end();return;}
  // Square checks reachability before returning the signature key. Registration probes never touch the DB.
  if(!api){res.writeHead(200);res.end('Registration probe');return;}
  try{
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>1_000_000)throw new Error('Body too large');chunks.push(chunk);}
    const body=Buffer.concat(chunks).toString('utf8');
    const response=await api.POST(new Request(runtime.env.SQUARE_WEBHOOK_URL,{method:'POST',body,headers:{
      'content-type':'application/json','x-square-hmacsha256-signature':req.headers['x-square-hmacsha256-signature']??'',
    }}));
    const event=JSON.parse(body);
    deliveries.push({event_id:event.event_id,type:event.type,http_status:response.status,at:new Date().toISOString()});
    console.log(JSON.stringify(deliveries.at(-1)));
    res.writeHead(response.status);res.end(await response.text());
  }catch{res.writeHead(500);res.end('Callback failed');}
});
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const config=`/tmp/lw-square-cloudflared-${process.pid}.yml`;fs.writeFileSync(config,'{}');
  tunnel=spawn(binary,['--config',config,'tunnel','--no-autoupdate','--protocol','http2','--url',`http://127.0.0.1:${server.address().port}`],{
    stdio:['ignore','pipe','pipe'],env:tunnelEnvironment,
  });
  const hostname=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Temporary tunnel did not start')),45_000);
    const read=chunk=>{
      const line=chunk.toString();if(!closing&&(line.includes(' ERR ')||line.includes('Registered tunnel connection')))console.log(line.trim());
      const match=line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(match){clearTimeout(timeout);resolve(match[0]);}
    };
    tunnel.stdout.on('data',read);tunnel.stderr.on('data',read);tunnel.once('error',reject);
  });
  runtime.env.SQUARE_WEBHOOK_URL=`${hostname}/api/webhooks/square`;
  let reachable=false;
  for(let i=0;i<10;i++){
    try{const response=await fetch(`${hostname}/health`,{signal:AbortSignal.timeout(4000)});if(response.ok){reachable=true;break;}if(i===0)console.log(JSON.stringify({callback_health_status:response.status}));}catch(error){if(i===0)console.log(JSON.stringify({callback_health_error:error.cause?.code??error.name}));}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  // Local DNS can reject temporary hostnames even when Square can reach the registered tunnel.
  // Square's subscription endpoint performs the definitive external reachability check.
  if(!reachable)console.log('Local callback health check unavailable; asking Square to validate reachability');
  const created=await client.squareRequest('/v2/webhooks/subscriptions','POST',{idempotency_key:crypto.randomUUID(),subscription:{
    name:'LW isolated Sandbox webhook verification',enabled:true,notification_url:runtime.env.SQUARE_WEBHOOK_URL,
    event_types:['invoice.created','invoice.published','invoice.updated','invoice.payment_made'],api_version:client.squareConfig().version,
  }});
  subscription=created.subscription;
  runtime.env.SQUARE_WEBHOOK_SIGNATURE_KEY=subscription.signature_key;
  api=runtime.load('src/app/api/webhooks/square/route.ts');
  const day=new Date();day.setUTCDate(day.getUTCDate()+60);const date=day.toISOString().slice(0,10);
  const result=await party.startPartyInvoice(admin,{householdId:ids.household,userId:ids.user,role:'customer',booking:{
    start_time:`${date}T15:00:00Z`,end_time:`${date}T18:00:00Z`,headcount_expected:10,birthday_child_name:'Sandbox Webhook Test',
  }});
  booking=result.booking;
  console.log(JSON.stringify({payment_url:result.url,callback:'temporary Sandbox only',invoice_id:booking.square_invoice_id}));
  report={environment:'sandbox',database:'isolated in-memory PostgreSQL',invoice_id:booking.square_invoice_id,deliveries};
  for(let i=0;i<120;i++){
    const saved=await admin.from('party_bookings').select('*').eq('id',booking.id).single();
    if(saved.error)throw new Error(saved.error.message);
    if(saved.data.status==='confirmed'&&saved.data.deposit_paid_cents===15000&&deliveries.some(d=>d.type==='invoice.payment_made'&&d.http_status===200)){
      report.deposit_confirmation_from_actual_webhook=true;report.booking_status=saved.data.status;break;
    }
    await new Promise(resolve=>setTimeout(resolve,2500));
  }
  report.logs=(await db.query('select event_id,processing_status from webhook_log')).rows;
  fs.writeFileSync('/tmp/little-wanderers-square-webhook.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({deposit_confirmation_from_actual_webhook:report.deposit_confirmation_from_actual_webhook??false,deliveries:deliveries.length,report:'/tmp/little-wanderers-square-webhook.json'}));
}finally{
  let cleanupFailed=false;
  try{
    if(subscription){await client.squareRequest(`/v2/webhooks/subscriptions/${encodeURIComponent(subscription.id)}`,'DELETE');console.log('Temporary Sandbox webhook subscription removed');}
    if(report)report.temporary_webhook_removed=true;
  }catch(error){cleanupFailed=true;console.error(JSON.stringify({cleanup_subscription_id:subscription?.id,error:error.message}));}
  try{
    if(booking){
      const {invoice}=await client.squareRequest(`/v2/invoices/${encodeURIComponent(booking.square_invoice_id)}`);
      if(['UNPAID','PARTIALLY_PAID'].includes(invoice.status)){
        await client.squareRequest(`/v2/invoices/${encodeURIComponent(invoice.id)}/cancel`,'POST',{version:invoice.version});
        if(report)report.sandbox_test_invoice_cancelled_after_verification=true;
      }
    }
  }catch(error){cleanupFailed=true;console.error(JSON.stringify({cleanup_invoice_id:booking?.square_invoice_id,error:error.message}));}
  finally{
    closing=true;tunnel?.kill('SIGTERM');server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));await db.close();
    if(report){report.temporary_tunnel_stopped=true;fs.writeFileSync('/tmp/little-wanderers-square-webhook.json',JSON.stringify(report,null,2));}
  }
  if(cleanupFailed)throw new Error('Sandbox cleanup needs attention; see the specific IDs above');
}
