import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSquareModules} from './helpers/admission-pos-harness.mjs';
const modules=loadSquareModules();
const {calculateRevenue}=modules.load('src/lib/service-day-revenue.ts');
const {supplementSquareRevenue,squareSaleCategory}=modules.load('src/lib/square-daily-revenue.ts');
const date='2026-11-11';
const payment=(id,amount,day=date,extra={})=>({id,amount_cents:amount,refunded_cents:0,paid_at:`${day}T15:00:00Z`,...extra});
const receipt=(id,items,payments)=>({order_id:id,service_total_cents:items.reduce((n,i)=>n+i.amount_cents,0),tax_cents:0,tip_cents:0,items,payments});
const item=(label,amount_cents,category=squareSaleCategory(label))=>({label,amount_cents,category});
const service=(extra={})=>({id:'booking',date:'2026-11-14',category:'open_play',label:'Open Play',expected_cents:1600,attendance:'reserved',cancelled:false,charges:[{order_id:'mixed',amount_cents:1600}],issues:[],...extra});
const report=(services,receipts,day=date)=>{const evidence=new Map(receipts.map(row=>[row.order_id,row]));return calculateRevenue(supplementSquareRevenue(services,evidence,day),evidence,day);};

test('all standalone Square sales count on purchase day, including café, gift cards, memberships, passes and unnamed sales',()=>{
 const receipts=[receipt('cafe',[item('Latte',450)],[payment('cash',450)]),receipt('gift',[item('Birthday gift',5000,'gift_card')],[payment('card',5000)]),receipt('member',[item('Monthly membership',5000)],[payment('sub',5000)]),receipt('pass',[item('Ten visit pass',10000)],[payment('pack',10000)]),receipt('other',[item('Custom item',1234)],[payment('other',1234)])];
 const result=report([],receipts);
 assert.equal(result.net_cents,21684);assert.equal(result.sales_cents,21684);assert.equal(result.due_cents,0);assert.equal(result.complete,true);
 assert.equal(result.categories.find(c=>c.category==='gift_card').net_cents,5000);assert.equal(result.categories.find(c=>c.category==='cafe').net_cents,450);
 assert.equal(report([],receipts,'2026-11-12').net_cents,0);
 assert.equal(squareSaleCategory('Birthday surprise','GIFT_CARD'),'gift_card');
 for(const name of ['Caramel Macchiato','Americano','Matcha Latte','Lavender Cloud Milk'])assert.equal(squareSaleCategory(name),'cafe');
});

test('a mixed admission and café receipt counts the café on payment day and admission once on visit day',()=>{
 const receipts=[receipt('mixed',[item('Open Play',1600),item('Latte',450)],[payment('p',2050)])];
 const before=report([service()],receipts),visit=report([service()],receipts,'2026-11-14');
 assert.equal(before.net_cents,450);assert.equal(before.categories.find(c=>c.category==='cafe').net_cents,450);
 assert.equal(visit.net_cents,1600);assert.equal(visit.prepaid_cents,1600);assert.equal(visit.complete,true);
 assert.equal(before.net_cents+visit.net_cents,2050);
});

test('split tenders on different days and repeated daily discovery do not duplicate a sale',()=>{
 const receipts=[receipt('mixed',[item('Open Play',1600),item('Coffee',400)],[payment('one',1000),payment('two',1000,'2026-11-12')])];
 assert.equal(report([service()],receipts).net_cents,200);assert.equal(report([service()],receipts,'2026-11-12').net_cents,200);
 assert.equal(report([service()],receipts,'2026-11-14').net_cents,1600);
});

test('gift cards are revenue at purchase, and redemption settles the bill without counting the money twice',()=>{
 const gift=receipt('gift',[item('Gift card',5000)],[payment('purchase',5000)]);
 const used=receipt('mixed',[item('Admission',1600),item('Coffee',400)],[payment('gift-used',1500,'2026-11-14',{gift_card:true}),payment('extra',500,'2026-11-14')]);
 const bought=report([service()], [gift,used]),visit=report([service()], [gift,used],'2026-11-14');
 assert.equal(bought.net_cents,5000);assert.equal(visit.net_cents,500);assert.equal(visit.redeemed_cents,1500);assert.equal(visit.due_cents,0);assert.equal(visit.complete,true);
});

