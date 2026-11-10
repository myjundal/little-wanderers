import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { isUuid } from '@/lib/open-play-reservations';
import { startOpenPlayPayment, verifyOpenPlayPayment, type OpenPlayPayment } from '@/lib/soft-opening-payments';
export const dynamic = 'force-dynamic';
async function handle(req: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}, start: boolean) {
    try {
        const { id } = await params;
        if (!isUuid(id))
            return Response.json({ ok: false, error: 'Invalid reservation.' }, { status: 400 });
        const server = await createServerSupabaseClient();
        const { data: { user } } = await server.auth.getUser();
        if (!user)
            return Response.json({ ok: false, error: 'Please sign in.' }, { status: 401 });
        const db = createAdminSupabaseClient();
        const family = await getLatestHouseholdIdForUser(db, user.id);
        if (!family)
            return Response.json({ ok: false, error: 'Family not found.' }, { status: 404 });
        const { data, error } = await db.from('open_play_reservations').select('*').eq('id', id).eq('household_id', family).single();
        if (error || !data)
            return Response.json({ ok: false, error: 'Reservation not found.' }, { status: 404 });
        if (start) {
            const { data: slot, error: slotError } = await db.from('open_play_reservation_slots').select('ends_at,status').eq('id', data.slot_id).single();
            if (slotError || !slot || slot.status !== 'open' || Date.parse(slot.ends_at) <= Date.now())
                return Response.json({ ok: false, error: 'This visit window is no longer available for online payment. Please contact us.' }, { status: 409 });
        }
        const r = data as OpenPlayPayment;
        const result = start ? await startOpenPlayPayment(db, r) : { reservation: await verifyOpenPlayPayment(db, r) };
        return Response.json({ ok: true, ...result }, { headers: { 'cache-control': 'no-store' } });
    }
    catch {
        return Response.json({ ok: false, error: 'Your reservation is saved, but payment could not be confirmed. Please retry or contact us before paying again.' }, { status: 503 });
    }
}
export async function POST(req: Request, ctx: {
    params: Promise<{
        id: string;
    }>;
}) { return handle(req, ctx, true); }
export async function GET(req: Request, ctx: {
    params: Promise<{
        id: string;
    }>;
}) { return handle(req, ctx, false); }
