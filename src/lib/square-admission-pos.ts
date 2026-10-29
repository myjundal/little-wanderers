import type {SupabaseClient} from '@supabase/supabase-js';
import {requirePaymentFlow,squareConfig,squareRequest,squareSiteUrl,assertUsd,type SquareOrder} from '@/lib/square-client';
type SquarePayment={id:string;source_type?:string;tip_money?:{amount?:number;currency?:string};order_id?:string;location_id?:string;status?:string;amount_money?:{amount?:number;currency?:string};refunded_money?:{amount?:number;currency?:string};note?:string;created_at?:string;updated_at?:string};
async function saveSquarePaymentReceipt(admin: SupabaseClient,payment: SquarePayment) {
  const config = squareConfig();
  if (!payment.order_id || payment.location_id !== config.locationId || payment.amount_money?.currency !== 'USD'
    || !Number.isSafeInteger(payment.amount_money.amount) || !payment.updated_at || !Number.isFinite(Date.parse(payment.updated_at))) {
    throw new Error('Invalid Square payment receipt');
  }
  const { error } = await admin.rpc('save_square_payment_receipt',{
    p_environment:config.environment,p_payment:payment.id,p_order:payment.order_id,p_amount:payment.amount_money.amount,
    p_refunded:payment.refunded_money?.amount ?? 0,p_status:payment.status,p_updated:payment.updated_at,
  });
  if (error) throw new Error(error.message);
}

export type PosSale={id:string;environment:string;location_id:string;created_by_user_id:string;amount_cents:number;status:string;order_id:string|null;created_at:string;launched_at?:string|null};
export async function startAdmissionPos(admin:SupabaseClient,checkinIds:string[],userId:string){
 const config=requirePaymentFlow('admission_pos');const appId=process.env.SQUARE_APPLICATION_ID;
 if(!appId||(config.environment==='production'&&!appId.startsWith('sq0idp-')))throw new Error('Square POS Application ID is not configured');
 const siteUrl=squareSiteUrl();
 const {data,error}=await admin.rpc('prepare_admission_pos',{p_ids:checkinIds,p_user:userId,p_environment:config.environment,p_location:config.locationId});
 if(error)throw new Error(error.message);const sale=data as PosSale;
 const {data:claimed,error:claimError}=await admin.from('admission_pos_sales').update({launched_at:new Date().toISOString()}).eq('id',sale.id).is('launched_at',null).select('id').maybeSingle();
 if(claimError)throw new Error(claimError.message);
 if(!claimed)return {id:sale.id,pending:true,url:null};
 return {id:sale.id,pending:false,url:`square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify({
  amount_money:{amount:sale.amount_cents,currency_code:'USD'},callback_url:`${siteUrl}/staff/checkin`,client_id:appId,version:'1.3',location_id:config.locationId,state:sale.id,
  notes:`LW admission ${sale.id}`,options:{supported_tender_types:['CREDIT_CARD'],clear_default_fees:true,auto_return:true},
 }))}`};
}
export async function verifyAdmissionPos(admin:SupabaseClient,sale:PosSale,orderId:string){
 const config=squareConfig();if(sale.environment!==config.environment||sale.location_id!==config.locationId)throw new Error('POS environment mismatch');
 if(sale.status==='paid'&&sale.order_id===orderId)return {status:'paid'};
 if(sale.status!=='open')throw new Error('This POS sale requires staff review');
 const {order}=await squareRequest<{order:SquareOrder}>(`/v2/orders/${encodeURIComponent(orderId)}`);
 if(order.id!==orderId||order.location_id!==config.locationId||!['OPEN','COMPLETED'].includes(order.state??''))throw new Error('Square POS order does not match');
 const tip=order.total_tip_money?.amount??0;
 if(!Number.isSafeInteger(tip)||tip<0||(tip>0&&order.total_tip_money?.currency!=='USD'))throw new Error('Square tip requires review');
 assertUsd(order.total_money,sale.amount_cents+tip);
 const payments:SquarePayment[]=[];
 for(const tender of order.tenders??[]){
  if(!tender.payment_id)throw new Error('A completed Square card receipt is required');
  const {payment}=await squareRequest<{payment:SquarePayment}>(`/v2/payments/${encodeURIComponent(tender.payment_id)}`);
  if(payment.id!==tender.payment_id||payment.source_type!=='CARD'||payment.order_id!==orderId||payment.location_id!==config.locationId||payment.status!=='COMPLETED'||payment.amount_money?.currency!=='USD'||(payment.refunded_money?.amount??0)!==0||!Number.isSafeInteger(payment.amount_money.amount))throw new Error('Square payment requires review');
  // A callback/state alone is not payment proof. The provider's note binds this receipt to our frozen sale.
  if(payment.note!==`LW admission ${sale.id}`&&!order.line_items?.some(line=>line.note===`LW admission ${sale.id}`))throw new Error('Square receipt reference does not match this check-in');
  if(!payment.created_at||!Number.isFinite(Date.parse(payment.created_at))||Date.parse(payment.created_at)<Date.parse(sale.created_at)-60000)throw new Error('Square receipt predates this check-in');
  if(payment.tip_money&&(!Number.isSafeInteger(payment.tip_money.amount)||payment.tip_money.amount!<0||payment.tip_money.currency!=='USD'))throw new Error('Square tip requires review');
  payments.push(payment);
 }
 if(!payments.length||payments.reduce((sum,p)=>sum+p.amount_money!.amount!,0)!==sale.amount_cents)throw new Error('Square paid amount does not match');
 if(payments.reduce((sum,p)=>sum+(p.tip_money?.amount??0),0)!==tip)throw new Error('Square tip requires review');
 for(const payment of payments)await saveSquarePaymentReceipt(admin,payment);
 const {error}=await admin.rpc('fulfill_admission_pos',{p_id:sale.id,p_order:orderId,p_amount:sale.amount_cents});
 if(error)throw new Error(error.message);return {status:'paid'};
}