test('unlinked receipts and refunds use actual settled amounts; unknown item labels still count',()=>{
 const refunded=receipt('cash',[item('Unknown product',2000)],[payment('cash',2000,date,{refunded_cents:500})]);
 const result=report([], [refunded]);assert.equal(result.net_cents,1500);assert.equal(result.refunded_cents,500);assert.equal(result.due_cents,0);
 const mixed=receipt('mixed',[item('Unrecognized admission label',1600,'other'),item('Latte',400)],[payment('p',2000)]);
 assert.equal(report([service()], [mixed]).net_cents,400);
});

const money=amount=>({amount,currency:'USD'});
test('daily provider lookup pages all completed location payments using Eastern midnight, including cash and gift cards',async()=>{
 const urls=[];const loader=loadSquareModules({env:{SQUARE_ENVIRONMENT:'production'},fetch:async url=>{
   urls.push(new URL(url));return Response.json(urls.length===1?{payments:[{id:'cash',location_id:'test-location',status:'COMPLETED',created_at:'2026-11-01T05:00:00Z',source_type:'CASH'}],cursor:'next'}:{payments:[{id:'gift',location_id:'test-location',status:'COMPLETED',created_at:'2026-11-02T04:59:59Z'},{id:'declined',location_id:'test-location',status:'FAILED',created_at:'2026-11-01T06:00:00Z'},{id:'boundary',location_id:'test-location',status:'COMPLETED',created_at:'2026-11-02T05:00:00Z'}]});
 }}).load('src/lib/service-day-revenue-data.ts');
 const result=await loader.readDailySquarePayments('2026-11-01');assert.equal(result.length,2);assert.equal(urls[1].searchParams.get('cursor'),'next');
 assert.equal(Date.parse(urls[0].searchParams.get('end_time'))-Date.parse(urls[0].searchParams.get('begin_time')),25*3600000);
});

test('gift-card and cash split tenders exclude tax and tips while preserving the paid balance',async()=>{
 const loader=loadSquareModules({env:{SQUARE_ENVIRONMENT:'production'},fetch:async url=>{
  if(url.includes('/orders/'))return Response.json({order:{id:'order',location_id:'test-location',total_money:money(2220),total_tax_money:money(120),total_tip_money:money(100),line_items:[{name:'Coffee',total_money:money(2120),total_tax_money:money(120)}],tenders:[{payment_id:'gift'},{payment_id:'cash'}]}});
  const gift=url.endsWith('/gift');return Response.json({payment:{id:gift?'gift':'cash',order_id:'order',location_id:'test-location',status:'COMPLETED',amount_money:money(1060),...(gift?{card_details:{card:{card_brand:'SQUARE_GIFT_CARD'}}}:{tip_money:money(100)}),created_at:`${date}T15:00:00Z`}});
 }}).load('src/lib/service-day-revenue-data.ts');
 const evidence=await loader.readRevenueEvidence('order');const result=report([], [evidence]);
 assert.equal(result.net_cents,1000);assert.equal(result.redeemed_cents,1000);assert.equal(result.rows[0].tax_cents,120);assert.equal(result.rows[0].tip_cents,100);assert.equal(result.complete,true);
});

test('daily report reads every Square sale including orderless cash; failed discovery is visibly partial',async()=>{
 const admin={from(){const q={select(){return q},order(){return q},limit(){return q},eq(){return q},in(){return q},then(resolve){return resolve({data:[],error:null})}};return q}};
 for(const fail of [false,true]){
  const loader=loadSquareModules({env:{SQUARE_ENVIRONMENT:'production'},fetch:async url=>{
   assert(new URL(url).pathname==='/v2/payments');if(fail)throw Error('offline');return Response.json({payments:[{id:'cash',status:'COMPLETED',location_id:'test-location',amount_money:money(1234),created_at:`${date}T15:00:00Z`,source_type:'CASH'}]});
  }}).load('src/lib/service-day-revenue-data.ts');
  const result=await loader.getServiceDayRevenue(admin,date);assert.equal(result.net_cents,fail?0:1234);assert.equal(result.complete,!fail);assert.equal(result.issues.length,fail?1:0);
 }
});
