import type {SupabaseClient} from '@supabase/supabase-js';
import {squareConfig,squareRequest,assertSquarePaymentUrl,assertUsd,type SquareOrder} from '@/lib/square-client';
import {cancelUnpaidClassCheckout,type CheckoutAttempt} from '@/lib/square-checkout';

/** A provider timeout can occur after link creation but before its mapping is saved. Replay only the frozen idempotent body. */
async function recoverUnmappedLink(admin:SupabaseClient,attempt:CheckoutAttempt){
 const body=attempt.payload.provider_request;
 if(!body)return null;
 if(body.idempotency_key!==`lw-checkout-${attempt.id}`)throw new Error('Checkout recovery idempotency mismatch');
 const {payment_link:link}=await squareRequest<{payment_link:{id:string;order_id:string;url:string}}>('/v2/online-checkout/payment-links','POST',body);
 const {order}=await squareRequest<{order:SquareOrder}>(`/v2/orders/${encodeURIComponent(link.order_id)}`);
 if(order.id!==link.order_id||order.location_id!==attempt.location_id)throw new Error('Checkout recovery order mismatch');
 assertUsd(order.total_money,attempt.expected_amount_cents);
 const values={order_id:link.order_id,payment_link_id:link.id,payment_url:assertSquarePaymentUrl(link.url)};
 const {error}=await admin.from('square_checkout_attempts').update(values).eq('id',attempt.id).in('status',['creating','open']);
 if(error)throw new Error(error.message);return {...attempt,...values};
}
export async function expireSquareCheckoutHolds(admin:SupabaseClient,householdId?:string){
 const config=squareConfig();
 let query=admin.from('square_checkout_attempts').select('*').eq('environment',config.environment).in('kind',['class','admission'])
   .in('status',['creating','open']).lte('hold_expires_at',new Date().toISOString()).order('hold_expires_at').limit(5);
 if(householdId)query=query.eq('household_id',householdId);
 const {data,error}=await query;if(error)throw new Error(error.message);
 // Independent expired attempts can be checked together; each retains its seats if Square cannot prove cancellation/payment.
 const results=await Promise.allSettled((data??[]).map(async row=>{
  let attempt=row as CheckoutAttempt;
  if(!attempt.order_id){
   const recovered=await recoverUnmappedLink(admin,attempt);
   if(!recovered){const result=await admin.rpc('abandon_uncreated_square_checkout',{p_id:attempt.id});if(result.error)throw new Error(result.error.message);return result.data?'cancelled':'pending';}
   attempt=recovered;
  }
  return (await cancelUnpaidClassCheckout(admin,attempt)).status;
 }));
 return {checked:results.length,cancelled:results.filter(r=>r.status==='fulfilled'&&r.value==='cancelled').length,
   completed:results.filter(r=>r.status==='fulfilled'&&r.value==='completed').length,
   retained:results.filter(r=>r.status==='rejected'||r.status==='fulfilled'&&r.value==='pending').length};
}