/** Reconcile before releasing a launch that staff explicitly checked on the iPad. */
export async function recoverAdmissionPos(admin:SupabaseClient,sale:PosSale,userId:string,confirmed:boolean){
 if(!confirmed||sale.created_by_user_id!==userId)throw new Error('Check Square on this iPad and confirm its checkout is closed with no completed, pending or offline payment.');
 if(sale.status==='paid')return {status:'paid'};
 if(sale.status==='cancelled')return {status:'cancelled'};
 if(sale.status!=='open')throw new Error('This payment requires owner review');
 const config=squareConfig();
 if(sale.environment!==config.environment||sale.location_id!==config.locationId)throw new Error('POS environment mismatch');
 if(!sale.launched_at||Date.now()-Date.parse(sale.launched_at)<60000)throw new Error('Wait one minute after the launch, then check Square before resetting.');
 const query=new URLSearchParams({location_id:config.locationId,begin_time:new Date(Date.parse(sale.created_at)-60000).toISOString(),end_time:new Date().toISOString(),sort_order:'ASC',limit:'100'});
 const matching:SquarePayment[]=[];let cursor:string|undefined;
 const orders=new Map<string,SquareOrder>();
 for(let page=0;page<10;page++){
  if(cursor)query.set('cursor',cursor);
  const result=await squareRequest<{payments?:SquarePayment[];cursor?:string}>(`/v2/payments?${query}`);
  for(const payment of result.payments??[]){
   let matches=payment.note===`LW admission ${sale.id}`;
   if(!matches&&payment.order_id){
    if(!orders.has(payment.order_id))orders.set(payment.order_id,(await squareRequest<{order:SquareOrder}>(`/v2/orders/${encodeURIComponent(payment.order_id)}`)).order);
    matches=orders.get(payment.order_id)?.line_items?.some(line=>line.note===`LW admission ${sale.id}`)??false;
   }
   if(matches)matching.push(payment);
  }
  cursor=result.cursor;if(!cursor)break;
 }
 if(cursor)throw new Error('Too many transactions to verify safely. Contact the owner before retrying.');
 if(matching.some(payment=>!['COMPLETED','FAILED','CANCELED'].includes(payment.status??'')))throw new Error('Square still has a pending payment. Finish or cancel it in Square first.');
 const completed=matching.filter(payment=>payment.status==='COMPLETED');
 if(completed.length){
  const orderIds=[...new Set(completed.map(payment=>payment.order_id))];
  if(orderIds.length!==1||!orderIds[0])throw new Error('Multiple or unclear Square payments require owner review. Do not charge again.');
  await verifyAdmissionPos(admin,sale,orderIds[0]);
  return {status:'paid'};
 }
 const {error}=await admin.rpc('cancel_admission_pos_after_review',{p_id:sale.id,p_user:userId});
 if(error)throw new Error(error.message);
 return {status:'cancelled'};
}
