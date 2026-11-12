import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSquareModules} from './helpers/admission-pos-harness.mjs';
const modules=loadSquareModules();
const {allocateCatalogClassRevenue}=modules.load('src/lib/class-revenue-allocation.ts');
const {calculateRevenue}=modules.load('src/lib/service-day-revenue.ts');
const {supplementSquareRevenue}=modules.load('src/lib/square-daily-revenue.ts');
const dates=['2026-11-12','2026-11-19','2026-12-03','2026-12-10','2026-12-17'];
const sources=()=>({bookings:[],slots:[],visits:[],parties:[],series:[],registrations:[],classes:dates.map((date,i)=>({id:`class-${i}`,title:'Art series',start_time:`${date}T22:00:00Z`,status:'scheduled'})),classPrograms:[{id:'program',title:'Art series',class_ids:dates.map((_,i)=>`class-${i}`)}],classMappings:dates.map((_,i)=>({entity_key:`class-${i}`,variation_id:'variation',program_key:'program'}))});
const receipt=(extra={})=>({order_id:'pos-order',service_total_cents:15000,tax_cents:0,tip_cents:0,items:[{label:'Art Class - Evening (Jamie)',category:'class',catalog_object_id:'variation',amount_cents:15000}],payments:[{id:'payment',amount_cents:15000,refunded_cents:0,paid_at:'2026-11-10T15:00:00Z'}],...extra});
function report(data,payment,date,existing=[]){const services=allocateCatalogClassRevenue(existing,[payment],data),evidence=new Map([[payment.order_id,payment]]);return calculateRevenue(supplementSquareRevenue(services,evidence,date),evidence,date);}

test('POS full-series purchase belongs to every real class date once, never entirely to purchase day',()=>{
 const data=sources(),payment=receipt();
 assert.equal(report(data,payment,'2026-11-10').net_cents,0);
 for(const date of dates){const r=report(data,payment,date);assert.equal(r.class_cents,3000);assert.equal(r.prepaid_cents,3000);assert.equal(r.due_cents,0);assert.equal(r.complete,true);}
 assert.equal(dates.reduce((sum,date)=>sum+report(data,payment,date).class_cents,0),15000);
});
test('discounts, remainder cents, refunds and a moved date conserve the actual paid amount',()=>{
 const data=sources(),payment=receipt({service_total_cents:28003,items:[{label:'Series for siblings',category:'class',catalog_object_id:'variation',amount_cents:28003}],payments:[{id:'p',amount_cents:28003,refunded_cents:1000,paid_at:'2026-11-10T15:00:00Z'}]});
 const amounts=dates.map(date=>report(data,payment,date).class_cents);assert.equal(amounts.reduce((a,b)=>a+b),27003);assert.equal(Math.max(...amounts)-Math.min(...amounts),1);
 data.classes[1].start_time='2026-11-20T22:00:00Z';assert.equal(report(data,payment,dates[1]).class_cents,0);assert.equal(report(data,payment,'2026-11-20').class_cents,amounts[1]);
});
test('unselected weekly dates, missing mappings and ambiguous programs stay as unallocated prepayment',()=>{
 const payment=receipt();
 for(const change of [data=>{data.classMappings=[]},data=>{data.classMappings.forEach(row=>row.program_key=null)},data=>{data.classMappings[0].program_key='another'},data=>{data.classPrograms[0].class_ids.push('missing')},data=>{data.classPrograms[0].class_ids.push('class-0')}]){
  const data=sources();change(data);const r=report(data,payment,'2026-11-10');assert.equal(r.net_cents,0);assert.equal(r.unallocated_class_cents,15000);assert.equal(r.complete,false);assert.equal(r.rows[0].recognition,'unallocated_class');
 }
});
test('existing website class allocations win over catalog discovery without duplicate revenue',()=>{
 const data=sources(),payment=receipt();const existing=dates.map((date,i)=>({id:`website-${i}`,date,category:'class',label:'Website series',expected_cents:3000,attendance:'reserved',cancelled:false,charges:[{order_id:'pos-order',amount_cents:3000}],issues:[]}));
 const r=report(data,payment,dates[0],existing);assert.equal(r.rows.length,1);assert.equal(r.class_cents,3000);assert.equal(r.complete,true);
});
test('mixed café/class receipt uses café payment day and class session days without changing the total',()=>{
 const data=sources(),payment=receipt({service_total_cents:15500,items:[...receipt().items,{label:'Latte',category:'cafe',amount_cents:500}],payments:[{id:'p',amount_cents:15500,refunded_cents:0,paid_at:'2026-11-10T15:00:00Z'}]});
 const paid=report(data,payment,'2026-11-10');assert.equal(paid.net_cents,500);assert.equal(paid.class_cents,0);
 assert.equal(dates.reduce((sum,date)=>sum+report(data,payment,date).net_cents,paid.net_cents),15500);
});
test('one explicit standalone session works, cancelled sessions require review, unpaid POS orders create no customer debt',()=>{
 const data=sources();data.classPrograms=[];data.classMappings=[{entity_key:'class-0',variation_id:'variation',program_key:null}];
 assert.equal(report(data,receipt(),dates[0]).class_cents,15000);
 data.classes[0].status='cancelled';const cancelled=report(data,receipt(),dates[0]);assert.equal(cancelled.net_cents,0);assert.equal(cancelled.review_count,1);
 data.classes[0].status='scheduled';const unpaid=report(data,receipt({payments:[]}),dates[0]);assert.equal(unpaid.due_cents,0);assert.equal(unpaid.rows.length,0);
});
test('an item-total mismatch cannot relabel an unallocated class payment as ordinary same-day sales',()=>{
 const data=sources();data.classMappings=[];
 const r=report(data,receipt({service_total_cents:14000, payments:[{id:'p',amount_cents:14000,refunded_cents:0,paid_at:'2026-11-10T15:00:00Z'}]}),'2026-11-10');
 assert.equal(r.net_cents,0);assert.equal(r.sales_cents,0);assert.equal(r.unallocated_class_cents,14000);assert.equal(r.complete,false);
});

