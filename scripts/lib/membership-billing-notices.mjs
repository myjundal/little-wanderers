import { createHash } from 'node:crypto';

export const NOTICE_VERSION = 'membership-billing-start-v1';
export const AUTOMATION_START_DATE = '2026-11-13';
const activeStatuses = new Set(['pending', 'activating', 'scheduled', 'active']);
const prices = { waitlist: [5000, 1000], public: [5000, 2000], regular: [6000, 2000] };
export function easternParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = key => parts.find(p => p.type === key).value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}
export function noticeId(enrollmentId) {
  const h = createHash('sha256').update(`${NOTICE_VERSION}:${enrollmentId}`).digest('hex').slice(0, 32).split('');
  h[12] = '5'; h[16] = '8';
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
function birthdayPlusMonths(value, months) {
  const [year, month, day] = value.split('-').map(Number);
  const last = new Date(Date.UTC(year, month - 1 + months + 1, 0));
  return new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), Math.min(day, last.getUTCDate()))).toISOString().slice(0, 10);
}
export function monthlyCents(enrollment, on) {
  const births = [...(enrollment.birthdates || [])].sort();
  if (!prices[enrollment.pricing_tier] || !births.length || births.some(b => !/^\d{4}-\d{2}-\d{2}$/.test(b) || !Number.isFinite(Date.parse(b)) || new Date(b).toISOString().slice(0, 10) !== b || b > on)) throw Error('Invalid membership pricing or birthdays');
  const base = enrollment.base_cents ?? prices[enrollment.pricing_tier][0];
  const sibling = enrollment.sibling_cents ?? prices[enrollment.pricing_tier][1];
  if (![base, sibling].every(Number.isSafeInteger) || base <= 0 || sibling < 0) throw Error('Invalid membership price');
  return base + births.slice(1).filter(b => birthdayPlusMonths(b, 7) <= on).length * sibling;
}
export function planNotices({ enrollments, families, people, checkins, memberships = [], aliases = [], now = new Date(), immediateIds = [] }) {
  const local = easternParts(now);
  const immediate = new Set(immediateIds);
  const alias = new Map(aliases.map(a => [a.alias_household_id, a.canonical_household_id]));
  const root = id => { const seen = new Set(); while (alias.has(id) && !seen.has(id)) { seen.add(id); id = alias.get(id); } return id; };
  const latest = new Map();
  for (const e of [...enrollments].sort((a, b) => (b.created_at || b.consent_at || '').localeCompare(a.created_at || a.consent_at || ''))) if (e.environment === 'production' && !latest.has(root(e.household_id))) latest.set(root(e.household_id), e.id);
  const complimentary = new Set(memberships.filter(m => m.square_environment === 'production' && m.renews_at === null && !m.square_subscription_id && !m.square_customer_id && m.payment_review_required === false && !m.person_id && m.covered_person_ids?.length).map(m => root(m.household_id)));
  const peopleById = new Map(people.map(p => [p.id, p]));
  const candidates = [], review = [], skipped = [];
  for (const e of enrollments) {
    if (immediate.size && !immediate.has(e.id)) continue;
    const family = families.find(f => f.id === root(e.household_id)) || families.find(f => f.id === e.household_id);
    const label = { enrollment_id: e.id, family: family?.name || e.household_id };
    if (e.environment !== 'production' || latest.get(root(e.household_id)) !== e.id || !activeStatuses.has(e.status) || complimentary.has(root(e.household_id))) { skipped.push({ ...label, reason: 'inactive_or_complimentary' }); continue; }
    if (!e.consent_at || !Number.isFinite(Date.parse(e.consent_at)) || e.terms_version !== '2026-11-03-first-visit' || !e.square_card_id || !e.square_customer_id || !e.child_ids?.length || e.child_ids.length !== e.birthdates?.length) { review.push({ ...label, reason: 'enrollment_or_payment_authorization_incomplete' }); continue; }
    const consentDate = easternParts(new Date(e.consent_at)).date;
    const visits = checkins.filter(v => e.child_ids.includes(v.person_id) && peopleById.get(v.person_id)?.role === 'child' && root(v.household_id || peopleById.get(v.person_id)?.household_id) === root(e.household_id)
      && ['staff_manual', 'qr', 'manual', 'staff'].includes(v.source) && (v.square_environment == null || v.square_environment === 'production') && Number.isFinite(Date.parse(v.checked_in_at)) && Date.parse(v.checked_in_at) <= now.getTime()
      && easternParts(new Date(v.checked_in_at)).date >= consentDate).sort((a, b) => Date.parse(a.checked_in_at) - Date.parse(b.checked_in_at));
    if (!visits.length) { skipped.push({ ...label, reason: 'no_membership_child_visit' }); continue; }
    const firstVisit = easternParts(new Date(visits[0].checked_in_at)).date;
    if (!immediate.has(e.id) && (firstVisit > local.date || (firstVisit === local.date && local.hour < 20))) { skipped.push({ ...label, reason: 'not_8pm_yet' }); continue; }
    if (!immediate.has(e.id) && firstVisit < AUTOMATION_START_DATE) { skipped.push({ ...label, reason: 'historical_visit_requires_reviewed_batch' }); continue; }
    if (e.start_date && e.start_date < firstVisit) { skipped.push({ ...label, reason: 'billing_already_started_before_this_visit' }); continue; }
    if (!family?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(family.email.trim())) { review.push({ ...label, reason: 'missing_or_invalid_email' }); continue; }
    const children = e.child_ids.map(id => peopleById.get(id));
    if (children.some(p => !p || p.role !== 'child' || root(p.household_id) !== root(e.household_id))) { review.push({ ...label, reason: 'child_identity_needs_review' }); continue; }
    try {
      candidates.push({ ...label, id: noticeId(e.id), household_id: e.household_id, recipient: family.email.trim().toLowerCase(), children: children.map(p => [p.first_name, p.last_name].filter(Boolean).join(' ')), first_visit_date: firstVisit, amount_cents: monthlyCents(e, firstVisit), tier: e.pricing_tier });
    } catch { review.push({ ...label, reason: 'membership_price_needs_review' }); }
  }
  const counts = new Map();
  for (const c of candidates) counts.set(c.recipient, (counts.get(c.recipient) || 0) + 1);
  return { candidates: candidates.filter(c => { if (counts.get(c.recipient) === 1) return true; review.push({ enrollment_id: c.enrollment_id, family: c.family, reason: 'same_recipient_multiple_memberships' }); return false; }), review, skipped };
}
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export function emailPayload(notice, from) {
  const amount = `$${(notice.amount_cents / 100).toFixed(2)}`;
  const visit = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' }).format(new Date(`${notice.first_visit_date}T12:00:00Z`));
  const text = `Hello,\n\nThank you for visiting Little Wanderers! We’re beginning your monthly membership billing following your first membership visit.\n\nChildren: ${notice.children.join(', ')}\nFirst membership visit: ${visit}\nMonthly membership rate: ${amount}\n\nYour membership renews monthly until you cancel. You can cancel at any time with no commitment.${notice.tier !== 'regular' ? ' Your enrolled founding rates remain locked in while your membership stays continuously active.' : ''}\n\nWe’ll process your membership payment through Square. You’ll receive a separate Square receipt once payment has been processed.\n\nIf you have any questions or need to update your payment details, simply reply to this email.\n\nThank you for being part of Little Wanderers!\nLittle Wanderers`;
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#3f355a;line-height:1.6;margin:0;padding:28px"><main style="max-width:600px;margin:auto"><h1 style="font-size:22px;color:#5f3da4">Your Little Wanderers membership</h1>${text.split('\n\n').map(p => `<p>${escape(p).replaceAll('\n', '<br>')}</p>`).join('')}</main></body></html>`;
  return { from, to: [notice.recipient], subject: `Your Little Wanderers membership billing — ${amount}/month`, text, html };
}

