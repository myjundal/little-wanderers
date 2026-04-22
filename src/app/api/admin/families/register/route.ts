import { requireStaffContext } from '@/lib/authz';

type MemberInput = {
  full_name?: string;
  birthdate?: string;
  role?: 'adult' | 'child';
};

function splitName(fullName: string) {
  const cleaned = fullName.trim().replace(/\s+/g, ' ');
  const [firstName, ...rest] = cleaned.split(' ');
  return {
    first_name: firstName,
    last_name: rest.length ? rest.join(' ') : null,
  };
}

export async function POST(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  const body = (await req.json()) as { household_name?: string; members?: MemberInput[] };
  const members = Array.isArray(body.members) ? body.members : [];

  if (members.length === 0) {
    return Response.json({ ok: false, error: 'Add at least one family member.' }, { status: 400 });
  }

  const cleanedMembers = members
    .map((item) => ({
      full_name: String(item.full_name ?? '').trim(),
      birthdate: item.birthdate ? String(item.birthdate) : null,
      role: item.role === 'child' ? 'child' : 'adult',
    }))
    .filter((item) => item.full_name.length > 0);

  if (cleanedMembers.length === 0) {
    return Response.json({ ok: false, error: 'Each family member needs a full name.' }, { status: 400 });
  }

  const primaryAdult = cleanedMembers.find((item) => item.role === 'adult') ?? cleanedMembers[0];
  const householdName = String(body.household_name ?? '').trim() || `${primaryAdult.full_name} Family`;

  const { data: household, error: householdError } = await context.admin
    .from('households')
    .insert({
      user_id: context.user.id,
      role: 'owner',
      name: householdName,
    })
    .select('id,name')
    .single();

  if (householdError || !household) {
    return Response.json({ ok: false, error: 'Unable to create household.' }, { status: 500 });
  }

  const peopleRows = cleanedMembers.map((item) => {
    const names = splitName(item.full_name);
    return {
      household_id: household.id,
      role: item.role,
      first_name: names.first_name,
      last_name: names.last_name,
      birthdate: item.birthdate,
    };
  });

  const { error: peopleError } = await context.admin.from('people').insert(peopleRows);

  if (peopleError) {
    await context.admin.from('households').delete().eq('id', household.id);
    return Response.json({ ok: false, error: 'Unable to save family members.' }, { status: 500 });
  }

  return Response.json({ ok: true, household_id: household.id, household_name: household.name });
}
