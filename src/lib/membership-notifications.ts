import type { SupabaseClient } from '@supabase/supabase-js';
import { sendMembershipSignupNotification, type MembershipNotification } from '@/lib/admin-notifications';
import { logger } from '@/lib/logger';

/** Durable queue plus keyed transport: retries never redo enrollment or charge a card. */
export async function sendDueMembershipNotifications(admin: SupabaseClient) {
  const result = await admin.from('membership_notification_outbox').select('id')
    .is('sent_at', null).lte('next_attempt_at', new Date().toISOString()).order('created_at').limit(5);
  if (result.error) throw new Error('Unable to load membership notifications.');
  let sent = 0;
  await Promise.all((result.data || []).map(async ({ id }: { id: string }) => {
    try {
      const leased = await admin.rpc('lease_membership_notification', { p_id: id });
      if (leased.error) throw new Error('Unable to claim membership notification.');
      if (!leased.data?.id) return;
      const row = leased.data as { id: string; event_key: string; attempts: number; payload: MembershipNotification };
      const email = await sendMembershipSignupNotification(row.payload, row.event_key);
      if (!email.ok) throw new Error('Membership notification delivery pending.');
      const saved = await admin.from('membership_notification_outbox').update({ sent_at: new Date().toISOString() }).eq('id', row.id).eq('attempts', row.attempts);
      if (saved.error) throw new Error('Unable to confirm membership notification.');
      sent++;
    } catch { logger.error({ action: 'membership.owner_notification_pending', notificationId: id }); }
  }));
  return { sent };
}