// A deterministic database event claims each enrollment once. The exact payload
// and provider idempotency key survive retries and future changes to this code.
export async function deliverNotice({ notice, from, store, send, now = new Date() }) {
  const id = notice.id;
  let row = await store.get(id);
  if (!row) {
    const initial = { version: NOTICE_VERSION, state: 'queued', enrollment_id: notice.enrollment_id, first_visit_date: notice.first_visit_date, amount_cents: notice.amount_cents, payload: emailPayload(notice, from), idempotency_key: `lw-membership-start-${notice.enrollment_id}`, first_attempt_at: null, lease_until: null };
    await store.insert(id, notice.household_id, JSON.stringify(initial));
    row = await store.get(id);
    if (!row) throw Error('Unable to read notification claim');
  }
  const state = JSON.parse(row.notes);
  if (state.version !== NOTICE_VERSION || state.enrollment_id !== notice.enrollment_id) throw Error('Notification identity mismatch');
  if (state.state === 'sent') return { status: 'already_sent', id, provider_id: state.provider_id };
  if (state.state === 'review') return { status: 'review', id, reason: state.reason };
  if (state.lease_until && Date.parse(state.lease_until) > now.getTime()) return { status: 'in_progress', id };
  if (state.first_attempt_at && now.getTime() - Date.parse(state.first_attempt_at) >= 23 * 3600000) {
    await store.cas(id, row.notes, JSON.stringify({ ...state, state: 'review', reason: 'uncertain_delivery_outside_provider_deduplication_window' }));
    return { status: 'review', id, reason: 'uncertain_delivery_outside_provider_deduplication_window' };
  }
  const claimed = { ...state, state: 'sending', first_attempt_at: state.first_attempt_at || now.toISOString(), lease_until: new Date(now.getTime() + 600000).toISOString() };
  const claimNotes = JSON.stringify(claimed);
  if (!await store.cas(id, row.notes, claimNotes)) return { status: 'in_progress', id };
  let delivered;
  try { delivered = await send(claimed.payload, claimed.idempotency_key); }
  catch {
    // Retain the same key and body after an uncertain network result.
    return { status: 'retry', id, reason: 'provider_response_uncertain' };
  }
  if (!delivered.ok || !delivered.id) {
    const retryable = delivered.retryable === true;
    await store.cas(id, claimNotes, JSON.stringify({ ...claimed, state: retryable ? 'sending' : 'review', reason: delivered.error || 'email_provider_error' }));
    return { status: retryable ? 'retry' : 'review', id, reason: delivered.error || 'email_provider_error' };
  }
  const saved = await store.cas(id, claimNotes, JSON.stringify({ ...claimed, state: 'sent', sent_at: now.toISOString(), provider_id: delivered.id, lease_until: null }));
  if (!saved) throw Error('Provider accepted email, but durable confirmation needs retry');
  return { status: 'sent', id, provider_id: delivered.id };
}
