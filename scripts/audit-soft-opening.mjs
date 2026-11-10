// Read-only release audit; never creates customers, reservations, payments, or emails.
import {createClient} from '@supabase/supabase-js';
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const checked=r=>{if(r.error)throw new Error(r.error.message);return r.data??[];};
const slots=checked(await db.from('open_play_reservation_slots').select('id,starts_at,ends_at,capacity_children,status').eq('is_soft_opening',true).gte('starts_at','2026-11-11T05:00:00Z').lt('starts_at','2027-01-01T05:00:00Z').order('starts_at'));
const bookings=slots.length?checked(await db.from('open_play_reservations').select('id,status').in('slot_id',slots.map(s=>s.id)).neq('status','cancelled')):[];
const columns=await db.from('open_play_reservations').select('id,child_ids,payment_status,square_order_id').limit(0);
console.log(JSON.stringify({futureSlots:slots.length,openSlots:slots.filter(s=>s.status==='open').length,futureReservations:bookings.length,migrationApplied:!columns.error,expectedWindows:393,capacityFive:slots.filter(s=>s.status==='open').every(s=>s.capacity_children===5)},null,2));
