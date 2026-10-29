import {requireStaffContext} from '@/lib/authz';
import {squareConfig} from '@/lib/square-client';
import {startAdmissionPos,verifyAdmissionPos,type PosSale} from '@/lib/square-admission-pos';
import {getPartyDateKey,toPartyDateTimeIso} from '@/lib/party-config';
export const dynamic='force-dynamic';
export async function GET(){
 const c=await requireStaffContext();if(!c.ok)return c.response;
 const {data,error}=await c.admin.from('checkins').select('id,person_id,price_cents,payment_status').gte('checked_in_at',toPartyDateTimeIso(getPartyDateKey(new Date()),0)).eq('payment_status','due');
 if(error)return Response.json({ok:false,error:'Unable to load unpaid visits'},{status:503});
 const ids=[...new Set((data??[]).map(row=>row.person_id))];
 const {data:people,error:peopleError}=ids.length?await c.admin.from('people').select('id,first_name,last_name').in('id',ids):{data:[],error:null};
 if(peopleError)return Response.json({ok:false,error:'Unable to load visitor names'},{status:503});
 return Response.json({ok:true,unpaid:(data??[]).map(row=>({...row,name:(people??[]).filter(person=>person.id===row.person_id).map(person=>[person.first_name,person.last_name].filter(Boolean).join(' '))[0]??'Visitor'}))});
}
export async function POST(req:Request){
 const c=await requireStaffContext();if(!c.ok)return c.response;const body=await req.json().catch(()=>({}));
 try{
  if(body.mode==='verify'){
   if(typeof body.state!=='string'||typeof body.transaction_id!=='string'||body.transaction_id.length>200)throw new Error('Invalid Square callback');
   const {data,error}=await c.admin.from('admission_pos_sales').select('*').eq('id',body.state).eq('created_by_user_id',c.user.id).eq('environment',squareConfig().environment).maybeSingle();
   if(error||!data)throw new Error('POS sale not found');
   return Response.json({ok:true,...await verifyAdmissionPos(c.admin,data as PosSale,body.transaction_id)});
  }
  const ids=Array.isArray(body.checkin_ids)?body.checkin_ids:[];
  if(!ids.length||ids.length>30||ids.some((id:unknown)=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)))throw new Error('Choose unpaid check-ins');
  return Response.json({ok:true,...await startAdmissionPos(c.admin,ids,c.user.id)});
 }catch(error){return Response.json({ok:false,error:error instanceof Error?error.message:'Unable to prepare POS payment'},{status:409});}
}
