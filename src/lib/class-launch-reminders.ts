type Session = { id: string; title: string; status: string; start_time: string; end_time: string; price_cents: number };
type Registration = { id: string; class_id: string; person_id: string; household_id: string; status: string };
type Person = { id: string; household_id: string; first_name: string | null; last_name: string | null; role: string | null };
type Household = { id: string; name: string | null; email: string | null };
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const date = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function prepareClassLaunchReminders(input: {
  classes: Session[]; registrations: Registration[]; people: Person[]; households: Household[]; now?: Date; siteUrl: string;
}) {
  const now = input.now ?? new Date();
  const sessions = new Map(input.classes.filter(row => row.title !== 'Little Hands, Big Canvases' && row.status === 'scheduled'
    && Date.parse(row.start_time) > now.getTime()).map(row => [row.id, row]));
  const people = new Map(input.people.filter(person => person.role === 'child').map(person => [person.id, person]));
  const families = new Map(input.households.map(row => [row.id, row]));
  const grouped = new Map<string, Array<{ registration: Registration; child: Person; session: Session }>>();
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const row of input.registrations) {
    if (!['preregistered', 'scheduled', 'attended'].includes(row.status)) continue;
    const session = sessions.get(row.class_id); if (!session) continue;
    const child = people.get(row.person_id);
    if (!child || child.household_id !== row.household_id) { issues.push(`Registration ${row.id} needs family review.`); continue; }
    const key = `${row.class_id}:${row.person_id}`;
    if (seen.has(key)) { issues.push(`Duplicate class selection ${key}.`); continue; } seen.add(key);
    const rows = grouped.get(row.household_id) ?? []; rows.push({ registration: row, child, session }); grouped.set(row.household_id, rows);
  }
  const messages = [];
  for (const [householdId, entries] of grouped) {
    const household = families.get(householdId);
    if (!household?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(household.email)) { issues.push(`Family ${householdId} needs a valid email.`); continue; }
    entries.sort((a,b) => a.session.start_time.localeCompare(b.session.start_time) || (a.child.first_name ?? '').localeCompare(b.child.first_name ?? ''));
    const unpaid = entries.filter(row => row.registration.status === 'preregistered');
    const paid = entries.filter(row => row.registration.status !== 'preregistered');
    const rows = entries.map(({ registration, child, session }) => `<tr><td style="padding:12px;border-bottom:1px solid #eee"><strong>${escape([child.first_name, child.last_name].filter(Boolean).join(' '))}</strong><br>${escape(session.title)}<br>${escape(date(session.start_time))} Eastern<br><strong>${registration.status === 'preregistered' ? `${money(session.price_cents)} per child · payment needed to confirm` : 'Payment received · confirmed'}</strong></td></tr>`).join('');
    const childIds = [...new Set(unpaid.map(row => row.child.id))];
    const buttons = childIds.map(id => {
      const child = people.get(id)!;
      const target = new URL('/landing/classschedule', input.siteUrl);
      target.searchParams.set('child_id', id); target.searchParams.set('class_ids', unpaid.filter(row => row.child.id === id).map(row => row.session.id).join(','));
      target.hash = 'class-date-booking';
      const online = target.toString(); target.searchParams.set('payment', 'arrival');
      return `<p><strong>${escape(child.first_name || 'Your child')}’s class dates</strong></p><p><a href="${escape(online)}" style="display:inline-block;background:#665071;color:white;padding:12px 18px;text-decoration:none;border-radius:8px;margin:0 8px 8px 0">Pay online &amp; confirm</a><a href="${escape(target.toString())}" style="display:inline-block;background:#efe7f3;color:#3c2c44;padding:12px 18px;text-decoration:none;border-radius:8px">I’ll pay at the studio</a></p>`;
    }).join('');
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#322b35;background:#faf7fb;padding:24px"><main style="max-width:620px;margin:auto;background:#fff;padding:28px;border-radius:16px"><p style="letter-spacing:2px;font-size:12px">LITTLE WANDERERS</p><h1 style="font-size:26px">Your classes are coming up!</h1><p>Hello ${escape((household.name || 'Little Wanderers family').replace(/ Family$/i,''))},</p><p>Our weekly classes begin this week, November 16. Here are your saved class dates. All times below are Eastern.</p><table style="width:100%;border-collapse:collapse">${rows}</table>${unpaid.length ? `<h2 style="font-size:20px">Still planning to join?</h2><p>Pre-registration saved your interest; it did not reserve or guarantee a seat. <strong>Payment must be completed before your child can participate.</strong> Pay online to confirm your place, or choose to pay at the studio before class, subject to space being available.</p><p>If your plans have changed, you can simply leave it unpaid. There is no obligation to attend or pay.</p>${buttons}<p>The “I’ll pay at the studio” button opens your class selection. Sign in and select “I’ll pay on arrival” to save your preference. This choice does not reserve a seat; please arrive early to pay before class.</p>` : '<p>Your listed class payments have been received. No additional payment is requested for these confirmed dates. We look forward to seeing you!</p>'}${paid.length && unpaid.length ? '<p>Dates marked “Payment received · confirmed” are already paid. Please do not pay for them again.</p>' : ''}${entries.some(row => /\bballet\b/i.test(row.session.title)) ? '<p><strong>Ballet sibling offer:</strong> 20% off the second and each additional child in the same family for the same class date. Complete the first child’s payment, then select the next child to see the discount.</p>' : ''}<p>Questions or a change of plans? Reply to this email — we’re happy to help.</p><p>See you soon,<br>Sojung &amp; Little Wanderers</p><p><a href="${escape(new URL('/classes',input.siteUrl).toString())}">View the class schedule</a></p></main></body></html>`;
    messages.push({ householdId, to: household.email.trim(), subject: 'Your Little Wanderers classes start this week — payment & arrival options', html,
      registrationIds: entries.map(row => row.registration.id), registrationStates: entries.map(row => ({ id: row.registration.id, status: row.registration.status })), unpaidCount: unpaid.length, paidCount: paid.length,
      classTitles: [...new Set(entries.map(row => row.session.title))] });
  }
  return { messages, issues, registrationCount: messages.reduce((sum, message) => sum + message.registrationIds.length, 0) };
}
