import { planNotices, deliverNotice, emailPayload } from '../../scripts/lib/membership-billing-notices.mjs';

export async function runMembershipBillingNotices({ db, mode = 'preview', ids = [], expectedTotalCents = undefined, now = new Date(), maxMessages = 20 }) {
const startedAt = Date.now();
const sendDue = mode === 'send_due';
const sendReviewed = mode === 'send_reviewed';
if (!['preview', 'send_due', 'send_reviewed'].includes(mode)) throw Error('Invalid notification mode');
if (sendReviewed && !ids.length) throw Error('Reviewed send needs explicit enrollment IDs');
const ok = result => { if (result.error) throw Error(result.error.message); return result.data; };
async function pages(table, fields, filter = q => q) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = ok(await filter(db.from(table).select(fields)).order('id').range(offset, offset + 499));
    rows.push(...page);
    if (page.length < 500) return rows;
    if (rows.length >= 30000) throw Error('Source needs a narrower query');
  }
}
const enrollments = await pages('founding_memberships', '*', q => q.eq('environment', 'production'));
const memberships = await pages('memberships', '*');
const aliases = ok(await db.from('staff_family_search_aliases').select('*'));
const householdIds = new Set([...enrollments.map(e => e.household_id), ...memberships.filter(m => m.square_environment === 'production').map(m => m.household_id)].filter(Boolean));
const individualIds = memberships.filter(m => m.square_environment === 'production' && m.person_id && !m.household_id).map(m => m.person_id);
if (individualIds.length) for (const p of ok(await db.from('people').select('household_id').in('id', individualIds))) householdIds.add(p.household_id);
for (let pass = 0; pass < aliases.length; pass++) for (const a of aliases) if (householdIds.has(a.canonical_household_id) || householdIds.has(a.alias_household_id)) { householdIds.add(a.alias_household_id); householdIds.add(a.canonical_household_id); }
const families = [], people = [], checkins = [];
const familyIds = [...householdIds];
for (let offset = 0; offset < familyIds.length; offset += 100) {
  const chunk = familyIds.slice(offset, offset + 100);
  families.push(...await pages('households', 'id,name,email', q => q.in('id', chunk)));
  people.push(...await pages('people', 'id,household_id,first_name,last_name,role', q => q.in('household_id', chunk)));
}
for (let offset = 0; offset < people.length; offset += 150) checkins.push(...await pages('checkins', 'id,person_id,household_id,checked_in_at,source,square_environment', q => q.in('person_id', people.slice(offset, offset + 150).map(p => p.id)).gte('checked_in_at', '2026-11-11T05:00:00Z')));
const plan = planNotices({ enrollments, families, people, checkins, memberships, aliases, now, immediateIds: ids });
if (!ids.length) {
  const reviewed = new Set();
  for (const m of memberships) {
    const familyId = m.household_id || people.find(p => p.id === m.person_id)?.household_id;
    const complimentary = m.renews_at === null && !m.square_subscription_id && !m.square_customer_id && m.payment_review_required === false && !m.person_id && m.covered_person_ids?.length;
    if (!familyId || m.square_environment !== 'production' || complimentary || (m.renews_at && Date.parse(m.renews_at) <= now.getTime()) || enrollments.some(e => e.household_id === familyId && ['pending', 'activating', 'scheduled', 'active'].includes(e.status)) || reviewed.has(familyId)) continue;
    const visited = checkins.some(v => (v.household_id || people.find(p => p.id === v.person_id)?.household_id) === familyId && people.find(p => p.id === v.person_id)?.role === 'child');
    if (visited) { plan.review.push({ family: families.find(f => f.id === familyId)?.name || familyId, reason: 'general_membership_needs_verified_rate_and_billing_terms' }); reviewed.add(familyId); }
  }
}
const from = process.env.RESEND_FROM_EMAIL;
if (!from || /onboarding@resend.dev/.test(from)) throw Error('Verified business sender unavailable');
const expected = expectedTotalCents;
if (sendReviewed && (plan.candidates.length !== ids.length || (expected && plan.candidates.reduce((s, c) => s + c.amount_cents, 0) !== Number(expected)))) throw Error('Reviewed recipient list or total changed; preview before sending');
const store = {
  get: async id => ok(await db.from('membership_events').select('id,notes').eq('id', id).maybeSingle()),
  insert: async (id, household, notes) => {
    const r = await db.from('membership_events').insert({ id, household_id: household, action: 'billing_start_email_notice', notes, created_by_user_id: '5054a175-2ba6-4023-a289-a9b0635ccc5f', created_by_role: 'owner' });
    if (r.error && r.error.code !== '23505') throw Error(r.error.message);
  },
  cas: async (id, previous, notes) => Boolean(ok(await db.from('membership_events').update({ notes }).eq('id', id).eq('notes', previous).select('id').maybeSingle())),
};
const providerSend = async (payload, key) => {
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  return { ok: response.ok, id: body.id, error: body.name || `http_${response.status}`, retryable: response.status === 429 || response.status >= 500 || (response.status === 409 && body.name === 'concurrent_idempotent_requests') };
};
if ((sendDue || sendReviewed) && !process.env.RESEND_API_KEY) throw Error('Email transport unavailable');
const results = [];
let attempts = 0;
for (const notice of plan.candidates) {
  if (Date.now() - startedAt > 40000) break;
  const prior = await store.get(notice.id);
  if (!sendDue && !sendReviewed) {
    results.push({ family: notice.family, enrollment_id: notice.enrollment_id, recipient: notice.recipient, first_visit_date: notice.first_visit_date, amount_cents: notice.amount_cents, already_sent: prior ? JSON.parse(prior.notes).state === 'sent' : false, preview: emailPayload(notice, from).text });
    continue;
  }
  if (prior && JSON.parse(prior.notes).state === 'sent') { results.push({ enrollment_id: notice.enrollment_id, status: 'already_sent' }); continue; }
  if (attempts >= maxMessages) break;
  attempts++;
  try { results.push({ family: notice.family, enrollment_id: notice.enrollment_id, recipient: notice.recipient, amount_cents: notice.amount_cents, ...await deliverNotice({ notice, from, store, send: providerSend }) }); }
  catch (error) { results.push({ family: notice.family, enrollment_id: notice.enrollment_id, status: 'error', reason: error.message }); }
  await new Promise(resolve => setTimeout(resolve, 600));
}
return { mode, checked_at: now.toISOString(), results, review: plan.review, skipped: plan.skipped, pending: Math.max(0, plan.candidates.length - results.length), chargesExecuted: false };

}