const money=amount=>({amount,currency:'USD'});
test('historical discovery pages short results, uses stable query, rejects wrong locations and repeating cursors',async()=>{
 const calls=[];
 const loader=loadSquareModules({env:{SQUARE_ENVIRONMENT:'production'},fetch:async(url,options)=>{
  assert(url.endsWith('/v2/orders/search'));assert.equal(options.method,'POST');const body=JSON.parse(options.body);calls.push(body);
  return Response.json(calls.length===1?{orders:[{id:'cafe',location_id:'test-location',tenders:[{payment_id:'c'}],line_items:[{name:'Coffee'}]}],cursor:'next'}:{orders:[{id:'class',location_id:'test-location',tenders:[{payment_id:'p'}],line_items:[{name:'Opaque catalog label',catalog_object_id:'variation'}]}]});
 }}).load('src/lib/service-day-revenue-data.ts');
 const found=await loader.readHistoricalClassOrders(new Set(['variation']));assert.equal(found.size,1);assert(found.has('class'));assert.equal(calls.length,2);assert.equal(calls[1].cursor,'next');assert.deepEqual(calls[0].query,calls[1].query);
 const repeated=loadSquareModules({env:{SQUARE_ENVIRONMENT:'production'},fetch:async()=>Response.json({orders:[],cursor:'loop'})}).load('src/lib/service-day-revenue-data.ts');
 await assert.rejects(repeated.readHistoricalClassOrders(new Set()),/incomplete/);
 const wrong=loadSquareModules({env:{SQUARE_ENVIRONMENT:'production'},fetch:async()=>Response.json({orders:[{id:'wrong',location_id:'other'}]})}).load('src/lib/service-day-revenue-data.ts');
 await assert.rejects(wrong.readHistoricalClassOrders(new Set()),/location/);
});
test('later class report discovers earlier POS receipts even when there are no payments on the selected day',async()=>{
 const data=sources();const tables={classes:data.classes,class_series_programs:data.classPrograms,square_catalog_mappings:data.classMappings};
 const admin={from(table){const q={select(){return q},order(){return q},limit(){return q},eq(){return q},in(){return q},then(resolve){resolve({data:tables[table]??[],error:null})}};return q}};
 const calls=[];const loader=loadSquareModules({env:{SQUARE_ENVIRONMENT:'production'},fetch:async(url,options)=>{
  calls.push([new URL(url).pathname,options?.method??'GET']);
  if(url.endsWith('/v2/orders/search'))return Response.json({orders:[{id:'pos-order',location_id:'test-location',total_money:money(15000),line_items:[{name:'Art Class - Evening',catalog_object_id:'variation',total_money:money(15000)}],tenders:[{payment_id:'payment'}]}]});
  if(new URL(url).pathname==='/v2/payments')return Response.json({payments:[]});
  if(url.endsWith('/v2/payments/payment'))return Response.json({payment:{id:'payment',order_id:'pos-order',location_id:'test-location',status:'COMPLETED',amount_money:money(15000),created_at:'2026-11-10T15:00:00Z'}});
  throw Error('Unexpected provider request '+url);
 }}).load('src/lib/service-day-revenue-data.ts');
 const r=await loader.getServiceDayRevenue(admin,'2026-11-19');assert.equal(r.class_cents,3000);assert.equal(r.prepaid_cents,3000);assert.equal(r.complete,true);assert(!calls.some(([path])=>path==='/v2/orders/pos-order'));
});
