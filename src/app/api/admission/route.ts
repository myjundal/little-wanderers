import {customerPaymentContext} from '@/lib/customer-payment-context';
import {paymentFlowEnabled,squareConfig} from '@/lib/square-client';
import {startSquareCheckout,reconcileCheckout,cancelUnpaidClassCheckout,type CheckoutAttempt} from '@/lib/square-checkout';
import {admissionPrice} from '@/lib/payment-pricing';
import {getPartyDateKey} from '@/lib/party-config';
export const dynamic='force-dynamic';
export async function GET(){
 const c=await customerPaymentContext();if(!c.ok)return c.response;
 try{
  const [{data:people,error:p},{data:passes,error:a},{data:attempt,error:e}]=await Promise.all([
   c.admin.from('people').select('id,first_name,role,birthdate').eq('household_id',c.householdId).order('created_at'),
   c.admin.from('admission_passes').select('id,person_id,visit_date,status').eq('household_id',c.householdId).gte('visit_date',getPartyDateKey(new Date())).order('visit_date'),
   c.admin.from('square_checkout_attempts').select('*').eq('household_id',c.householdId).eq('kind','admission').eq('environment',squareConfig().environment).in('status',['creating','open']).maybeSingle(),
  ]);
  if(p||a||e)throw new Error('Unable to load admission. Please contact us.');
  return Response.json({ok:true,enabled:paymentFlowEnabled('admission'),people,passes,current:attempt?{id:attempt.id,payment_url:attempt.payment_url}:null});
 }catch(error){return Response.json({ok:false,error:error instanceof Error?error.message:'Unable to load admission'},{status:503});}
}
export async function POST(req:Request){
 const c=await customerPaymentContext();if(!c.ok)return c.response;
 const body=await req.json().catch(()=>({}));
 try{
  if(['finalize','cancel'].includes(body.mode)){
   const {data:attempt,error}=await c.admin.from('square_checkout_attempts').select('*').eq('id',body.checkout_id).eq('household_id',c.householdId).eq('kind','admission').eq('environment',squareConfig().environment).maybeSingle();
   if(error||!attempt)throw new Error('Checkout not found');
   const result=body.mode==='cancel'?await cancelUnpaidClassCheckout(c.admin,attempt as CheckoutAttempt):await reconcileCheckout(c.admin,attempt as CheckoutAttempt);
   return Response.json({ok:true,...result});
  }
  if(!paymentFlowEnabled('admission'))return Response.json({ok:false,error:'Online admission is not available yet.'},{status:503});
  const date=String(body.visit_date??'');const today=getPartyDateKey(new Date());
  const valid=new Date(`${date}T12:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(+valid)||valid.toISOString().slice(0,10)!==date||date<today||+valid-Date.parse(`${today}T12:00:00Z`)>90*86400000)throw new Error('Choose a visit date within 90 days');
  const selected=[...new Set<string>(Array.isArray(body.person_ids)?body.person_ids:[])].sort();
  if(!selected.length||selected.length>20||selected.some(id=>!(/^[0-9a-f-]{36}$/i.test(id))))throw new Error('Choose valid family members');
  const [{data:people,error:p},{data:members,error:m}]=await Promise.all([
   c.admin.from('people').select('id,role,birthdate').eq('household_id',c.householdId).in('id',selected),
   c.admin.from('memberships').select('renews_at,square_environment,covered_person_ids,payment_review_required').eq('household_id',c.householdId),
  ]);
  if(p||m||people?.length!==selected.length)throw new Error('Unable to verify family members');
  const covered=people.filter(person=>person.role==='child'&&(members??[]).some(member=>!member.payment_review_required&&(!member.square_environment||member.square_environment===squareConfig().environment)&&(!member.renews_at||getPartyDateKey(member.renews_at)>date)&&(!member.square_environment||member.covered_person_ids?.includes(person.id)))).map(p=>p.id);
  const amount=admissionPrice(people,date,covered);
  if(body.mode==='quote')return Response.json({ok:true,amount_cents:amount,covered_person_ids:covered});
  if(amount===0)throw new Error('No payment is needed. Please check in with staff.');
  if(body.quoted_amount_cents!==amount)throw new Error('The price changed. Please review it again.');
  const result=await startSquareCheckout(c.admin,{householdId:c.householdId,userId:c.user.id,role:'customer',kind:'admission',email:c.user.email,personIds:selected,visitDate:date,quotedAmount:amount,returnPath:'/landing/admission'});
  return Response.json({ok:true,checkout_id:result.id,payment_url:result.url});
 }catch(error){return Response.json({ok:false,error:error instanceof Error?error.message:'Unable to prepare admission'},{status:409});}
}
