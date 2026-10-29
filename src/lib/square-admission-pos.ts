import type {SupabaseClient} from '@supabase/supabase-js';
import {requirePaymentFlow,squareConfig,squareRequest,squareSiteUrl,assertUsd,type SquareOrder} from '@/lib/square-client';
import {saveSquarePaymentReceipt,type SquarePayment} from '@/lib/square-checkout';
export type PosSale={id:string;environment:string;location_id:string;created_by_user_id:string;amount_cents:number;status:string;order_id:string|null;created_at:string};
export async function startAdmissionPos(admin:SupabaseClient,checkinIds:string[],userId:string){
 const config=requirePaymentFlow('admission');const appId=process.env.SQUARE_APPLICATION_ID;
 if(!appId||(config.environment==='production'&&!appId.startsWith('sq0idp-')))throw new Error('Square POS Application ID is not configured');
 const {data,error}=await admin.rpc('prepare_admission_pos',{p_ids:checkinIds,p_user:userId,p_environment:config.environment,p_location:config.locationId});
 if(error)throw new Error(error.message);const sale=data as PosSale;
 const {data:claimed,error:claimError}=await admin.from('admission_pos_sales').update({launched_at:new Date().toISOString()}).eq('id',sale.id).is('launched_at',null).select('id').maybeSingle();
 if(claimError)throw new Error(claimError.message);
 if(!claimed)return {id:sale.id,pending:true,url:null};
 return {id:sale.id,pending:false,url:`square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify({
  amount_money:{amount:sale.amount_cents,currency_code:'USD'},callback_url:`${squareSiteUrl()}/staff/checkin`,client_id:appId,version:'1.3',location_id:config.locationId,state:sale.id,
  notes:`LW admission ${sale.id}`,options:{supported_tender_types:['CREDIT_CARD'],clear_default_fees:true,auto_return:true},
 }))}`};
}
export async function verifyAdmissionPos(admin:SupabaseClient,sale:PosSale,orderId:string){
 const config=squareConfig();if(sale.environment!==config.environment||sale.location_id!==config.locationId)throw new Error('POS environment mismatch');
 if(sale.status==='paid'&&sale.order_id===orderId)return {status:'paid'};
 if(sale.status!=='open')throw new Error('This POS sale requires staff review');
 const {order}=await squareRequest<{order:SquareOrder}>(`/v2/orders/${encodeURIComponent(orderId)}`);
 if(order.id!==orderId||order.location_id!==config.locationId||!['OPEN','COMPLETED'].includes(order.state??''))throw new Error('Square POS order does not match');
 assertUsd(order.total_money,sale.amount_cents);
 const payments:SquarePayment[]=[];
 for(const tender of order.tenders??[]){
  if(!tender.payment_id)throw new Error('A completed online card receipt is required');
  const {payment}=await squareRequest<{payment:SquarePayment}>(`/v2/payments/${encodeURIComponent(tender.payment_id)}`);
  if(payment.order_id!==orderId||payment.location_id!==config.locationId||payment.status!=='COMPLETED'||payment.amount_money?.currency!=='USD'||(payment.refunded_money?.amount??0)!==0||!Number.isSafeInteger(payment.amount_money.amount))throw new Error('Square payment requires review');
  // A callback/state alone is not payment proof. The provider's note binds this receipt to our frozen sale.
  if(payment.note!==`LW admission ${sale.id}`&&!order.line_items?.some(line=>line.note===`LW admission ${sale.id}`))throw new Error('Square receipt reference does not match this check-in');
  if(!payment.created_at||Date.parse(payment.created_at)<Date.parse(sale.created_at)-60000)throw new Error('Square receipt predates this check-in');
  payments.push(payment);
 }
 if(!payments.length||payments.reduce((sum,p)=>sum+p.amount_money!.amount!,0)!==sale.amount_cents)throw new Error('Square paid amount does not match');
 for(const payment of payments)await saveSquarePaymentReceipt(admin,payment);
 const {error}=await admin.rpc('fulfill_admission_pos',{p_id:sale.id,p_order:orderId,p_amount:sale.amount_cents});
 if(error)throw new Error(error.message);return {status:'paid'};
}
