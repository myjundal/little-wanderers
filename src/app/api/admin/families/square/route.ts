import { requireStaffContext } from '@/lib/authz';
import { isUuid } from '@/lib/open-play-reservations';
import { connectSquareFamilyCustomer } from '@/lib/square-family-customers';

export async function POST(req: Request) {
  const c = await requireStaffContext();
  if (!c.ok) return c.response;
  const body = await req.json().catch(() => ({}));
  if (!isUuid(body.household_id)) return Response.json({ ok: false, error: 'Choose a family.' }, { status: 400 });
  try {
    const result = await connectSquareFamilyCustomer(c.admin, body.household_id);
    return Response.json({ ok: true, customer_id: result.customer.id, name: [result.customer.given_name, result.customer.family_name].filter(Boolean).join(' '),
      email: result.customer.email_address, phone: result.customer.phone_number, created: result.created }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to connect Square customer.' }, { status: 409 });
  }
}
