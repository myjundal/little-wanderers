import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { squareConfig, squareRequest, squareSiteUrl, type SquareOrder } from '@/lib/square-client';
import { sendResendEmail } from '@/lib/email-campaigns';
import { closeClassCheckout, type ClassCheckout } from '@/lib/class-checkout';
import { classChoiceNotificationEmail } from '@/lib/admin-notifications';

export const MINIMUM_CLASS_REGISTRATIONS = 3;
const ACTION = 'class_minimum_cancellation';
const OWNER = '5054a175-2ba6-4023-a289-a9b0635ccc5f';
type Session = { id: string; title: string; status: string; start_time: string; end_time: string | null; capacity: number | null; price_cents: number; schedule_note: string | null };
type Registration = { id: string; class_id: string; person_id: string; household_id: string; status: string; created_by_user_id: string };
export type ClassCancellation = { version: 1; class_id: string; title: string; start_time: string; registration_id: string; person_id: string; household_id: string;
  checkout_id: string; amount_cents: number; recipient: string; target_class_id: string | null; target_start_time: string | null;
  state: 'pending' | 'transfer' | 'refund' | 'transferred' | 'refunded'; email_started_at?: string; processing_until?: string; sent_at?: string; email_id?: string; decided_at?: string; target_registration_id?: string; refund_id?: string; refund_status?: string; hold_id?: string;
  owner_notice?: { payload: ReturnType<typeof classChoiceNotificationEmail>; started_at: string; lease_until?: string; sent_at?: string; email_id?: string } };
type Event = { id: string; notes: string; household_id: string };
const checked = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw Error(r.error.message); return r.data; };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const classCancellationTime = (s: string) => new Date(s).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const money = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
function eventId(registration: string, classId: string) { const h = createHash('sha256').update(`class-minimum:v1:${registration}:${classId}`).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; }
function key() { if (!process.env.RESEND_API_KEY) throw Error('Class notice transport is unavailable.'); return process.env.RESEND_API_KEY; }
export function classCancellationTriggerToken() { return createHmac('sha256', key()).update('little-wanderers:class-minimum:trigger:v1').digest('hex'); }
export function authorizeClassCancellationTrigger(req: Request) { try { const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('authorization') || '')?.[1]; return Boolean(token && timingSafeEqual(Buffer.from(token), Buffer.from(classCancellationTriggerToken()))); } catch { return false; } }
export function classCancellationToken(id: string) { return id + '.' + createHmac('sha256', key()).update('little-wanderers:class-choice:v1:' + id).digest('hex'); }
export async function readClassCancellation(db: SupabaseClient, token: unknown) {
  if (typeof token !== 'string' || !/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token)) throw Error('This class options link is invalid.');
  const id = token.slice(0,36), expected = classCancellationToken(id);
  if (!timingSafeEqual(Buffer.from(token), Buffer.from(expected))) throw Error('This class options link is invalid.');
  const event = checked(await db.from('membership_events').select('id,notes,household_id').eq('id', id).eq('action', ACTION).maybeSingle()) as Event | null;
  if (!event) throw Error('This class options link is no longer available.');
  return { event, notice: JSON.parse(event.notes) as ClassCancellation };
}
async function save(db: SupabaseClient, event: Event, notice: ClassCancellation) {
  const notes = JSON.stringify(notice);
  const changed = checked(await db.from('membership_events').update({ notes }).eq('id', event.id).eq('notes', event.notes).select('id').maybeSingle());
  if (!changed) throw Error('Your selection is being processed. Please refresh and try again.');
  event.notes = notes;
}
function parseEvent(e: Event) { return JSON.parse(e.notes) as ClassCancellation; }

