import { onlinePaymentsUnavailable } from '@/lib/online-payment-access';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import {membershipPrice} from '@/lib/payment-pricing';
import {squareConfig} from '@/lib/square-client';
import {getPartyDateKey} from '@/lib/party-config';
import {customerPaymentContext} from '@/lib/customer-payment-context';
import { startSquareCheckout,cancelUnpaidClassCheckout,type CheckoutAttempt } from '@/lib/square-checkout';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(){
 const c=await customerPaymentContext();if(!c.ok)return c.response;
 const {data:current,error:currentError}=await c.admin.from('square_checkout_attempts').select('*').eq('household_id',c.householdId).eq('kind','membership').eq('environment',squareConfig().environment).in('status',['creating','open']).maybeSingle();
 const {data,error}=await c.admin.from('people').select('id,first_name,birthdate').eq('household_id',c.householdId).eq('role','child').order('created_at');
 try{if(error||currentError)throw new Error('Unable to load family');
  const frozenIds=(current?.payload?.assignments??[]).map((child:{id:string})=>child.id);
  return Response.json({ok:true,current:current?{id:current.id,payment_url:current.payment_url}:null,children:current?data?.filter(child=>frozenIds.includes(child.id)):data,amount_cents:current?.expected_amount_cents??membershipPrice(data??[],getPartyDateKey(new Date()))});}
 catch(error){return Response.json({ok:false,error:error instanceof Error?error.message:'Unable to quote membership'},{status:409});}
}
export async function POST(req:Request) {
  const body=await req.json().catch(()=>({}));
  if(body.mode!=='cancel'){const unavailable=onlinePaymentsUnavailable('membership');if(unavailable)return unavailable;}
  try {
    const server = await createServerSupabaseClient();
    const { data: { user } } = await server.auth.getUser();
    if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const admin = createAdminSupabaseClient();
    const householdId = await getLatestHouseholdIdForUser(admin, user.id);
    if (!householdId) return Response.json({ ok: false, error: 'household not found' }, { status: 404 });
    if(body.mode==='cancel'){
      const {data,error}=await admin.from('square_checkout_attempts').select('*').eq('id',body.checkout_id).eq('household_id',householdId).eq('kind','membership').eq('environment',squareConfig().environment).maybeSingle();
      if(error||!data)throw new Error('Checkout not found');
      return Response.json({ok:true,...await cancelUnpaidClassCheckout(admin,data as CheckoutAttempt)});
    }
    const unavailable=onlinePaymentsUnavailable('membership');if(unavailable)return unavailable;
    const result = await startSquareCheckout(admin, { householdId, userId: user.id, role: 'customer',
      kind: 'membership', quotedAmount:body.quoted_amount_cents, email: user.email, returnPath: '/landing/membership?success=1' });
    return Response.json({ ok: true, url: result.url, checkout_id: result.id });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to start subscription' }, { status: 502 });
  }
}
