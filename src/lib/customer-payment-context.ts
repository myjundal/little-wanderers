import {createServerSupabaseClient} from '@/lib/supabase/server';
import {createAdminSupabaseClient} from '@/lib/supabase/admin';
import {getLatestHouseholdIdForUser} from '@/lib/households';
export async function customerPaymentContext(){
 const server=await createServerSupabaseClient();
 const {data:{user}}=await server.auth.getUser();
 if(!user)return {ok:false as const,response:Response.json({ok:false,error:'Please log in.'},{status:401})};
 const admin=createAdminSupabaseClient();const householdId=await getLatestHouseholdIdForUser(admin,user.id);
 if(!householdId)return {ok:false as const,response:Response.json({ok:false,error:'Family profile not found.'},{status:404})};
 return {ok:true as const,user,admin,householdId};
}