/** Durable, keyed owner alert; mail failures never undo the customer's completed choice. */
export async function notifyClassCancellationOwner(db: SupabaseClient, id: string) {
  const event = checked(await db.from('membership_events').select('id,notes,household_id').eq('id', id).eq('action', ACTION).single()) as Event;
  const n = parseEvent(event);
  if (n.state !== 'transferred' && n.state !== 'refunded') return false;
  if (n.owner_notice?.sent_at) return true;
  if (n.owner_notice?.lease_until && Date.parse(n.owner_notice.lease_until) > Date.now()) return false;
  if (n.owner_notice && Date.now() - Date.parse(n.owner_notice.started_at) > 23 * 3600_000) throw Error('Owner notification delivery needs review before retrying.');
  let notice = n.owner_notice;
  if (!notice) {
    const family = checked(await db.from('households').select('name').eq('id', n.household_id).single());
    const child = checked(await db.from('people').select('first_name,last_name').eq('id', n.person_id).eq('household_id', n.household_id).single());
    notice = { started_at: new Date().toISOString(), payload: classChoiceNotificationEmail({
      eventId: event.id, outcome: n.state, familyName: family?.name || null, familyEmail: n.recipient,
      childName: [child?.first_name, child?.last_name].filter(Boolean).join(' ') || null,
      classTitle: n.title, originalStart: n.start_time, targetStart: n.target_start_time,
      amountCents: n.amount_cents, refundStatus: n.refund_status, decidedAt: n.decided_at,
    }) };
  }
  const claimed = { ...n, owner_notice: { ...notice, lease_until: new Date(Date.now() + 120_000).toISOString() } };
  await save(db, event, claimed);
  try {
    const result = await sendResendEmail(claimed.owner_notice.payload);
    if (!result.ok || !('id' in result) || !result.id) throw Error('Owner notification delivery pending.');
    await save(db, event, { ...claimed, owner_notice: { ...claimed.owner_notice, lease_until: undefined, sent_at: new Date().toISOString(), email_id: result.id } });
    return true;
  } catch (error) {
    // Retain the frozen payload/key if a provider response or final save is uncertain.
    try { await save(db, event, { ...claimed, owner_notice: { ...claimed.owner_notice, lease_until: undefined } }); } catch { /* Another retry will re-read the durable state. */ }
    throw error;
  }
}
async function tryNotifyOwner(db: SupabaseClient, id: string) {
  try { return await notifyClassCancellationOwner(db, id); }
  catch { console.error('class_choice_owner_notification_pending', id); return false; }
}
async function events(db: SupabaseClient) {
  const rows = checked(await db.from('membership_events').select('id,notes,household_id').eq('action', ACTION).order('created_at').limit(1000)) as Event[];
  if (rows.length === 1000) throw Error('Class cancellation history requires pagination.');
  return rows;
}
export function classMinimumDue(session: Pick<Session, 'start_time'>, now = new Date()) {
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(now));
  return day(new Date(session.start_time)) === day(now) && hour >= 7 && Date.parse(session.start_time) > now.getTime();
}
function paidClassAmount(checkout: ClassCheckout, classId: string, personId: string) {
  if (checkout.status !== 'completed' || checkout.payload.request.person_id !== personId) throw Error('Class payment requires staff review.');
  const index = checkout.payload.request.items.findIndex(i => i.class_id === classId && i.quantity === 1);
  const lines = (checkout.payload.provider_request?.order as { line_items?: Array<{ quantity: string; base_price_money: { amount: number; currency: string } }> })?.line_items;
  if (index < 0 || !lines || lines.length !== checkout.payload.request.items.length || lines.some(l => l.quantity !== '1' || l.base_price_money.currency !== 'USD')
    || lines.reduce((s, l) => s + l.base_price_money.amount, 0) !== checkout.expected_amount_cents) throw Error('Selected-date payment allocation needs review.');
  let amount = lines[index].base_price_money.amount;
  const sibling = (checkout.payload as unknown as { sibling_refund?: { class_id: string; person_id: string; amount_cents: number } }).sibling_refund;
  if (sibling?.class_id === classId && sibling.person_id === personId) amount -= sibling.amount_cents;
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Error('Class refund amount requires staff review.');
  return amount;
}
async function paidSource(db: SupabaseClient, reg: Registration, history: Event[]) {
  const moved = history.map(parseEvent).find(n => n.state === 'transferred' && n.target_registration_id === reg.id && n.target_class_id === reg.class_id);
  if (moved) return { checkoutId: moved.checkout_id, amount: moved.amount_cents };
  const cfg = squareConfig();
  const rows = checked(await db.from('square_checkout_attempts').select('*').eq('household_id', reg.household_id).eq('kind', 'class').eq('environment', cfg.environment).eq('status', 'completed')) as ClassCheckout[];
  const matches = rows.filter(a => a.payload.assignments.some(x => x.class_id === reg.class_id && x.person_id === reg.person_id));
  if (matches.length !== 1) throw Error('Exactly one verified class payment is required for cancellation options.');
  return { checkoutId: matches[0].id, amount: paidClassAmount(matches[0], reg.class_id, reg.person_id) };
}
export function classCancellationEmail(id: string, n: ClassCancellation) {
  const base = new URL('/class-options', squareSiteUrl()); base.searchParams.set('token', classCancellationToken(id));
  const link = (choice: string) => { const u = new URL(base); u.searchParams.set('choice', choice); return u.toString(); };
  const button = (url: string, label: string, color: string) => `<a href="${escape(url)}" style="display:inline-block;padding:14px 20px;margin:6px 8px 6px 0;background:${color};color:white;text-decoration:none;border-radius:10px;font-weight:bold">${escape(label)}</a>`;
  return { to: n.recipient, subject: `${n.title}: class cancelled — choose next week or a refund`, idempotencyKey: `class-minimum-${id}`,
    html: `<!doctype html><html><body style="font:16px/1.6 Arial,sans-serif;color:#3f355a;padding:24px"><main style="max-width:620px;margin:auto"><h1 style="font-size:24px">A change to your class</h1><p>Hi there,</p><p>We're sorry, but <strong>${escape(n.title)} on ${escape(classCancellationTime(n.start_time))} (Eastern)</strong> is cancelled because fewer than 3 children have confirmed registration. We need at least 3 children to run this class.</p><p>Please choose the option that works best for your family:</p>${n.target_start_time ? `<p><strong>Move to next week:</strong> ${escape(classCancellationTime(n.target_start_time))} (Eastern). Your ${money(n.amount_cents)} payment will carry over, with no additional charge. The new date is subject to space and the same 3-child minimum.</p>${button(link('transfer'), 'Move to next week', '#604290')}` : '<p>There is no available class next week, so a refund is available.</p>'}<p><strong>Refund:</strong> Receive ${money(n.amount_cents)} for this cancelled class back to your original payment method. Any other classes in your purchase are unchanged. Your bank may take time to post the refund.</p>${button(link('refund'), `Get a ${money(n.amount_cents)} refund`, '#486a67')}<p>The buttons open a confirmation page. Nothing changes until you confirm your choice, and we will not move your booking without your selection.</p><p>For future regular drop-in classes, we check confirmed registration at 7:00 AM Eastern on the day of class. If fewer than 3 children are registered, the class is cancelled and we'll email the same transfer or refund options.</p><p>Thank you for understanding. Reply to this email if you need help.<br>Sojung &amp; Little Wanderers</p></main></body></html>` };
}
export async function runClassMinimumCancellations(db: SupabaseClient, input: { dryRun: boolean; classId?: string; now?: Date }) {
  const now = input.now ?? new Date();
  const cfg = squareConfig();
  const sessions = checked(await db.from('classes').select('*').eq('status', 'scheduled').gte('start_time', now.toISOString()).order('start_time').limit(200)) as Session[];
  const programs = checked(await db.from('class_series_programs').select('class_ids')) ?? [];
  const seriesIds = new Set(programs.flatMap(p => p.class_ids as string[]));
  const candidates = sessions.filter(c => !seriesIds.has(c.id) && (input.classId ? c.id === input.classId : classMinimumDue(c, now)));
  const history = await events(db); const failures: string[] = []; const results: Array<Record<string, unknown>> = [];
  for (const session of candidates) {
    try {
    const initial = checked(await db.from('class_registrations').select('id,status').eq('class_id', session.id).in('status', ['scheduled', 'attended'])) ?? [];
    if (initial.length >= 3 || initial.some(r => r.status === 'attended')) { results.push({ class_id: session.id, action: 'run', confirmed: initial.length }); continue; }
    // Close in-flight payment links before deciding: a racing completed payment must count.
    if (!input.dryRun) {
      const open = checked(await db.from('square_checkout_attempts').select('*').eq('kind', 'class').eq('environment', cfg.environment).in('status', ['creating', 'open'])) as ClassCheckout[];
      for (const a of open.filter(a => a.payload.assignments.some(r => r.class_id === session.id))) await closeClassCheckout(db, a);
    }
    let regs = checked(await db.from('class_registrations').select('*').eq('class_id', session.id).in('status', ['scheduled', 'attended'])) as Registration[];
    if (regs.length >= MINIMUM_CLASS_REGISTRATIONS || regs.some(r => r.status === 'attended')) { results.push({ class_id: session.id, action: 'run', confirmed: regs.length }); continue; }
    const next = sessions.find(c => c.title === session.title && !seriesIds.has(c.id) && c.id !== session.id &&
      new Date(c.start_time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === new Date(Date.parse(session.start_time) + 7 * 86400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
    const makeNotice = async (reg: Registration) => {
      const source = await paidSource(db, reg, history);
      const family = checked(await db.from('households').select('email').eq('id', reg.household_id).single());
      if (!family?.email) throw Error('A confirmed family has no email.');
      const notice: ClassCancellation = { version: 1, class_id: session.id, title: session.title, start_time: session.start_time, registration_id: reg.id, person_id: reg.person_id, household_id: reg.household_id, checkout_id: source.checkoutId, amount_cents: source.amount, recipient: family.email, target_class_id: next?.id ?? null, target_start_time: next?.start_time ?? null, state: 'pending' };
      return { id: eventId(reg.id, session.id), notice };
    };
    const notices: Array<{ id: string; notice: ClassCancellation }> = [];
    for (const reg of regs) {
      const prior = history.find(e => e.id === eventId(reg.id, session.id)); if (prior) continue;
      notices.push(await makeNotice(reg));
    }
    results.push({ class_id: session.id, action: 'cancel', confirmed: regs.length, notices: notices.length });
    if (input.dryRun) continue;
    // Persist the durable outbox before hiding the occurrence; a retry can recover either step.
    for (const n of notices) { const r = await db.from('membership_events').insert({ id: n.id, household_id: n.notice.household_id, action: ACTION, notes: JSON.stringify(n.notice), created_by_user_id: OWNER, created_by_role: 'owner' }); if (r.error && r.error.code !== '23505') throw Error(r.error.message); }
    const changed = checked(await db.from('classes').update({ status: 'cancelled', schedule_note: `${session.schedule_note || ''} Cancelled: fewer than 3 confirmed registrations. Families may choose next week or a refund.`.trim() }).eq('id', session.id).eq('status', 'scheduled').select('id').maybeSingle());
    if (changed) {
      regs = checked(await db.from('class_registrations').select('*').eq('class_id', session.id).in('status', ['scheduled', 'attended'])) as Registration[];
      // A checkout that won the class row lock just before cancellation still counts.
      if (regs.length >= 3 || regs.some(r => r.status === 'attended')) { checked(await db.from('classes').update({ status: 'scheduled', schedule_note: session.schedule_note }).eq('id', session.id).eq('status', 'cancelled')); results.push({ class_id: session.id, action: 'retained_after_payment_race' }); }
      else for (const reg of regs) {
        if (notices.some(n => n.notice.registration_id === reg.id) || history.some(e => e.id === eventId(reg.id, session.id))) continue;
        const extra = await makeNotice(reg);
        const added = await db.from('membership_events').insert({ id: extra.id, household_id: reg.household_id, action: ACTION, notes: JSON.stringify(extra.notice), created_by_user_id: OWNER, created_by_role: 'owner' });
        if (added.error && added.error.code !== '23505') throw Error(added.error.message);
      }
    }
    } catch (error) { console.error('class_minimum_session_failed', session.id, error instanceof Error ? error.message : 'Unknown failure'); failures.push(session.id); }
  }
  if (!input.dryRun) for (const event of await events(db)) {
    const n = parseEvent(event);
    if (['transfer', 'refund'].includes(n.state) && (!n.processing_until || Date.parse(n.processing_until) <= Date.now()) || n.state === 'transferred' && n.hold_id) {
      try { await chooseClassCancellation(db, classCancellationToken(event.id), n.state === 'refund' ? 'refund' : 'transfer'); } catch { failures.push(event.id); }
    }
  }
  let sent = 0;
  if (!input.dryRun) for (const event of await events(db)) {
    const n = parseEvent(event); if (n.sent_at || n.state !== 'pending') continue;
    const c = checked(await db.from('classes').select('status').eq('id', n.class_id).single()); if (c?.status !== 'cancelled') continue;
    try { if (n.email_started_at && Date.now() - Date.parse(n.email_started_at) > 23 * 3600_000) throw Error('Email delivery needs review before resending.'); if (!n.email_started_at) { n.email_started_at = new Date().toISOString(); await save(db, event, n); } const email = await sendResendEmail(classCancellationEmail(event.id, n)); if (!email.ok || !('id' in email) || !email.id) throw Error('Class cancellation email was not accepted.'); await save(db, event, { ...n, sent_at: new Date().toISOString(), email_id: email.id }); sent++; }
    catch { failures.push(event.id); }
  }
  if (!input.dryRun) for (const event of await events(db)) {
    const n = parseEvent(event);
    if ((n.state === 'transferred' || n.state === 'refunded') && !n.owner_notice?.sent_at) {
      if (!await tryNotifyOwner(db, event.id)) failures.push(event.id);
    }
  }
  return { ok: !failures.length, dry_run: input.dryRun, checked_at: now.toISOString(), results, sent, failures };
}

type Payment = { id: string; order_id: string; location_id: string; status: string; amount_money: { amount: number; currency: string }; refunded_money?: { amount: number }; refund_ids?: string[] };
type Refund = { id: string; payment_id: string; status: string; reason?: string; amount_money: { amount: number; currency: string } };
async function refundClass(db: SupabaseClient, event: Event, n: ClassCancellation) {
  const a = checked(await db.from('square_checkout_attempts').select('*').eq('id', n.checkout_id).eq('status', 'completed').single()) as ClassCheckout;
  const cfg = squareConfig(); if (a.household_id !== n.household_id || a.environment !== cfg.environment || a.location_id !== cfg.locationId || !a.order_id) throw Error('Payment ownership needs review.');
  const { order } = await squareRequest<{ order: SquareOrder }>(`/v2/orders/${encodeURIComponent(a.order_id)}`);
  if (order.id !== a.order_id || order.location_id !== cfg.locationId || order.reference_id !== a.id || order.tenders?.length !== 1 || !order.tenders[0].payment_id || order.total_money?.currency !== 'USD' || order.total_money.amount !== a.expected_amount_cents) throw Error('Payment order needs review.');
  const { payment } = await squareRequest<{ payment: Payment }>(`/v2/payments/${encodeURIComponent(order.tenders[0].payment_id)}`);
  if (payment.id !== order.tenders[0].payment_id || payment.order_id !== a.order_id || payment.location_id !== cfg.locationId || payment.status !== 'COMPLETED' || payment.amount_money.currency !== 'USD' || payment.amount_money.amount !== a.expected_amount_cents) throw Error('Payment needs review.');
  const reason = `Cancelled class ${event.id}`; let refund: Refund | undefined;
  for (const id of payment.refund_ids ?? []) {
    const r = (await squareRequest<{ refund: Refund }>(`/v2/refunds/${encodeURIComponent(id)}`)).refund;
    if (r.payment_id !== payment.id) throw Error('Refund ownership needs review.');
    if (r.reason === reason) refund = r;
    else if (['PENDING', 'COMPLETED'].includes(r.status) && !r.reason?.startsWith('Cancelled class ') && !r.reason?.startsWith('Ballet sibling discount 20%:')) throw Error('An earlier refund needs staff review before another refund.');
  }
  if (!refund) {
    if (payment.amount_money.amount - (payment.refunded_money?.amount ?? 0) < n.amount_cents) throw Error('The refundable balance needs staff review.');
    refund = (await squareRequest<{ refund: Refund }>('/v2/refunds', 'POST', { idempotency_key: `lw-class-cancel-${event.id}`, payment_id: payment.id, amount_money: { amount: n.amount_cents, currency: 'USD' }, reason })).refund;
  }
  if (!refund?.id || refund.payment_id !== payment.id || !['PENDING', 'COMPLETED'].includes(refund.status) || refund.amount_money.currency !== 'USD' || refund.amount_money.amount !== n.amount_cents) throw Error('The refund needs staff review. Please reply to your cancellation email.');
  checked(await db.from('class_registrations').update({ status: 'cancelled', attendance_status: 'cancelled' }).eq('id', n.registration_id).eq('class_id', n.class_id).eq('household_id', n.household_id));
  await save(db, event, { ...n, state: 'refunded', refund_id: refund.id, refund_status: refund.status });
}
async function transferClass(db: SupabaseClient, event: Event, n: ClassCancellation) {
  if (!n.target_class_id) throw Error('There is no class next week. Please choose a refund.');
  const target = checked(await db.from('classes').select('*').eq('id', n.target_class_id).single()) as Session;
  if (target.status !== 'scheduled' || Date.parse(target.start_time) <= Date.now() || target.title !== n.title) throw Error('Next week is no longer available. Please reply to your email for help or choose a refund.');
  const existing = checked(await db.from('class_registrations').select('id,status').eq('class_id', target.id).eq('person_id', n.person_id).maybeSingle());
  if (existing && ['scheduled','attended'].includes(existing.status) && existing.id !== n.target_registration_id) throw Error('Your child already has this date booked. Please choose a refund for the cancelled date.');
  const source = checked(await db.from('class_registrations').select('created_by_user_id').eq('id', n.registration_id).single());
  if (!source?.created_by_user_id) throw Error('Registration owner needs review.');
  let holdId = n.hold_id;
  if (!existing || existing.id !== n.target_registration_id || !['scheduled', 'attended'].includes(existing.status)) {
    // Reuse the installed atomic class seat hold; no Square order, payment link or charge is created.
    const cfg = squareConfig();
    const hold = checked(await db.rpc('prepare_square_checkout', { p_household: n.household_id, p_user: source.created_by_user_id, p_role: 'customer', p_kind: 'class', p_environment: cfg.environment, p_location: cfg.locationId,
      p_request: { person_id: n.person_id, items: [{ class_id: target.id, quantity: 1 }], class_transfer_event_id: event.id } })) as ClassCheckout;
    if (hold.order_id || hold.payment_link_id || hold.payload.provider_request || hold.status !== 'creating' || hold.payload.request.person_id !== n.person_id || hold.payload.request.items.length !== 1 || hold.payload.request.items[0].class_id !== target.id) throw Error('Please finish your pending class checkout before moving this booking.');
    holdId = hold.id;
    const marked = checked(await db.from('square_checkout_attempts').update({ payload: { ...hold.payload, class_transfer_event_id: event.id } }).eq('id', hold.id).eq('status','creating').is('order_id',null).select('id').maybeSingle());
    if (!marked) throw Error('Unable to reserve next week. Please retry.');
    const targetId = existing?.id ?? eventId(n.registration_id, target.id);
    n = { ...n, target_registration_id: targetId, hold_id: holdId }; await save(db, event, n);
    const row = existing ? checked(await db.from('class_registrations').update({ status: 'scheduled', attendance_status: 'unknown' }).eq('id', existing.id).in('status', ['preregistered','cancelled']).select('id').single()) :
      checked(await db.from('class_registrations').insert({ id: targetId, class_id: target.id, person_id: n.person_id, child_id: n.person_id, household_id: n.household_id, status: 'scheduled', created_by_user_id: source.created_by_user_id, created_by_role: 'customer' }).select('id').single());
    if (!row?.id) throw Error('Unable to complete the reserved registration. Please retry.');
  }
  const liveTarget = checked(await db.from('classes').select('status').eq('id', target.id).single());
  if (liveTarget?.status !== 'scheduled') {
    checked(await db.from('class_registrations').update({ status: 'cancelled' }).eq('id', n.target_registration_id).eq('status', 'scheduled'));
    throw Error('Next week is no longer available. Please choose a refund.');
  }
  checked(await db.from('class_registrations').update({ status: 'cancelled', attendance_status: 'cancelled' }).eq('id', n.registration_id).eq('class_id', n.class_id).eq('household_id', n.household_id));
  await save(db, event, { ...n, state: 'transferred' });
  if (holdId) checked(await db.from('square_checkout_attempts').update({ status: 'cancelled' }).eq('id', holdId).eq('status', 'creating').is('order_id', null).is('payload->provider_request', null));
}
export async function chooseClassCancellation(db: SupabaseClient, token: unknown, choice: unknown) {
  if (choice !== 'transfer' && choice !== 'refund') throw Error('Choose next week or a refund.');
  const { event, notice } = await readClassCancellation(db, token); let n = notice;
  if (n.state === 'transferred' || n.state === 'refunded') { if (n.hold_id) checked(await db.from('square_checkout_attempts').update({ status: 'cancelled' }).eq('id', n.hold_id).eq('status','creating').is('order_id', null).is('payload->provider_request',null)); await tryNotifyOwner(db, event.id); return n; }
  if (n.processing_until && Date.parse(n.processing_until) > Date.now()) throw Error('Your selection is being processed. Please refresh in a moment.');
  if (n.state !== 'pending' && n.state !== choice) throw Error('Your first selection is already being processed. Please refresh.');
  if (n.state === 'pending' && choice === 'transfer') {
    if (!n.target_class_id) throw Error('There is no class next week. Please choose a refund.');
    const target = checked(await db.from('classes').select('status,start_time').eq('id', n.target_class_id).single());
    const booking = checked(await db.from('class_registrations').select('status').eq('class_id', n.target_class_id).eq('person_id', n.person_id).maybeSingle());
    if (!target || target.status !== 'scheduled' || Date.parse(target.start_time) <= Date.now()) throw Error('Next week is no longer available. Please choose a refund.');
    if (booking && ['scheduled','attended'].includes(booking.status)) throw Error('Your child already has next week booked. Please choose a refund.');
  }
  n = { ...n, state: choice, decided_at: n.decided_at ?? new Date().toISOString(), processing_until: new Date(Date.now() + 120_000).toISOString() }; await save(db, event, n);
  if (choice === 'refund') {
    try { await refundClass(db, event, n); } catch (error) { const current = await readClassCancellation(db, token); if (current.notice.state === 'refund') await save(db, current.event, { ...current.notice, processing_until: undefined }); throw error; }
  } else {
    try { await transferClass(db, event, n); }
    catch (error) {
      const current = await readClassCancellation(db, token);
      const target = current.notice.target_registration_id ? checked(await db.from('class_registrations').select('status').eq('id', current.notice.target_registration_id).maybeSingle()) : null;
      if (current.notice.state === 'transfer' && (!target || !['scheduled','attended'].includes(target.status))) {
        if (current.notice.hold_id) checked(await db.from('square_checkout_attempts').update({ status: 'cancelled' }).eq('id', current.notice.hold_id).eq('status', 'creating').is('order_id', null).is('payload->provider_request', null));
        await save(db, current.event, { ...current.notice, state: 'pending', processing_until: undefined, target_registration_id: undefined, hold_id: undefined });
      } else if (current.notice.state === 'transfer') await save(db, current.event, { ...current.notice, processing_until: undefined });
      throw error;
    }
  }
  await tryNotifyOwner(db, event.id);
  return parseEvent(event);
}
